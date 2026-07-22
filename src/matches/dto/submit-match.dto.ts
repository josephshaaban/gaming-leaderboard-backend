import { IsInt, IsUUID } from 'class-validator';

export class SubmitMatchDto {
  @IsUUID()
  gameId!: string;

  @IsInt()
  score!: number;
}
