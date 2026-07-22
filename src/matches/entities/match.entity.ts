import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Game } from '../../games/entities/game.entity';
import { User } from '../../users/entities/user.entity';

@Entity('matches')
@Index(['gameId', 'playerId'])
export class Match {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'game_id', type: 'uuid' })
  gameId!: string;

  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'game_id' })
  game!: Game;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'player_id' })
  player!: User;

  @Column({ type: 'int' })
  score!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
