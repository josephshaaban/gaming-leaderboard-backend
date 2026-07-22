import { JwtService } from '@nestjs/jwt';
import type { IncomingMessage } from 'node:http';
import { authenticateUpgrade, WsAuthError } from './ws-auth.util';

function fakeRequest(url: string): IncomingMessage {
  return { url } as IncomingMessage;
}

describe('authenticateUpgrade', () => {
  const jwtService = new JwtService({ secret: 'test-secret' });

  it('accepts a valid token and extracts gameId + userId', async () => {
    const token = await jwtService.signAsync({
      sub: 'user-1',
      email: 'a@b.com',
      role: 'player',
    });

    const context = await authenticateUpgrade(
      fakeRequest(`/ws/leaderboard/game-1?token=${token}`),
      jwtService,
    );

    expect(context).toEqual({ gameId: 'game-1', userId: 'user-1' });
  });

  it('rejects a connection with no token query param, with WsAuthError(401)', async () => {
    await expect(
      authenticateUpgrade(fakeRequest('/ws/leaderboard/game-1'), jwtService),
    ).rejects.toMatchObject(
      new WsAuthError(401, 'Missing token query parameter'),
    );
  });

  it('rejects an expired token, with WsAuthError(401)', async () => {
    const token = await jwtService.signAsync(
      { sub: 'user-1', email: 'a@b.com', role: 'player' },
      { expiresIn: '-1s' },
    );

    await expect(
      authenticateUpgrade(
        fakeRequest(`/ws/leaderboard/game-1?token=${token}`),
        jwtService,
      ),
    ).rejects.toBeInstanceOf(WsAuthError);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const otherJwtService = new JwtService({ secret: 'wrong-secret' });
    const token = await otherJwtService.signAsync({
      sub: 'user-1',
      email: 'a@b.com',
      role: 'player',
    });

    await expect(
      authenticateUpgrade(
        fakeRequest(`/ws/leaderboard/game-1?token=${token}`),
        jwtService,
      ),
    ).rejects.toBeInstanceOf(WsAuthError);
  });

  it('rejects a path that does not match the WS leaderboard route, with a 404', async () => {
    const token = await jwtService.signAsync({
      sub: 'user-1',
      email: 'a@b.com',
      role: 'player',
    });

    await expect(
      authenticateUpgrade(
        fakeRequest(`/ws/something-else?token=${token}`),
        jwtService,
      ),
    ).rejects.toMatchObject({ httpStatus: 404 });
  });
});
