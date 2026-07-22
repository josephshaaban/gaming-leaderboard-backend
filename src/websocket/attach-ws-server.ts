import { HttpException, INestApplication, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer } from 'ws';
import { authenticateUpgrade, WsAuthError } from './ws-auth.util';
import { ConnectionRegistry } from './connection-registry';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import { GamesService } from '../games/games.service';
import { SnapshotMessage } from './protocol';

const TOP_N_ON_CONNECT = 10;

/**
 * Attaches a raw `ws` server to the Nest HTTP server's `upgrade` event,
 * handling `WS /ws/leaderboard/:gameId`. A manual upgrade handler (rather
 * than a `@nestjs/websockets` gateway) is used because the route needs a
 * dynamic path segment and pre-handshake JWT rejection with a plain HTTP
 * status - see NOTES.md for the full justification.
 */
export function attachWebSocketServer(
  app: INestApplication,
): ConnectionRegistry {
  const logger = new Logger('WebSocketServer');
  const jwtService = app.get(JwtService);
  const registry = app.get(ConnectionRegistry);
  const leaderboardService = app.get(LeaderboardService);
  const gamesService = app.get(GamesService);

  const wss = new WebSocketServer({ noServer: true });

  const httpServer = app.getHttpServer() as Server;
  httpServer.on(
    'upgrade',
    (req: IncomingMessage, socket: Socket, head: Buffer) => {
      authenticateUpgrade(req, jwtService)
        .then(async ({ gameId }) => {
          await gamesService.findByIdOrThrow(gameId);
          wss.handleUpgrade(req, socket, head, (ws) => {
            registry.register(gameId, ws);
            void sendInitialSnapshot(leaderboardService, logger, gameId, ws);
          });
        })
        .catch((err: unknown) => {
          const status =
            err instanceof WsAuthError
              ? err.httpStatus
              : err instanceof HttpException
                ? err.getStatus()
                : 500;
          const reason =
            err instanceof WsAuthError || err instanceof HttpException
              ? err.message
              : 'Internal error';
          socket.write(
            `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`,
          );
          socket.destroy();
        });
    },
  );

  registry.startHeartbeat();
  logger.log('WebSocket upgrade handler attached at /ws/leaderboard/:gameId');

  return registry;
}

async function sendInitialSnapshot(
  leaderboardService: LeaderboardService,
  logger: Logger,
  gameId: string,
  ws: import('ws').WebSocket,
): Promise<void> {
  try {
    const entries = await leaderboardService.getTopN(
      gameId,
      0,
      TOP_N_ON_CONNECT,
    );
    const snapshot: SnapshotMessage = {
      type: 'snapshot',
      gameId,
      entries,
      generatedAt: new Date().toISOString(),
    };
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(snapshot));
    }
  } catch (err) {
    // A Redis/Postgres hiccup while building the snapshot must not tear
    // down the connection - the client simply hydrates on the next
    // broadcast instead.
    logger.error(
      `Failed to send initial snapshot for game=${gameId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
