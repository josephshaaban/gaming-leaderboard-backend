import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateMatches1700000000004 implements MigrationInterface {
  name = 'CreateMatches1700000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'matches',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          { name: 'game_id', type: 'uuid' },
          { name: 'player_id', type: 'uuid' },
          { name: 'score', type: 'int' },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'matches',
      new TableForeignKey({
        columnNames: ['game_id'],
        referencedTableName: 'games',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'matches',
      new TableForeignKey({
        columnNames: ['player_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'matches',
      new TableIndex({ name: 'IDX_matches_game_id', columnNames: ['game_id'] }),
    );
    await queryRunner.createIndex(
      'matches',
      new TableIndex({
        name: 'IDX_matches_game_id_player_id',
        columnNames: ['game_id', 'player_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('matches');
  }
}
