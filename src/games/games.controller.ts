import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { GamesService } from './games.service';
import { CreateGameDto } from './dto/create-game.dto';
import { Game } from './entities/game.entity';
import { Public } from '../common/decorators/public.decorator';

@Controller('games')
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Public()
  @Get()
  findAll(): Promise<Game[]> {
    return this.gamesService.findAll();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateGameDto): Promise<Game> {
    return this.gamesService.create(dto.name, dto.description);
  }
}
