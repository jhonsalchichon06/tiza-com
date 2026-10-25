CREATE TYPE "public"."estado_uso_credito" AS ENUM('reservado', 'consumido', 'devuelto');--> statement-breakpoint
CREATE TABLE "creditos_horas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" text NOT NULL,
	"reserva_origen_id" uuid NOT NULL,
	"horas_iniciales" numeric(4, 1) NOT NULL,
	"horas_disponibles" numeric(4, 1) NOT NULL,
	"vence_en" timestamp with time zone NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creditos_horas_iniciales_positivas" CHECK ("creditos_horas"."horas_iniciales" > 0),
	CONSTRAINT "creditos_horas_disponibles_en_rango" CHECK ("creditos_horas"."horas_disponibles" >= 0 AND "creditos_horas"."horas_disponibles" <= "creditos_horas"."horas_iniciales"),
	CONSTRAINT "creditos_horas_medias_horas" CHECK (mod("creditos_horas"."horas_iniciales" * 2, 1) = 0 AND mod("creditos_horas"."horas_disponibles" * 2, 1) = 0)
);
--> statement-breakpoint
CREATE TABLE "usos_credito" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credito_id" uuid NOT NULL,
	"reserva_destino_id" uuid NOT NULL,
	"horas" numeric(4, 1) NOT NULL,
	"estado" "estado_uso_credito" NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usos_credito_horas_positivas" CHECK ("usos_credito"."horas" > 0 AND mod("usos_credito"."horas" * 2, 1) = 0)
);
--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "cancelada_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creditos_horas" ADD CONSTRAINT "creditos_horas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creditos_horas" ADD CONSTRAINT "creditos_horas_reserva_origen_id_reservas_id_fk" FOREIGN KEY ("reserva_origen_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usos_credito" ADD CONSTRAINT "usos_credito_credito_id_creditos_horas_id_fk" FOREIGN KEY ("credito_id") REFERENCES "public"."creditos_horas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usos_credito" ADD CONSTRAINT "usos_credito_reserva_destino_id_reservas_id_fk" FOREIGN KEY ("reserva_destino_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creditos_un_lote_por_cancelacion" ON "creditos_horas" USING btree ("reserva_origen_id");--> statement-breakpoint
CREATE INDEX "creditos_horas_usuario_vence_idx" ON "creditos_horas" USING btree ("usuario_id","vence_en");--> statement-breakpoint
CREATE UNIQUE INDEX "usos_credito_un_uso_por_lote_y_reserva" ON "usos_credito" USING btree ("credito_id","reserva_destino_id");--> statement-breakpoint
CREATE INDEX "usos_credito_reserva_destino_idx" ON "usos_credito" USING btree ("reserva_destino_id");--> statement-breakpoint
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_cancelada_en_coherente" CHECK ("reservas"."cancelada_en" IS NULL OR "reservas"."estado" = 'cancelada');--> statement-breakpoint
-- Relleno: la fecha de cancelación de las reservas ya canceladas (único dato disponible es `actualizada_en`).
UPDATE "reservas" SET "cancelada_en" = "actualizada_en" WHERE "estado" = 'cancelada' AND "cancelada_en" IS NULL;--> statement-breakpoint
-- recuperar-creditos
-- Recupera las cancelaciones del cliente con el pago aprobado que el ítem 12 dejó sin crédito (ADR 0012). Es la misma
-- condición que `generarCreditoDeCancelacion`, sin el filtro por reserva. Idempotente: el índice único de la reserva de origen
-- hace que una segunda ejecución no cree nada. El vencimiento sale de `configuracion`, no de un número escrito aquí.
INSERT INTO "creditos_horas" ("usuario_id", "reserva_origen_id", "horas_iniciales", "horas_disponibles", "vence_en")
SELECT r."usuario_id", r."id", r."horas_trabajo" - r."horas_gratis_aplicadas" - r."credito_aplicado", r."horas_trabajo" - r."horas_gratis_aplicadas" - r."credito_aplicado",
  r."cancelada_en" + make_interval(months => (SELECT ("valor" #>> '{}')::int FROM "configuracion" WHERE "clave" = 'credito_vence_meses'))
FROM "reservas" r
JOIN "pagos" p ON p."id" = r."pago_id"
WHERE r."estado" = 'cancelada' AND r."cancelada_por" = 'cliente' AND r."cancelada_en" IS NOT NULL AND p."estado" = 'aprobado'
  AND r."horas_trabajo" - r."horas_gratis_aplicadas" - r."credito_aplicado" > 0
ON CONFLICT ("reserva_origen_id") DO NOTHING;
