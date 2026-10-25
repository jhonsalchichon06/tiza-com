CREATE TYPE "public"."quien_cancela" AS ENUM('cliente', 'admin');--> statement-breakpoint
ALTER TYPE "public"."estado_membresia" ADD VALUE 'caducada';--> statement-breakpoint
ALTER TABLE "membresias" DROP CONSTRAINT "membresias_estado_y_fechas";--> statement-breakpoint
ALTER TABLE "pagos" ADD COLUMN "motivo_rechazo" text;--> statement-breakpoint
ALTER TABLE "pagos" ADD COLUMN "reemplaza_a" uuid;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "cancelada_por" "quien_cancela";--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_reemplaza_a_pagos_id_fk" FOREIGN KEY ("reemplaza_a") REFERENCES "public"."pagos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pagos_un_reemplazo_por_pago" ON "pagos" USING btree ("reemplaza_a") WHERE "pagos"."reemplaza_a" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pagos_pendientes_idx" ON "pagos" USING btree ("creado_en") WHERE "pagos"."estado" = 'pendiente';--> statement-breakpoint
ALTER TABLE "membresias" ADD CONSTRAINT "membresias_estado_y_fechas" CHECK (("membresias"."estado" = 'activa' AND "membresias"."inicio" IS NOT NULL AND "membresias"."fin" IS NOT NULL AND "membresias"."fin" > "membresias"."inicio") OR ("membresias"."estado" <> 'activa' AND "membresias"."inicio" IS NULL AND "membresias"."fin" IS NULL));--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_motivo_rechazo_corto" CHECK (char_length("pagos"."motivo_rechazo") <= 200);--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_revision_coherente" CHECK (("pagos"."estado" = 'pendiente' AND "pagos"."revisado_por" IS NULL AND "pagos"."revisado_en" IS NULL) OR "pagos"."estado" = 'aprobado' OR ("pagos"."estado" = 'rechazado' AND "pagos"."revisado_por" IS NOT NULL AND "pagos"."revisado_en" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_cancelada_por_coherente" CHECK ("reservas"."cancelada_por" IS NULL OR "reservas"."estado" = 'cancelada');--> statement-breakpoint
INSERT INTO "configuracion" ("clave", "valor", "provisional") VALUES ('reenvio_comprobante_dias', '7', false) ON CONFLICT ("clave") DO NOTHING;
