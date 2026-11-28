import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitRolesUsersRefreshTokens1795844700000 implements MigrationInterface {
  name = 'InitRolesUsersRefreshTokens1795844700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "user_status" AS ENUM ('active', 'inactive', 'suspended');
    `);

    await queryRunner.query(`
      CREATE TABLE "roles" (
        "id" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        "name" VARCHAR(50) NOT NULL,
        "description" VARCHAR(255),
        CONSTRAINT "UQ_roles_name" UNIQUE ("name")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        "role_id" BIGINT NOT NULL,
        "first_name" VARCHAR(60) NOT NULL,
        "last_name" VARCHAR(60) NOT NULL,
        "email" VARCHAR(150) NOT NULL,
        "password_hash" VARCHAR(255) NOT NULL,
        "phone" VARCHAR(20),
        "status" "user_status" NOT NULL DEFAULT 'active',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "FK_users_role_id" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        "user_id" BIGINT NOT NULL,
        "jti" UUID NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "revoked_at" TIMESTAMPTZ,
        "replaced_by_jti" UUID,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_refresh_tokens_jti" UNIQUE ("jti"),
        CONSTRAINT "FK_refresh_tokens_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_refresh_tokens_user_id" ON "refresh_tokens" ("user_id");
    `);

    await queryRunner.query(`
      INSERT INTO "roles" ("name", "description")
      VALUES
        ('admin', 'Platform administrator'),
        ('agent', 'Verified real estate agent'),
        ('client', 'Registered property seeker');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_refresh_tokens_user_id";
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "refresh_tokens";
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "users";
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "roles";
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "user_status";
    `);
  }
}
