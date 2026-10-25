CREATE TABLE "fotos_servicio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reserva_id" uuid NOT NULL,
	"ambiente" text NOT NULL,
	"ruta" text NOT NULL,
	"subida_por" text NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fotos_servicio_ruta_unique" UNIQUE("ruta")
);
--> statement-breakpoint
ALTER TABLE "fotos_servicio" ADD CONSTRAINT "fotos_servicio_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fotos_servicio" ADD CONSTRAINT "fotos_servicio_subida_por_usuarios_id_fk" FOREIGN KEY ("subida_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fotos_servicio_reserva_idx" ON "fotos_servicio" USING btree ("reserva_id","creada_en");--> statement-breakpoint
INSERT INTO "configuracion" ("clave", "valor", "provisional") VALUES ('fotos_maximas_por_reserva', '12', true) ON CONFLICT ("clave") DO NOTHING;
