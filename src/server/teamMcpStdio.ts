import net from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const port = Number.parseInt(process.env.TEAM_MCP_PORT || '0', 10);
const authToken = process.env.TEAM_MCP_TOKEN || '';
const fromSlotId = process.env.TEAM_AGENT_SLOT_ID || '';

if (!port || !authToken) {
  process.stderr.write('TEAM_MCP_PORT and TEAM_MCP_TOKEN are required\n');
  process.exit(1);
}

const server = new McpServer({ name: 'haunting-souls-team', version: '0.1.0' }, { capabilities: { tools: {} } });

server.tool(
  'team_members',
  'List current team members with their names, roles, backend, and status.',
  {},
  async () => textResult(await callTeamTool('team_members', {}))
);

server.tool(
  'team_send_message',
  'Send a message to a teammate by name. Use this for coordination and handoffs.',
  {
    to: z.string().describe('Recipient teammate name or slot id'),
    message: z.string().describe('Message body'),
    summary: z.string().optional().describe('Short UI summary'),
  },
  async (args) => textResult(await callTeamTool('team_send_message', args))
);

server.tool(
  'team_add_agent',
  'Start another AI agent and add it to the current team. Use backend="claude" to start Claude Code, backend="codex" to start Codex. Use this when the task benefits from review, parallel work, cross-checking, or another agent.',
  {
    name: z.string().describe('Human-readable teammate name, e.g. "Claude Reviewer" or "Codex Implementer"'),
    backend: z.enum(['claude', 'codex']).describe('Exact backend to start: "claude" or "codex"'),
  },
  async (args) => textResult(await callTeamTool('team_add_agent', args))
);

server.tool(
  'team_remove_agent',
  'Remove a teammate from the current team.',
  {
    agent: z.string().describe('Teammate name or slot id to remove'),
  },
  async (args) => textResult(await callTeamTool('team_remove_agent', args))
);

server.tool(
  'team_finish_task',
  'Report that the current task is complete and notify the leader.',
  {
    summary: z.string().describe('Short summary of what was completed'),
    task_id: z.string().optional().describe('Optional task id if one exists'),
  },
  async (args) => textResult(await callTeamTool('team_finish_task', args))
);

server.tool(
  'team_delegate_task',
  'Delegate a task in one call. It will reuse an existing teammate with the requested backend when available, otherwise it will start that backend and assign the task.',
  {
    backend: z.enum(['claude', 'codex']).describe('Backend to delegate to'),
    name: z.string().optional().describe('Optional teammate name. If omitted, use a default name based on backend.'),
    task: z.string().describe('Task message to send to the teammate'),
    summary: z.string().optional().describe('Short UI summary'),
  },
  async (args) => textResult(await callTeamTool('team_delegate_task', args))
);

await server.connect(new StdioServerTransport());

async function callTeamTool(tool: string, args: Record<string, unknown>): Promise<string> {
  const response = await sendTcpRequest({ tool, args, authToken, fromSlotId });
  if (response.error) throw new Error(String(response.error));
  return String(response.result || '');
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function sendTcpRequest(payload: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, '127.0.0.1');
    let buffer = Buffer.alloc(0);
    socket.once('connect', () => {
      const body = Buffer.from(JSON.stringify(payload), 'utf8');
      const header = Buffer.alloc(4);
      header.writeUInt32BE(body.length, 0);
      socket.write(Buffer.concat([header, body]));
    });
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const length = buffer.readUInt32BE(0);
      if (buffer.length < length + 4) return;
      resolve(JSON.parse(buffer.subarray(4, 4 + length).toString('utf8')));
      socket.end();
    });
    socket.on('error', reject);
    socket.setTimeout(30_000, () => {
      socket.destroy();
      reject(new Error('Team MCP TCP request timed out'));
    });
  });
}
