import { MigrationInterface, QueryRunner } from "typeorm";

/** Conexión de cada asesor con su Google Calendar y evento de cada visita. */
export class GoogleCalendar1791767627612 implements MigrationInterface {
    name = 'GoogleCalendar1791767627612'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "google_calendar_links" ("user_id" uuid NOT NULL, "google_email" character varying NOT NULL, "refresh_token_enc" text NOT NULL, "calendar_id" character varying NOT NULL DEFAULT 'primary', "connected_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_bf9c27178d3e0d415d076f46e38" PRIMARY KEY ("user_id"))`);
        await queryRunner.query(`ALTER TABLE "visits" ADD "google_event_id" character varying`);
        await queryRunner.query(`ALTER TABLE "visits" ADD "google_calendar_owner_id" uuid`);
        await queryRunner.query(`ALTER TABLE "google_calendar_links" ADD CONSTRAINT "FK_bf9c27178d3e0d415d076f46e38" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "google_calendar_links" DROP CONSTRAINT "FK_bf9c27178d3e0d415d076f46e38"`);
        await queryRunner.query(`ALTER TABLE "visits" DROP COLUMN "google_calendar_owner_id"`);
        await queryRunner.query(`ALTER TABLE "visits" DROP COLUMN "google_event_id"`);
        await queryRunner.query(`DROP TABLE "google_calendar_links"`);
    }

}
