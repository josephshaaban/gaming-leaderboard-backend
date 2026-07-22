import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'node:crypto';
import { UsersRepository } from '../users/users.repository';
import { RefreshTokensRepository } from './refresh-tokens.repository';
import { User } from '../users/entities/user.entity';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async signUp(email: string, password: string): Promise<AuthTokens> {
    const existing = await this.usersRepository.findByEmail(email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }
    const passwordHash = await argon2.hash(password);
    const user = await this.usersRepository.create(email, passwordHash);
    return this.issueTokens(user);
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const user = await this.usersRepository.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.issueTokens(user);
  }

  async refresh(presentedToken: string): Promise<AuthTokens> {
    const tokenHash = hashToken(presentedToken);
    const stored =
      await this.refreshTokensRepository.findByTokenHash(tokenHash);

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      // Reuse of an already-rotated-away token: treat as a stolen-token
      // signal and revoke the entire family rather than just this token.
      await this.refreshTokensRepository.revokeAllForUser(stored.userId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.usersRepository.findById(stored.userId);
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.issueTokens(user);
    const newTokenHash = hashToken(tokens.refreshToken);
    const newStored =
      await this.refreshTokensRepository.findByTokenHash(newTokenHash);
    await this.refreshTokensRepository.revoke(stored.id, newStored?.id);

    return tokens;
  }

  private async issueTokens(user: User): Promise<AuthTokens> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const accessToken = await this.jwtService.signAsync(payload);

    const refreshToken = randomBytes(32).toString('hex');
    const ttlDays = this.configService.get<number>('REFRESH_TOKEN_TTL_DAYS', 7);
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    await this.refreshTokensRepository.create({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt,
    });

    return { accessToken, refreshToken };
  }
}
