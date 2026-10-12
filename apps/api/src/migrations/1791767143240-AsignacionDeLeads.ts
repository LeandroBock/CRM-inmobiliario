import { MigrationInterface, QueryRunner } from "typeorm";

/** Leads con asesor a cargo y avisos por destinatario. */
export class AsignacionDeLeads1791767143240 implements MigrationInterface {
    name = 'AsignacionDeLeads1791767143240'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "leads" ADD "assigned_user_id" uuid`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "user_id" uuid`);
        await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum" RENAME TO "notifications_type_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."notifications_type_enum" AS ENUM('visita_por_confirmar', 'cliente_esperando', 'lead_caliente', 'lead_asignado')`);
        await queryRunner.query(`ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "public"."notifications_type_enum" USING "type"::"text"::"public"."notifications_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."notifications_type_enum_old"`);
        await queryRunner.query(`CREATE INDEX "IDX_9a8a82462cab47c73d25f49261" ON "notifications" ("user_id") `);
        await queryRunner.query(`ALTER TABLE "leads" ADD CONSTRAINT "FK_d498960c2aae4c9bacb68afb23c" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "leads" DROP CONSTRAINT "FK_d498960c2aae4c9bacb68afb23c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9a8a82462cab47c73d25f49261"`);
        // El enum anterior no tiene "lead_asignado": esos avisos no pueden volver atrás.
        await queryRunner.query(`DELETE FROM "notifications" WHERE "type" = 'lead_asignado'`);
        await queryRunner.query(`CREATE TYPE "public"."notifications_type_enum_old" AS ENUM('visita_por_confirmar', 'cliente_esperando', 'lead_caliente')`);
        await queryRunner.query(`ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "public"."notifications_type_enum_old" USING "type"::"text"::"public"."notifications_type_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."notifications_type_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum_old" RENAME TO "notifications_type_enum"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "user_id"`);
        await queryRunner.query(`ALTER TABLE "leads" DROP COLUMN "assigned_user_id"`);
    }

}
