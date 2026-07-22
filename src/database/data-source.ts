import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { Game } from '../games/entities/game.entity';
import { Match } from '../matches/entities/match.entity';

config();

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [User, RefreshToken, Game, Match],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
  migrationsRun: false,
};

export default new DataSource(dataSourceOptions);
