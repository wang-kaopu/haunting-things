import http from 'node:http';
import { networkInterfaces } from 'node:os';
import type express from 'express';
import { WebSocketServer } from 'ws';
import type { AuthService } from '@server/services/authService';
import type { Logger } from '@server/utils/logger';
import { resolveListenHost } from '@server/config';
import { saveServerPreferences } from '@server/serverPreferences';
import { WebBridge } from '@server/app/bridge/webBridge';
import type { ServerInfo } from '@shared/types';

/** 当前运行中的 HTTP、WebSocket 和 Bridge 服务实例。 */
export type ServerInstance = {
  server: http.Server;
  wss: WebSocketServer;
  bridge: WebBridge;
  host: string;
  port: number;
  allowRemote: boolean;
};

/** 管理 HTTP/WebSocket 服务实例，并支持运行时切换本机/局域网监听。 */
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

  /** 启动首个服务实例，并在首次监听成功后触发初始化回调。 */
  async start(): Promise<void> {
    await this.startInstance(this.input.allowRemote);
    this.input.onFirstListen?.();
  }

  /** 返回前端展示所需的服务地址、端口和重启状态快照。 */
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

  /** 返回远程访问切换目标，供 Bridge 先写入响应再触发服务重绑。 */
  setRemoteAccess(allowRemote: boolean): ServerInfo {
    if (allowRemote === (this.instance?.allowRemote ?? this.input.allowRemote) && !this.restarting) {
      return this.info();
    }

    return this.info({ allowRemote, restarting: true });
  }

  /** 在 Bridge 响应写入后排队重绑监听地址，避免中断当前 RPC。 */
  restartRemoteAccess(allowRemote: boolean): void {
    this.restartQueue = this.restartQueue
      .then(() => this.restart(allowRemote))
      .catch((error) => {
        this.input.logger.error('server_rebind_failed', {
          allowRemote,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  /** 关闭当前 HTTP 和 WebSocket 服务，通常用于进程退出。 */
  async shutdown(): Promise<void> {
    await this.stopInstance(this.instance, 'Server shutting down');
    this.instance = null;
  }

  /**
   * 切换监听地址并在失败时回滚到上一个监听模式。
   */
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

  /**
   * 启动一组新的 HTTP、WebSocket 和 Bridge 实例。
   */
  private async startInstance(allowRemote: boolean): Promise<void> {
    const host = resolveListenHost(allowRemote);
    const server = http.createServer(this.input.app);
    const wss = new WebSocketServer({ server, maxPayload: 32 * 1024 * 1024 });
    wss.on('error', (error) => {
      this.input.logger.error('websocket_server_error', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
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

  /** 关闭指定服务实例，确认端口释放后才允许重新绑定。 */
  private async stopInstance(instance: ServerInstance | null, reason: string): Promise<void> {
    if (!instance) return;

    const serverClosed = new Promise<void>((resolve) => {
      instance.server.close(() => resolve());
    });
    instance.server.closeIdleConnections();

    for (const client of instance.wss.clients) {
      client.close(1001, reason);
    }

    const forceCloseTimer = setTimeout(() => {
      for (const client of instance.wss.clients) {
        client.terminate();
      }
      instance.server.closeAllConnections();
    }, 1000);
    forceCloseTimer.unref();

    await serverClosed;
    clearTimeout(forceCloseTimer);
    instance.wss.close();
  }
}

/** 返回远程访问开启时可展示给用户的局域网地址。 */
function getServerUrls(port: number, allowRemote: boolean): string[] {
  const urls = new Set<string>();
  if (!allowRemote) return [];
  for (const ip of getNonInternalIPv4()) urls.add(`http://${ip}:${port}`);
  return [...urls];
}

/** 枚举本机非回环 IPv4 地址，供远程访问 URL 展示使用。 */
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
