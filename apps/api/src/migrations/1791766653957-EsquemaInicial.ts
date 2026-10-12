import { MigrationInterface, QueryRunner } from "typeorm";

/** Esquema completo al 2026-10-11 (generado contra una base vacía). Las extensiones no se borran en down(). */
export class EsquemaInicial1791766653957 implements MigrationInterface {
    name = 'EsquemaInicial1791766653957'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // En Docker las crea db/init; en una base administrada (RDS, Neon, Supabase...) hay que crearlas acá.
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TYPE "public"."chat_history_channel_enum" AS ENUM('whatsapp', 'web')`);
        await queryRunner.query(`CREATE TYPE "public"."chat_history_role_enum" AS ENUM('user', 'assistant', 'agent', 'system')`);
        await queryRunner.query(`CREATE TABLE "chat_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "channel" "public"."chat_history_channel_enum" NOT NULL DEFAULT 'whatsapp', "role" "public"."chat_history_role_enum" NOT NULL, "content" text NOT NULL, "author_name" character varying, "external_message_id" character varying, "extractedData" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "lead_id" uuid, CONSTRAINT "PK_cf76a7693b0b075dd86ea05f21d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_4a378be70fe027c4c71a5fe16f" ON "chat_history" ("external_message_id") WHERE "external_message_id" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_8b968556d22568d89b327e44b4" ON "chat_history" ("lead_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "avo_predictions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "estimated_price_usd" numeric(14,2) NOT NULL, "price_per_m2_usd" numeric(10,2) NOT NULL, "range_low_usd" numeric(14,2) NOT NULL, "range_high_usd" numeric(14,2) NOT NULL, "projected_price_3y_usd" numeric(14,2) NOT NULL, "appreciation_3y_pct" numeric(6,2) NOT NULL, "confidence" real, "model_version" character varying NOT NULL, "input_features" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "property_id" uuid, CONSTRAINT "PK_75531ebd69b04f46c2e42afd549" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3fa9ff3f674874c223f59a5bfb" ON "avo_predictions" ("property_id") `);
        await queryRunner.query(`CREATE TYPE "public"."social_posts_platform_enum" AS ENUM('instagram', 'facebook', 'linkedin', 'tiktok')`);
        await queryRunner.query(`CREATE TYPE "public"."social_posts_format_enum" AS ENUM('imagen', 'carrusel', 'reel', 'video', 'texto')`);
        await queryRunner.query(`CREATE TYPE "public"."social_posts_status_enum" AS ENUM('borrador', 'programado', 'publicado', 'fallido')`);
        await queryRunner.query(`CREATE TABLE "social_posts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "platform" "public"."social_posts_platform_enum" NOT NULL, "format" "public"."social_posts_format_enum" NOT NULL DEFAULT 'imagen', "copy" text NOT NULL, "script" text, "hashtags" jsonb NOT NULL DEFAULT '[]', "media_urls" jsonb NOT NULL DEFAULT '[]', "status" "public"."social_posts_status_enum" NOT NULL DEFAULT 'borrador', "scheduled_at" TIMESTAMP WITH TIME ZONE, "published_at" TIMESTAMP WITH TIME ZONE, "external_id" character varying, "error_message" text, "views" integer NOT NULL DEFAULT '0', "likes" integer NOT NULL DEFAULT '0', "comments" integer NOT NULL DEFAULT '0', "shares" integer NOT NULL DEFAULT '0', "clicks" integer NOT NULL DEFAULT '0', "engagement_rate" real NOT NULL DEFAULT '0', "metrics_updated_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "property_id" uuid, CONSTRAINT "PK_2161864ea79f14525b8804bd7ff" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e9dc9ba712da5978b6edef1b67" ON "social_posts" ("platform", "status", "scheduled_at") `);
        await queryRunner.query(`CREATE TYPE "public"."properties_type_enum" AS ENUM('departamento', 'casa', 'ph', 'terreno', 'local', 'oficina', 'cochera')`);
        await queryRunner.query(`CREATE TYPE "public"."properties_operation_enum" AS ENUM('venta', 'alquiler')`);
        await queryRunner.query(`CREATE TYPE "public"."properties_status_enum" AS ENUM('disponible', 'reservada', 'vendida', 'pausada')`);
        await queryRunner.query(`CREATE TYPE "public"."properties_fx_source_enum" AS ENUM('blue', 'oficial', 'mep', 'ccl')`);
        await queryRunner.query(`CREATE TABLE "properties" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying NOT NULL, "description" text, "type" "public"."properties_type_enum" NOT NULL, "operation" "public"."properties_operation_enum" NOT NULL DEFAULT 'venta', "status" "public"."properties_status_enum" NOT NULL DEFAULT 'disponible', "address" character varying NOT NULL, "neighborhood" character varying NOT NULL, "city" character varying NOT NULL, "province" character varying NOT NULL, "location" geography(Point,4326), "covered_m2" numeric(10,2) NOT NULL, "total_m2" numeric(10,2) NOT NULL, "rooms" smallint NOT NULL DEFAULT '0', "bedrooms" smallint NOT NULL DEFAULT '0', "bathrooms" smallint NOT NULL DEFAULT '0', "garage_spots" smallint NOT NULL DEFAULT '0', "age_years" smallint, "amenities" jsonb NOT NULL DEFAULT '[]', "photo_urls" jsonb NOT NULL DEFAULT '[]', "price_usd" numeric(14,2) NOT NULL, "price_ars" numeric(18,2) NOT NULL, "fx_rate" numeric(12,4) NOT NULL, "fx_source" "public"."properties_fx_source_enum" NOT NULL DEFAULT 'blue', "fx_rate_date" date NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2d83bfa0b9fcd45dee1785af44d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3bf275be6e923ec03f9757483e" ON "properties" ("neighborhood", "status") `);
        await queryRunner.query(`CREATE INDEX "idx_property_location" ON "properties" USING GiST ("location") `);
        await queryRunner.query(`CREATE TYPE "public"."match_scores_feedback_enum" AS ENUM('pendiente', 'me_gusta', 'no_me_interesa', 'visito')`);
        await queryRunner.query(`CREATE TABLE "match_scores" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "score" real NOT NULL, "breakdown" jsonb NOT NULL, "feedback" "public"."match_scores_feedback_enum" NOT NULL DEFAULT 'pendiente', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "lead_id" uuid, "property_id" uuid, CONSTRAINT "UQ_33786ea51c4b5c6a3987f7d1682" UNIQUE ("lead_id", "property_id"), CONSTRAINT "PK_003d41d32629ae9faf61756c30c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4357748093ba2f33ecb86ea672" ON "match_scores" ("lead_id", "score") `);
        await queryRunner.query(`CREATE TYPE "public"."leads_stage_enum" AS ENUM('nuevo', 'calificado', 'visita_agendada', 'negociacion', 'cerrado', 'perdido')`);
        await queryRunner.query(`CREATE TYPE "public"."leads_temperature_enum" AS ENUM('frio', 'tibio', 'caliente')`);
        await queryRunner.query(`CREATE TYPE "public"."leads_wants_operation_enum" AS ENUM('venta', 'alquiler')`);
        await queryRunner.query(`CREATE TABLE "leads" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "full_name" character varying, "phone" character varying, "email" character varying, "stage" "public"."leads_stage_enum" NOT NULL DEFAULT 'nuevo', "temperature" "public"."leads_temperature_enum" NOT NULL DEFAULT 'frio', "lead_score" smallint NOT NULL DEFAULT '0', "budget_min_usd" numeric(14,2), "budget_max_usd" numeric(14,2), "wants_operation" "public"."leads_wants_operation_enum", "wanted_types" jsonb NOT NULL DEFAULT '[]', "preferred_neighborhoods" jsonb NOT NULL DEFAULT '[]', "min_rooms" smallint, "needs_garage" boolean NOT NULL DEFAULT false, "has_mortgage_approval" boolean, "urgency" real NOT NULL DEFAULT '0', "ai_paused" boolean NOT NULL DEFAULT false, "last_interaction_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cd102ed7a9a4ca7d4d8bfeba406" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_42ebb4366d014febbcfdef39e3" ON "leads" ("phone") `);
        await queryRunner.query(`CREATE TYPE "public"."visits_status_enum" AS ENUM('pendiente', 'confirmada', 'realizada', 'cancelada')`);
        await queryRunner.query(`CREATE TYPE "public"."visits_source_enum" AS ENUM('asistente', 'asesor')`);
        await queryRunner.query(`CREATE TABLE "visits" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "start_at" TIMESTAMP WITH TIME ZONE NOT NULL, "duration_min" smallint NOT NULL DEFAULT '45', "status" "public"."visits_status_enum" NOT NULL DEFAULT 'pendiente', "source" "public"."visits_source_enum" NOT NULL DEFAULT 'asesor', "notes" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "lead_id" uuid NOT NULL, "property_id" uuid NOT NULL, CONSTRAINT "PK_0b0b322289a41015c6ea4e8bf30" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a2d106bcdb7c8d3fb3e38d196f" ON "visits" ("property_id", "start_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_52d4c34d9fa397192f41f93070" ON "visits" ("start_at") `);
        await queryRunner.query(`CREATE TYPE "public"."notifications_type_enum" AS ENUM('visita_por_confirmar', 'cliente_esperando', 'lead_caliente')`);
        await queryRunner.query(`CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "type" "public"."notifications_type_enum" NOT NULL, "title" character varying NOT NULL, "body" text, "lead_id" uuid, "read_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_cceedd22c5bf1ff1b2fb9a4b17" ON "notifications" ("lead_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_8e65b9b251fe92700f350a21b7" ON "notifications" ("read_at", "created_at") `);
        await queryRunner.query(`CREATE TYPE "public"."user_role" AS ENUM('admin', 'agent')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "password_hash" character varying NOT NULL, "full_name" character varying NOT NULL, "role" "public"."user_role" NOT NULL DEFAULT 'agent', "is_active" boolean NOT NULL DEFAULT true, "password_changed_at" TIMESTAMP WITH TIME ZONE, "last_login_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email") `);
        await queryRunner.query(`ALTER TABLE "chat_history" ADD CONSTRAINT "FK_341183039d35776508f28d9cc1f" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "avo_predictions" ADD CONSTRAINT "FK_3fa9ff3f674874c223f59a5bfb4" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "social_posts" ADD CONSTRAINT "FK_a7e124d7ccc8a7d8fedf0c86aba" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "match_scores" ADD CONSTRAINT "FK_5a0597ee73f40060683877230d2" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "match_scores" ADD CONSTRAINT "FK_e301fee24f782e85dbeb829b030" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "visits" ADD CONSTRAINT "FK_bfe7705c583c45fcf8a1d27edd1" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "visits" ADD CONSTRAINT "FK_a930cedb59540f5bed3a25e2cce" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "visits" DROP CONSTRAINT "FK_a930cedb59540f5bed3a25e2cce"`);
        await queryRunner.query(`ALTER TABLE "visits" DROP CONSTRAINT "FK_bfe7705c583c45fcf8a1d27edd1"`);
        await queryRunner.query(`ALTER TABLE "match_scores" DROP CONSTRAINT "FK_e301fee24f782e85dbeb829b030"`);
        await queryRunner.query(`ALTER TABLE "match_scores" DROP CONSTRAINT "FK_5a0597ee73f40060683877230d2"`);
        await queryRunner.query(`ALTER TABLE "social_posts" DROP CONSTRAINT "FK_a7e124d7ccc8a7d8fedf0c86aba"`);
        await queryRunner.query(`ALTER TABLE "avo_predictions" DROP CONSTRAINT "FK_3fa9ff3f674874c223f59a5bfb4"`);
        await queryRunner.query(`ALTER TABLE "chat_history" DROP CONSTRAINT "FK_341183039d35776508f28d9cc1f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."user_role"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8e65b9b251fe92700f350a21b7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cceedd22c5bf1ff1b2fb9a4b17"`);
        await queryRunner.query(`DROP TABLE "notifications"`);
        await queryRunner.query(`DROP TYPE "public"."notifications_type_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_52d4c34d9fa397192f41f93070"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a2d106bcdb7c8d3fb3e38d196f"`);
        await queryRunner.query(`DROP TABLE "visits"`);
        await queryRunner.query(`DROP TYPE "public"."visits_source_enum"`);
        await queryRunner.query(`DROP TYPE "public"."visits_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_42ebb4366d014febbcfdef39e3"`);
        await queryRunner.query(`DROP TABLE "leads"`);
        await queryRunner.query(`DROP TYPE "public"."leads_wants_operation_enum"`);
        await queryRunner.query(`DROP TYPE "public"."leads_temperature_enum"`);
        await queryRunner.query(`DROP TYPE "public"."leads_stage_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4357748093ba2f33ecb86ea672"`);
        await queryRunner.query(`DROP TABLE "match_scores"`);
        await queryRunner.query(`DROP TYPE "public"."match_scores_feedback_enum"`);
        await queryRunner.query(`DROP INDEX "public"."idx_property_location"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3bf275be6e923ec03f9757483e"`);
        await queryRunner.query(`DROP TABLE "properties"`);
        await queryRunner.query(`DROP TYPE "public"."properties_fx_source_enum"`);
        await queryRunner.query(`DROP TYPE "public"."properties_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."properties_operation_enum"`);
        await queryRunner.query(`DROP TYPE "public"."properties_type_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e9dc9ba712da5978b6edef1b67"`);
        await queryRunner.query(`DROP TABLE "social_posts"`);
        await queryRunner.query(`DROP TYPE "public"."social_posts_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."social_posts_format_enum"`);
        await queryRunner.query(`DROP TYPE "public"."social_posts_platform_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3fa9ff3f674874c223f59a5bfb"`);
        await queryRunner.query(`DROP TABLE "avo_predictions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8b968556d22568d89b327e44b4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4a378be70fe027c4c71a5fe16f"`);
        await queryRunner.query(`DROP TABLE "chat_history"`);
        await queryRunner.query(`DROP TYPE "public"."chat_history_role_enum"`);
        await queryRunner.query(`DROP TYPE "public"."chat_history_channel_enum"`);
    }

}
