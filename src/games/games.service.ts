import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GamesRepository } from './games.repository';
import { Game } from './entities/game.entity';

@Injectable()
export class GamesService {
  constructor(private readonly gamesRepository: GamesRepository) {}

  findAll(): Promise<Game[]> {
    return this.gamesRepository.findAll();
  }

  async findByIdOrThrow(id: string): Promise<Game> {
    const game = await this.gamesRepository.findById(id);
    if (!game) {
      throw new NotFoundException(`Game ${id} not found`);
    }
    return game;
  }

  async create(name: string, description?: string): Promise<Game> {
    try {
      return await this.gamesRepository.create(name, description);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(`Game "${name}" already exists`);
      }
      throw err;
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
