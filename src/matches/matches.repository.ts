import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Match } from './entities/match.entity';

@Injectable()
export class MatchesRepository {
  constructor(
    @InjectRepository(Match)
    private readonly repo: Repository<Match>,
  ) {}

  create(gameId: string, playerId: string, score: number): Promise<Match> {
    const match = this.repo.create({ gameId, playerId, score });
    return this.repo.save(match);
  }
}
