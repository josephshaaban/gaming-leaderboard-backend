import { JwtService } from '@nestjs/jwt';
import type { IncomingMessage } from 'node:http';
import { AccessTokenPayload } from '../auth/auth.service';

const WS_PATH_PATTERN = /^\/ws\/leaderboard\/([^/]+)\/?$/;

export class WsAuthError extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
  }
}

export interface WsUpgradeContext {
  gameId: string;
  userId: string;
}

/**
 * Authenticates a WebSocket upgrade request. The token travels as a
 * `?token=` query param (see NOTES.md for the justification vs. subprotocol
 * / first-message alternatives). The caller (`attach-ws-server.ts`) turns a
 * thrown `WsAuthError` into a completed handshake immediately followed by a
 * WS close frame with an application-specific code (4401/4404), rather than
 * ever delivering a snapshot or registering the connection.
 */
export async function authenticateUpgrade(
  req: IncomingMessage,
  jwtService: JwtService,
): Promise<WsUpgradeContext> {
  const url = new URL(req.url ?? '', 'http://localhost');
  const match = WS_PATH_PATTERN.exec(url.pathname);
  if (!match) {
    throw new WsAuthError(404, 'Unknown WebSocket path');
  }
  const gameId = decodeURIComponent(match[1]);

  const token = url.searchParams.get('token');
  if (!token) {
    throw new WsAuthError(401, 'Missing token query parameter');
  }

  try {
    const payload = await jwtService.verifyAsync<AccessTokenPayload>(token);
    return { gameId, userId: payload.sub };
  } catch {
    throw new WsAuthError(401, 'Invalid or expired token');
  }
}
