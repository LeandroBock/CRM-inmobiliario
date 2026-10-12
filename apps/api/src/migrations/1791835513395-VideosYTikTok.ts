import { MigrationInterface, QueryRunner } from "typeorm";

export class VideosYTikTok1791835513395 implements MigrationInterface {
    name = 'VideosYTikTok1791835513395'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "tiktok_accounts" ("id" character varying NOT NULL, "open_id" character varying NOT NULL, "display_name" character varying, "username" character varying, "scope" character varying, "access_token_enc" text NOT NULL, "access_expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "refresh_token_enc" text NOT NULL, "refresh_expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "connected_by" uuid, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_78bccdf805fea8f9635bfc4127d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "social_posts" ADD "platform_options" jsonb NOT NULL DEFAULT '{}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "social_posts" DROP COLUMN "platform_options"`);
        await queryRunner.query(`DROP TABLE "tiktok_accounts"`);
    }

}
