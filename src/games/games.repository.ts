import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Game } from './entities/game.entity';

@Injectable()
export class GamesRepository {
  constructor(
    @InjectRepository(Game)
    private readonly repo: Repository<Game>,
  ) {}

  findAll(): Promise<Game[]> {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  findById(id: string): Promise<Game | null> {
    return this.repo.findOne({ where: { id } });
  }

  create(name: string, description: string | undefined): Promise<Game> {
    const game = this.repo.create({ name, description: description ?? null });
    return this.repo.save(game);
  }
}
