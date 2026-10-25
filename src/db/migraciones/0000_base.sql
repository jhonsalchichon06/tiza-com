CREATE TABLE "configuracion" (
	"clave" varchar(100) PRIMARY KEY NOT NULL,
	"valor" jsonb NOT NULL,
	"provisional" boolean DEFAULT false NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipos" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "equipos_nombre_unique" UNIQUE("nombre")
);
