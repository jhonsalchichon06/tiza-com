CREATE TYPE "public"."concepto_pago" AS ENUM('membresia', 'reserva', 'membresia_y_reserva');--> statement-breakpoint
CREATE TYPE "public"."estado_membresia" AS ENUM('pendiente', 'activa');--> statement-breakpoint
CREATE TYPE "public"."estado_pago" AS ENUM('pendiente', 'aprobado', 'rechazado');--> statement-breakpoint
CREATE TYPE "public"."metodo_pago" AS ENUM('yape', 'transferencia', 'credito');--> statement-breakpoint
CREATE TABLE "membresias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" text NOT NULL,
	"monto" integer NOT NULL,
	"estado" "estado_membresia" NOT NULL,
	"inicio" timestamp with time zone,
	"fin" timestamp with time zone,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membresias_monto_positivo" CHECK ("membresias"."monto" > 0),
	CONSTRAINT "membresias_estado_y_fechas" CHECK (("membresias"."estado" = 'pendiente' AND "membresias"."inicio" IS NULL AND "membresias"."fin" IS NULL) OR ("membresias"."estado" = 'activa' AND "membresias"."inicio" IS NOT NULL AND "membresias"."fin" IS NOT NULL AND "membresias"."fin" > "membresias"."inicio"))
);
--> statement-breakpoint
CREATE TABLE "pagos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" text NOT NULL,
	"concepto" "concepto_pago" NOT NULL,
	"membresia_id" uuid,
	"monto" integer NOT NULL,
	"metodo" "metodo_pago" NOT NULL,
	"comprobante_ruta" text,
	"estado" "estado_pago" DEFAULT 'pendiente' NOT NULL,
	"revisado_por" text,
	"revisado_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pagos_monto_no_negativo" CHECK ("pagos"."monto" >= 0),
	CONSTRAINT "pagos_membresia_si_concepto" CHECK ("pagos"."concepto" = 'reserva' OR "pagos"."membresia_id" IS NOT NULL),
	CONSTRAINT "pagos_comprobante_si_no_credito" CHECK ("pagos"."metodo" = 'credito' OR "pagos"."comprobante_ruta" IS NOT NULL),
	CONSTRAINT "pagos_credito_sin_monto" CHECK ("pagos"."metodo" <> 'credito' OR "pagos"."monto" = 0)
);
--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "membresia_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "pago_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "membresias" ADD CONSTRAINT "membresias_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_membresia_id_membresias_id_fk" FOREIGN KEY ("membresia_id") REFERENCES "public"."membresias"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_revisado_por_usuarios_id_fk" FOREIGN KEY ("revisado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "membresias_una_pendiente_por_cliente" ON "membresias" USING btree ("usuario_id") WHERE "membresias"."estado" = 'pendiente';--> statement-breakpoint
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_membresia_id_membresias_id_fk" FOREIGN KEY ("membresia_id") REFERENCES "public"."membresias"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_pago_id_pagos_id_fk" FOREIGN KEY ("pago_id") REFERENCES "public"."pagos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reservas_un_pago_por_reserva_viva" ON "reservas" USING btree ("pago_id") WHERE "reservas"."estado" IN ('pendiente', 'confirmada', 'completada');--> statement-breakpoint
CREATE UNIQUE INDEX "reservas_una_pendiente_por_cliente" ON "reservas" USING btree ("usuario_id") WHERE "reservas"."estado" = 'pendiente';