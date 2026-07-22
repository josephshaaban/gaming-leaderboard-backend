import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { UsersRepository } from '../users/users.repository';
import { RefreshTokensRepository } from './refresh-tokens.repository';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'player@example.com',
    passwordHash: 'hashed',
    role: 'player',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('AuthService', () => {
  let usersRepository: jest.Mocked<UsersRepository>;
  let refreshTokensRepository: jest.Mocked<RefreshTokensRepository>;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;
  let authService: AuthService;

  beforeEach(() => {
    usersRepository = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
    } as unknown as jest.Mocked<UsersRepository>;

    refreshTokensRepository = {
      create: jest.fn(),
      findByTokenHash: jest.fn(),
      revoke: jest.fn(),
      revokeAllForUser: jest.fn(),
    } as unknown as jest.Mocked<RefreshTokensRepository>;

    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
    } as unknown as jest.Mocked<JwtService>;

    configService = {
      get: jest.fn().mockReturnValue(7),
    } as unknown as jest.Mocked<ConfigService>;

    authService = new AuthService(
      usersRepository,
      refreshTokensRepository,
      jwtService,
      configService,
    );
  });

  describe('signUp', () => {
    it('hashes the password with argon2 and never stores it in plaintext', async () => {
      usersRepository.findByEmail.mockResolvedValue(null);
      usersRepository.create.mockImplementation((email, passwordHash) =>
        Promise.resolve(makeUser({ email, passwordHash })),
      );
      refreshTokensRepository.create.mockResolvedValue({} as RefreshToken);

      await authService.signUp('player@example.com', 'super-secret-1');

      const [, storedHash] = usersRepository.create.mock.calls[0];
      expect(storedHash).not.toBe('super-secret-1');
      await expect(argon2.verify(storedHash, 'super-secret-1')).resolves.toBe(
        true,
      );
    });

    it('rejects sign-up when the email is already registered', async () => {
      usersRepository.findByEmail.mockResolvedValue(makeUser());

      await expect(
        authService.signUp('player@example.com', 'password1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('rejects an unknown email without revealing whether the account exists', async () => {
      usersRepository.findByEmail.mockResolvedValue(null);

      await expect(
        authService.login('nobody@example.com', 'whatever'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an incorrect password', async () => {
      const passwordHash = await argon2.hash('correct-password');
      usersRepository.findByEmail.mockResolvedValue(makeUser({ passwordHash }));

      await expect(
        authService.login('player@example.com', 'wrong-password'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('issues tokens for a correct password', async () => {
      const passwordHash = await argon2.hash('correct-password');
      usersRepository.findByEmail.mockResolvedValue(makeUser({ passwordHash }));
      refreshTokensRepository.create.mockResolvedValue({} as RefreshToken);

      const tokens = await authService.login(
        'player@example.com',
        'correct-password',
      );

      expect(tokens.accessToken).toBe('signed.jwt.token');
      expect(tokens.refreshToken).toEqual(expect.any(String));
    });
  });

  describe('refresh', () => {
    it('rotates the refresh token and revokes the old one', async () => {
      const stored = {
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'hash',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        revokedAt: null,
        replacedByTokenId: null,
        createdAt: new Date(),
      } as RefreshToken;

      refreshTokensRepository.findByTokenHash
        .mockResolvedValueOnce(stored)
        .mockResolvedValueOnce({ id: 'rt-2' } as RefreshToken);
      usersRepository.findById.mockResolvedValue(makeUser());
      refreshTokensRepository.create.mockResolvedValue({} as RefreshToken);

      await authService.refresh('presented-token');

      expect(refreshTokensRepository.revoke).toHaveBeenCalledWith(
        'rt-1',
        'rt-2',
      );
    });

    it('revokes the whole token family on reuse of an already-rotated token', async () => {
      const revoked = {
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'hash',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        revokedAt: new Date(),
        replacedByTokenId: 'rt-2',
        createdAt: new Date(),
      } as RefreshToken;
      refreshTokensRepository.findByTokenHash.mockResolvedValue(revoked);

      await expect(authService.refresh('stolen-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(refreshTokensRepository.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
      );
    });

    it('rejects an expired refresh token', async () => {
      const expired = {
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'hash',
        expiresAt: new Date(Date.now() - 1000),
        revokedAt: null,
        replacedByTokenId: null,
        createdAt: new Date(),
      } as RefreshToken;
      refreshTokensRepository.findByTokenHash.mockResolvedValue(expired);

      await expect(authService.refresh('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
