import { MigrationInterface, QueryRunner } from "typeorm";

/** Preferencia de cada usuario para recibir los avisos por email. */
export class AvisosPorEmail1791768647782 implements MigrationInterface {
    name = 'AvisosPorEmail1791768647782'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "email_alerts" boolean NOT NULL DEFAULT true`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email_alerts"`);
    }

}
