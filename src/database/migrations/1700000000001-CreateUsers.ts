import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateUsers1700000000001 implements MigrationInterface {
  name = 'CreateUsers1700000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          { name: 'email', type: 'varchar', length: '320', isUnique: true },
          { name: 'password_hash', type: 'varchar', length: '255' },
          {
            name: 'role',
            type: 'varchar',
            length: '16',
            default: "'player'",
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'now()',
          },
          {
            name: 'updated_at',
            type: 'timestamptz',
            default: 'now()',
          },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('users');
  }
}
