import { Injectable, Logger } from '@nestjs/common';
import type { WebSocket } from 'ws';
import { WS_CLOSE_SERVER_SHUTDOWN } from './protocol';

interface TrackedSocket extends WebSocket {
  isAlive?: boolean;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Tracks live WebSocket connections per gameId and fans out messages to
 * them. This is the ONLY place that ever calls ws.send() - the Redis
 * subscriber and the upgrade handler both go through here, so there is no
 * code path that could accidentally reach clients without going through
 * Redis first.
 */
@Injectable()
export class ConnectionRegistry {
  private readonly logger = new Logger(ConnectionRegistry.name);
  private readonly connectionsByGame = new Map<string, Set<TrackedSocket>>();
  private heartbeatTimer: NodeJS.Timeout | undefined;

  register(gameId: string, ws: WebSocket): void {
    const tracked = ws as TrackedSocket;
    tracked.isAlive = true;

    let sockets = this.connectionsByGame.get(gameId);
    if (!sockets) {
      sockets = new Set();
      this.connectionsByGame.set(gameId, sockets);
    }
    sockets.add(tracked);

    tracked.on('pong', () => {
      tracked.isAlive = true;
    });
    const cleanup = (): void => this.unregister(gameId, tracked);
    tracked.on('close', cleanup);
    tracked.on('error', (err) => {
      this.logger.warn(`Socket error for game=${gameId}: ${err.message}`);
      cleanup();
    });
  }

  unregister(gameId: string, ws: WebSocket): void {
    const sockets = this.connectionsByGame.get(gameId);
    if (!sockets) return;
    sockets.delete(ws);
    if (sockets.size === 0) {
      this.connectionsByGame.delete(gameId);
    }
  }

  broadcast(gameId: string, payload: string): void {
    const sockets = this.connectionsByGame.get(gameId);
    if (!sockets || sockets.size === 0) return;
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) {
        socket.send(payload);
      }
    }
  }

  startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const sockets of this.connectionsByGame.values()) {
        for (const socket of sockets) {
          if (socket.isAlive === false) {
            socket.terminate();
            continue;
          }
          socket.isAlive = false;
          socket.ping();
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref();
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /** Closes every open connection gracefully - used during app shutdown. */
  closeAll(): void {
    for (const sockets of this.connectionsByGame.values()) {
      for (const socket of sockets) {
        socket.close(WS_CLOSE_SERVER_SHUTDOWN, 'Server shutting down');
      }
    }
    this.connectionsByGame.clear();
  }

  get connectionCount(): number {
    let total = 0;
    for (const sockets of this.connectionsByGame.values()) {
      total += sockets.size;
    }
    return total;
  }
}
