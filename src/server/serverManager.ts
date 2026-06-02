import http from 'node:http';
import { networkInterfaces } from 'node:os';
import type express from 'express';
import { WebSocketServer } from 'ws';
import type { AuthService } from './services/authService';
import type { Logger } from './utils/logger';
import { resolveListenHost } from './config';
import { saveServerPreferences } from './serverPreferences';
import { WebBridge } from './app/bridge/webBridge';
import type { ServerInfo } from '../shared/types';

export type ServerInstance = {
  server: http.Server;
  wss: WebSocketServer;
  bridge: WebBridge;
  host: string;
  port: number;
  allowRemote: boolean;
};

export class ServerManager {
  private instance: ServerInstance | null = null;
  private restarting = false;
  private restartQueue = Promise.resolve();

  constructor(
    private readonly input: {
      app: express.Express;
      auth: AuthService;
      logger: Logger;
      dataDir: string;
      port: number;
      allowRemote: boolean;
      configureBridge: (bridge: WebBridge) => void;
      onFirstListen?: () => void;
    }
  ) {}

  async start(): Promise<void> {
    await this.startInstance(this.input.allowRemote);
    this.input.onFirstListen?.();
  }

  info(override?: { allowRemote?: boolean; restarting?: boolean }): ServerInfo {
    const allowRemote = override?.allowRemote ?? this.instance?.allowRemote ?? this.input.allowRemote;
    const port = this.instance?.port ?? this.input.port;
    const host = resolveListenHost(allowRemote);
    return {
      host,
      port,
      allowRemote,
      restarting: override?.restarting ?? this.restarting,
      urls: getServerUrls(port, allowRemote),
    };
  }

  setRemoteAccess(allowRemote: boolean): ServerInfo {
    if (allowRemote === (this.instance?.allowRemote ?? this.input.allowRemote) && !this.restarting) {
      return this.info();
    }

    const target = this.info({ allowRemote, restarting: true });
    const restartTimer = setTimeout(() => {
      this.restartQueue = this.restartQueue
        .then(() => this.restart(allowRemote))
        .catch((error) => {
          this.input.logger.error('server_rebind_failed', {
            allowRemote,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }, 150);
    restartTimer.unref();

    return target;
  }

  async shutdown(): Promise<void> {
    await this.stopInstance(this.instance, 'Server shutting down');
    this.instance = null;
  }

  private async restart(allowRemote: boolean): Promise<void> {
    if (allowRemote === this.instance?.allowRemote) return;

    this.restarting = true;
    const previousAllowRemote = this.instance?.allowRemote ?? this.input.allowRemote;
    this.input.logger.info('server_rebind_start', {
      fromHost: resolveListenHost(previousAllowRemote),
      toHost: resolveListenHost(allowRemote),
      port: this.input.port,
    });

    await this.stopInstance(this.instance, 'Server restarting');
    this.instance = null;

    try {
      await this.startInstance(allowRemote);
      saveServerPreferences(this.input.dataDir, { allowRemote });
      this.input.allowRemote = allowRemote;
      this.restarting = false;
      this.input.logger.info('server_rebind_complete', this.info());
    } catch (error) {
      this.input.logger.error('server_rebind_listen_failed', {
        allowRemote,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.startInstance(previousAllowRemote);
      throw error;
    } finally {
      this.restarting = false;
    }
  }

  private async startInstance(allowRemote: boolean): Promise<void> {
    const host = resolveListenHost(allowRemote);
    const server = http.createServer(this.input.app);
    const wss = new WebSocketServer({ server });
    const bridge = new WebBridge(wss, this.input.auth);

    this.input.configureBridge(bridge);

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.input.port, host);
    });

    this.instance = {
      server,
      wss,
      bridge,
      host,
      port: this.input.port,
      allowRemote,
    };
  }

  private async stopInstance(instance: ServerInstance | null, reason: string): Promise<void> {
    if (!instance) return;

    for (const client of instance.wss.clients) {
      client.close(1001, reason);
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 1000);
      timeout.unref();
      instance.server.close(() => {
        clearTimeout(timeout);
        resolve();
      });
    });

    for (const client of instance.wss.clients) {
      client.terminate();
    }
    instance.wss.close();
  }
}

function getServerUrls(port: number, allowRemote: boolean): string[] {
  const urls = new Set<string>([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  if (allowRemote) {
    for (const ip of getNonInternalIPv4()) urls.add(`http://${ip}:${port}`);
  }
  return [...urls];
}

function getNonInternalIPv4(): string[] {
  const ips: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if ((entry.family === 'IPv4' || (entry.family as unknown) === 4) && !entry.internal) {
        ips.push(entry.address);
      }
    }
  }
  return ips;
}
