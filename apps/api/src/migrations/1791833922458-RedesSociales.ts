import { MigrationInterface, QueryRunner } from "typeorm";

export class RedesSociales1791833922458 implements MigrationInterface {
    name = 'RedesSociales1791833922458'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "social_posts" ADD "external_url" character varying`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e9dc9ba712da5978b6edef1b67"`);
        await queryRunner.query(`ALTER TYPE "public"."social_posts_status_enum" RENAME TO "social_posts_status_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."social_posts_status_enum" AS ENUM('borrador', 'programado', 'publicando', 'publicado', 'fallido')`);
        await queryRunner.query(`ALTER TABLE "social_posts" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "social_posts" ALTER COLUMN "status" TYPE "public"."social_posts_status_enum" USING "status"::"text"::"public"."social_posts_status_enum"`);
        await queryRunner.query(`ALTER TABLE "social_posts" ALTER COLUMN "status" SET DEFAULT 'borrador'`);
        await queryRunner.query(`DROP TYPE "public"."social_posts_status_enum_old"`);
        await queryRunner.query(`CREATE INDEX "IDX_e9dc9ba712da5978b6edef1b67" ON "social_posts" ("platform", "status", "scheduled_at") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_e9dc9ba712da5978b6edef1b67"`);
        await queryRunner.query(`CREATE TYPE "public"."social_posts_status_enum_old" AS ENUM('borrador', 'programado', 'publicado', 'fallido')`);
        await queryRunner.query(`ALTER TABLE "social_posts" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "social_posts" ALTER COLUMN "status" TYPE "public"."social_posts_status_enum_old" USING "status"::"text"::"public"."social_posts_status_enum_old"`);
        await queryRunner.query(`ALTER TABLE "social_posts" ALTER COLUMN "status" SET DEFAULT 'borrador'`);
        await queryRunner.query(`DROP TYPE "public"."social_posts_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."social_posts_status_enum_old" RENAME TO "social_posts_status_enum"`);
        await queryRunner.query(`CREATE INDEX "IDX_e9dc9ba712da5978b6edef1b67" ON "social_posts" ("platform", "status", "scheduled_at") `);
        await queryRunner.query(`ALTER TABLE "social_posts" DROP COLUMN "external_url"`);
    }

}
