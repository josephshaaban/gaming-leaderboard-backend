import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RefreshToken } from './entities/refresh-token.entity';

@Injectable()
export class RefreshTokensRepository {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly repo: Repository<RefreshToken>,
  ) {}

  create(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshToken> {
    const entity = this.repo.create(data);
    return this.repo.save(entity);
  }

  findByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.repo.findOne({ where: { tokenHash } });
  }

  async revoke(id: string, replacedByTokenId?: string): Promise<void> {
    await this.repo.update(id, {
      revokedAt: new Date(),
      replacedByTokenId: replacedByTokenId ?? null,
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.repo.update({ userId }, { revokedAt: new Date() });
  }
}
