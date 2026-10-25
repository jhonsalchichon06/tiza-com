CREATE TYPE "public"."estado_resena" AS ENUM('pendiente', 'aprobada', 'rechazada');--> statement-breakpoint
CREATE TABLE "resenas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reserva_id" uuid NOT NULL,
	"estrellas" smallint NOT NULL,
	"comentario" text NOT NULL,
	"estado" "estado_resena" DEFAULT 'pendiente' NOT NULL,
	"revisada_por" text,
	"revisada_en" timestamp with time zone,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizada_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resenas_reserva_id_unique" UNIQUE("reserva_id"),
	CONSTRAINT "resenas_estrellas_entre_1_y_5" CHECK ("resenas"."estrellas" BETWEEN 1 AND 5),
	CONSTRAINT "resenas_revision_coherente" CHECK (("resenas"."estado" = 'pendiente' AND "resenas"."revisada_por" IS NULL AND "resenas"."revisada_en" IS NULL) OR ("resenas"."estado" <> 'pendiente' AND "resenas"."revisada_por" IS NOT NULL AND "resenas"."revisada_en" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "resenas" ADD CONSTRAINT "resenas_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resenas" ADD CONSTRAINT "resenas_revisada_por_usuarios_id_fk" FOREIGN KEY ("revisada_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resenas_aprobadas_idx" ON "resenas" USING btree ("revisada_en" DESC NULLS LAST) WHERE "resenas"."estado" = 'aprobada';--> statement-breakpoint
CREATE INDEX "resenas_pendientes_idx" ON "resenas" USING btree ("creada_en") WHERE "resenas"."estado" = 'pendiente';