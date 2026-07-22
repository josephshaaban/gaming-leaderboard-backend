import Redis from 'ioredis';
import {
  LEADERBOARD_UPDATES_PATTERN,
  gameIdFromChannel,
  leaderboardUpdatesChannel,
} from '../../src/redis/redis.constants';
import { RankUpdateMessage } from '../../src/websocket/protocol';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/**
 * Proves the mechanism the assignment weights heaviest: a result published
 * by one app instance reaches clients connected to a DIFFERENT instance,
 * purely through Redis pub/sub - with no shared in-process state at all.
 *
 * Two independent ioredis clients stand in for "instance A" (publisher) and
 * "instance B" (subscriber, with its own mocked local WebSocket registry).
 * They only share the same real Redis server, exactly like two separate
 * containers behind nginx would.
 */
describe('cross-instance Redis pub/sub fan-out', () => {
  let publisherClient: Redis;
  let instanceBSubscriber: Redis;

  beforeAll(() => {
    publisherClient = new Redis(REDIS_URL);
    instanceBSubscriber = new Redis(REDIS_URL);
  });

  afterAll(async () => {
    await publisherClient.quit();
    await instanceBSubscriber.quit();
  });

  it("delivers a rank_update published on instance A to instance B's local sockets", async () => {
    const gameId = `fanout-test-${Date.now()}`;
    const instanceBLocalSockets = new Map<string, { send: jest.Mock }>();
    const mockSocket = { send: jest.fn() };
    instanceBLocalSockets.set(gameId, mockSocket);

    await instanceBSubscriber.psubscribe(LEADERBOARD_UPDATES_PATTERN);

    const received = new Promise<void>((resolve) => {
      instanceBSubscriber.on(
        'pmessage',
        (_pattern: string, channel: string, message: string) => {
          const receivedGameId = gameIdFromChannel(channel);
          const socket = instanceBLocalSockets.get(receivedGameId);
          if (socket) {
            socket.send(message);
            resolve();
          }
        },
      );
    });

    const message: RankUpdateMessage = {
      type: 'rank_update',
      gameId,
      matchId: 'match-fanout-1',
      player: { playerId: 'player-1' },
      previousRank: null,
      newRank: 1,
      previousScore: 0,
      newScore: 42,
      delta: 42,
      top: [{ playerId: 'player-1', score: 42, rank: 1 }],
      ts: new Date().toISOString(),
    };

    // "Instance A" never talks to instance B directly - it only publishes.
    await publisherClient.publish(
      leaderboardUpdatesChannel(gameId),
      JSON.stringify(message),
    );

    await received;

    expect(mockSocket.send).toHaveBeenCalledTimes(1);
    const delivered = JSON.parse(
      (mockSocket.send.mock.calls[0] as [string])[0],
    ) as RankUpdateMessage;
    expect(delivered).toEqual(message);
  }, 10_000);
});
