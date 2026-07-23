import { HttpException, INestApplication, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { authenticateUpgrade, WsAuthError } from './ws-auth.util';
import { ConnectionRegistry } from './connection-registry';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import { GamesService } from '../games/games.service';
import {
  SnapshotMessage,
  WS_CLOSE_INTERNAL_ERROR,
  WS_CLOSE_NOT_FOUND,
  WS_CLOSE_UNAUTHORIZED,
} from './protocol';

const TOP_N_ON_CONNECT = 10;

/**
 * Attaches a raw `ws` server to the Nest HTTP server's `upgrade` event,
 * handling `WS /ws/leaderboard/:gameId`. A manual upgrade handler (rather
 * than a `@nestjs/websockets` gateway) is used because the route needs a
 * dynamic path segment - see NOTES.md for the full justification.
 *
 * Auth/lookup failures still complete the WS opening handshake (a close
 * frame can only be sent from the OPEN state) and are then immediately
 * closed with an application-specific code (4401/4404) - never registered
 * with the connection registry, never sent a snapshot.
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
          try {
            await gamesService.findByIdOrThrow(gameId);
          } catch {
            closeWithCode(
              wss,
              req,
              socket,
              head,
              WS_CLOSE_NOT_FOUND,
              'Unknown gameId',
            );
            return;
          }
          wss.handleUpgrade(req, socket, head, (ws) => {
            registry.register(gameId, ws);
            void sendInitialSnapshot(leaderboardService, logger, gameId, ws);
          });
        })
        .catch((err: unknown) => {
          const code =
            err instanceof WsAuthError && err.httpStatus === 404
              ? WS_CLOSE_NOT_FOUND
              : err instanceof WsAuthError
                ? WS_CLOSE_UNAUTHORIZED
                : WS_CLOSE_INTERNAL_ERROR;
          const reason =
            err instanceof WsAuthError || err instanceof HttpException
              ? err.message
              : 'Internal error';
          closeWithCode(wss, req, socket, head, code, reason);
        });
    },
  );

  registry.startHeartbeat();
  logger.log('WebSocket upgrade handler attached at /ws/leaderboard/:gameId');

  return registry;
}

/**
 * Completes the WS opening handshake purely so a real close frame can be
 * sent, then immediately closes with `code`/`reason` - the connection is
 * never registered and never receives a snapshot.
 */
function closeWithCode(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  code: number,
  reason: string,
): void {
  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    ws.close(code, reason);
  });
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
