import { MigrationInterface, QueryRunner } from "typeorm";

export class Alquileres1792069260533 implements MigrationInterface {
    name = 'Alquileres1792069260533'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."rental_contracts_currency_enum" AS ENUM('ARS', 'USD')`);
        await queryRunner.query(`CREATE TYPE "public"."rental_contracts_adjustment_index_enum" AS ENUM('icl', 'ipc', 'fijo', 'ninguno')`);
        await queryRunner.query(`CREATE TYPE "public"."rental_contracts_status_enum" AS ENUM('activo', 'finalizado', 'rescindido')`);
        await queryRunner.query(`CREATE TABLE "rental_contracts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_name" character varying NOT NULL, "tenant_phone" character varying, "tenant_email" character varying, "tenant_document" character varying, "owner_name" character varying NOT NULL, "owner_phone" character varying, "owner_email" character varying, "start_date" date NOT NULL, "end_date" date NOT NULL, "currency" "public"."rental_contracts_currency_enum" NOT NULL DEFAULT 'ARS', "initial_rent" numeric(14,2) NOT NULL, "current_rent" numeric(14,2) NOT NULL, "payment_due_day" smallint NOT NULL DEFAULT '10', "deposit" numeric(14,2), "admin_fee_pct" numeric(5,2), "adjustment_index" "public"."rental_contracts_adjustment_index_enum" NOT NULL DEFAULT 'icl', "adjustment_every_months" smallint NOT NULL DEFAULT '12', "fixed_rate_pct" numeric(6,2), "last_adjustment_date" date NOT NULL, "next_adjustment_date" date, "status" "public"."rental_contracts_status_enum" NOT NULL DEFAULT 'activo', "notes" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "property_id" uuid NOT NULL, CONSTRAINT "PK_7c28b11bd077460e3e9ff2590c0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9c96614dddc5a93186eff14989" ON "rental_contracts" ("property_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_1a51073ddc8615ba1b02c1ff68" ON "rental_contracts" ("next_adjustment_date") `);
        await queryRunner.query(`CREATE INDEX "IDX_8644796b3ba3a3094046773fb8" ON "rental_contracts" ("status") `);
        await queryRunner.query(`CREATE TABLE "rental_payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "period" date NOT NULL, "amount" numeric(14,2) NOT NULL, "paid_at" date NOT NULL, "method" character varying, "notes" text, "author_name" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "contract_id" uuid NOT NULL, CONSTRAINT "PK_200f1e68872f8e4272c35f76d52" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7968a0645a1204604a987908c5" ON "rental_payments" ("contract_id", "period") `);
        await queryRunner.query(`CREATE TYPE "public"."rental_adjustments_index_enum" AS ENUM('icl', 'ipc', 'fijo', 'ninguno')`);
        await queryRunner.query(`CREATE TABLE "rental_adjustments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "effective_date" date NOT NULL, "previous_rent" numeric(14,2) NOT NULL, "new_rent" numeric(14,2) NOT NULL, "factor" numeric(12,6) NOT NULL, "index" "public"."rental_adjustments_index_enum" NOT NULL, "detail" jsonb, "author_name" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "contract_id" uuid NOT NULL, CONSTRAINT "PK_7c6eb5c857d4f0d853e1fa26f46" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_fad9d749a6f468b2e8c355b485" ON "rental_adjustments" ("contract_id") `);
        await queryRunner.query(`CREATE TYPE "public"."index_values_index_enum" AS ENUM('icl', 'ipc')`);
        await queryRunner.query(`CREATE TABLE "index_values" ("index" "public"."index_values_index_enum" NOT NULL, "date" date NOT NULL, "value" numeric(18,6) NOT NULL, "source" character varying NOT NULL DEFAULT 'manual', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_036dbb2cadaa9a9bdd388ae25d8" PRIMARY KEY ("index", "date"))`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "contract_id" uuid`);
        await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum" RENAME TO "notifications_type_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."notifications_type_enum" AS ENUM('visita_por_confirmar', 'cliente_esperando', 'lead_caliente', 'lead_asignado', 'alquiler_ajuste', 'alquiler_vence', 'alquiler_deuda')`);
        await queryRunner.query(`ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "public"."notifications_type_enum" USING "type"::"text"::"public"."notifications_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."notifications_type_enum_old"`);
        await queryRunner.query(`CREATE INDEX "IDX_8852edaca0c3cb1866e16db64c" ON "notifications" ("contract_id") `);
        await queryRunner.query(`ALTER TABLE "rental_contracts" ADD CONSTRAINT "FK_9c96614dddc5a93186eff149890" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "rental_payments" ADD CONSTRAINT "FK_0a5c5f151dc25a181b59e2ebef9" FOREIGN KEY ("contract_id") REFERENCES "rental_contracts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "rental_adjustments" ADD CONSTRAINT "FK_fad9d749a6f468b2e8c355b4854" FOREIGN KEY ("contract_id") REFERENCES "rental_contracts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "rental_adjustments" DROP CONSTRAINT "FK_fad9d749a6f468b2e8c355b4854"`);
        await queryRunner.query(`ALTER TABLE "rental_payments" DROP CONSTRAINT "FK_0a5c5f151dc25a181b59e2ebef9"`);
        await queryRunner.query(`ALTER TABLE "rental_contracts" DROP CONSTRAINT "FK_9c96614dddc5a93186eff149890"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8852edaca0c3cb1866e16db64c"`);
        await queryRunner.query(`CREATE TYPE "public"."notifications_type_enum_old" AS ENUM('visita_por_confirmar', 'cliente_esperando', 'lead_caliente', 'lead_asignado')`);
        await queryRunner.query(`ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "public"."notifications_type_enum_old" USING "type"::"text"::"public"."notifications_type_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."notifications_type_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum_old" RENAME TO "notifications_type_enum"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "contract_id"`);
        await queryRunner.query(`DROP TABLE "index_values"`);
        await queryRunner.query(`DROP TYPE "public"."index_values_index_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fad9d749a6f468b2e8c355b485"`);
        await queryRunner.query(`DROP TABLE "rental_adjustments"`);
        await queryRunner.query(`DROP TYPE "public"."rental_adjustments_index_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7968a0645a1204604a987908c5"`);
        await queryRunner.query(`DROP TABLE "rental_payments"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8644796b3ba3a3094046773fb8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1a51073ddc8615ba1b02c1ff68"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9c96614dddc5a93186eff14989"`);
        await queryRunner.query(`DROP TABLE "rental_contracts"`);
        await queryRunner.query(`DROP TYPE "public"."rental_contracts_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."rental_contracts_adjustment_index_enum"`);
        await queryRunner.query(`DROP TYPE "public"."rental_contracts_currency_enum"`);
    }

}
