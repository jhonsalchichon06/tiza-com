CREATE TYPE "public"."estado_apoyo" AS ENUM('por_coordinar', 'coordinado');--> statement-breakpoint
CREATE TYPE "public"."estado_reserva" AS ENUM('pendiente', 'confirmada', 'completada', 'cancelada', 'expirada');--> statement-breakpoint
CREATE TYPE "public"."tipo_servicio" AS ENUM('estandar', 'profunda', 'mudanza', 'paquete');--> statement-breakpoint
CREATE TABLE "reservas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" text NOT NULL,
	"equipo_id" integer NOT NULL,
	"tipo" "tipo_servicio" NOT NULL,
	"dormitorios" smallint,
	"banos" smallint,
	"horas_trabajo" numeric(4, 1) NOT NULL,
	"horas_agenda" numeric(4, 1) NOT NULL,
	"requiere_apoyo" boolean DEFAULT false NOT NULL,
	"apoyo_estado" "estado_apoyo",
	"apoyo_nota" text,
	"distrito" text NOT NULL,
	"calle" text NOT NULL,
	"numero" text NOT NULL,
	"departamento" text,
	"departamento_normalizado" text DEFAULT '' NOT NULL,
	"referencias" text,
	"direccion_normalizada" text NOT NULL,
	"inicio" timestamp with time zone NOT NULL,
	"fin" timestamp with time zone NOT NULL,
	"fin_bloqueo" timestamp with time zone NOT NULL,
	"precio_lista" integer NOT NULL,
	"horas_gratis_aplicadas" numeric(4, 1) DEFAULT '0' NOT NULL,
	"credito_aplicado" numeric(4, 1) DEFAULT '0' NOT NULL,
	"descuento" integer NOT NULL,
	"monto" integer NOT NULL,
	"primera_gratis" boolean DEFAULT false NOT NULL,
	"estado" "estado_reserva" NOT NULL,
	"expira_en" timestamp with time zone,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizada_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservas_fin_posterior_al_inicio" CHECK ("reservas"."fin" > "reservas"."inicio"),
	CONSTRAINT "reservas_bloqueo_no_antes_del_fin" CHECK ("reservas"."fin_bloqueo" >= "reservas"."fin"),
	CONSTRAINT "reservas_pendiente_con_vencimiento" CHECK ("reservas"."estado" <> 'pendiente' OR "reservas"."expira_en" IS NOT NULL),
	CONSTRAINT "reservas_tamano_o_paquete" CHECK (("reservas"."tipo" = 'paquete' AND "reservas"."dormitorios" IS NULL AND "reservas"."banos" IS NULL) OR ("reservas"."tipo" <> 'paquete' AND "reservas"."dormitorios" IS NOT NULL AND "reservas"."banos" IS NOT NULL)),
	CONSTRAINT "reservas_apoyo_coherente" CHECK (("reservas"."requiere_apoyo" AND "reservas"."apoyo_estado" IS NOT NULL) OR (NOT "reservas"."requiere_apoyo" AND "reservas"."apoyo_estado" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_equipo_id_equipos_id_fk" FOREIGN KEY ("equipo_id") REFERENCES "public"."equipos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reservas_inicio_idx" ON "reservas" USING btree ("inicio");--> statement-breakpoint
CREATE INDEX "reservas_expira_en_pendiente_idx" ON "reservas" USING btree ("expira_en") WHERE "reservas"."estado" = 'pendiente';--> statement-breakpoint
-- Capacidad por equipo (ADR 0002, 0007 y 0009): dos reservas activas del mismo equipo no pueden solaparse
-- en su rango bloqueado (servicio + traslado), semiabierto para que empezar justo al terminar sea válido.
-- Solo bloquean `pendiente` y `confirmada`. El WHERE no puede usar now(): una pendiente vencida sigue
-- bloqueando hasta que una escritura la marque `expirada`. drizzle-kit no genera EXCLUDE: va a mano.
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_sin_solape_por_equipo" EXCLUDE USING gist ("equipo_id" WITH =, tstzrange("inicio", "fin_bloqueo", '[)') WITH &&) WHERE ("estado" IN ('pendiente', 'confirmada'));
