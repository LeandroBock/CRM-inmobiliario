import { MigrationInterface, QueryRunner } from "typeorm";

/** Audios y fotos que mandan los clientes por WhatsApp (archivo privado + tipo). */
export class AdjuntosDeChat1791768135696 implements MigrationInterface {
    name = 'AdjuntosDeChat1791768135696'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "chat_history" ADD "media_type" character varying`);
        await queryRunner.query(`ALTER TABLE "chat_history" ADD "media_file" character varying`);
        await queryRunner.query(`ALTER TABLE "chat_history" ADD "media_mime" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "chat_history" DROP COLUMN "media_mime"`);
        await queryRunner.query(`ALTER TABLE "chat_history" DROP COLUMN "media_file"`);
        await queryRunner.query(`ALTER TABLE "chat_history" DROP COLUMN "media_type"`);
    }

}
