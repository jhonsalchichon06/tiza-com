-- Extensión para las restricciones de exclusión por equipo sobre rangos de tiempo (ADR 0002 y 0007).
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
-- Parámetros del negocio (PRD, secciones 2 a 4; ADR 0008). Montos en céntimos.
-- provisional = true: pendiente de confirmar en el PRD (comentarios REVISAR).
-- ON CONFLICT DO NOTHING: volver a aplicarla no pisa un parámetro editado después.
INSERT INTO "configuracion" ("clave", "valor", "provisional") VALUES
	('niveles_hogar', '[{"max_dormitorios":0,"max_banos":1,"horas":2},{"max_dormitorios":1,"max_banos":1,"horas":3},{"max_dormitorios":2,"max_banos":2,"horas":4},{"max_dormitorios":null,"max_banos":null,"horas":6}]', false),
	('precios_niveles', '[6600,9900,12900,18900]', true),
	('horas_extra_tipo', '{"estandar":0,"profunda":1,"mudanza":2}', false),
	('multiplicadores_precio', '{"estandar":1,"profunda":1.5,"mudanza":1.7}', true),
	('paquetes_horas', '[{"horas":3,"precio":9900},{"horas":4,"precio":12900},{"horas":6,"precio":18900},{"horas":8,"precio":23900}]', true),
	('apoyo_extra', '{"umbral_horas":6,"factor_agenda":0.5}', false),
	('membresia_precio_mensual', '8900', true),
	('membresia_meses', '3', false),
	('horas_gratis', '3', false),
	('descuento_miembro', '0.1', false),
	('anticipacion_minima_horas', '48', false),
	('espera_pago_horas', '24', false),
	('traslado_horas', '1', false),
	('intervalo_horarios_minutos', '30', false),
	('credito_vence_meses', '3', false),
	('horario_atencion', '{"dias":[1,2,3,4,5,6],"apertura":"08:00","cierre":"18:00","zona":"America/Lima"}', false)
ON CONFLICT ("clave") DO NOTHING;
--> statement-breakpoint
-- Capacidad inicial: 2 limpiezas al mismo tiempo (ADR 0007).
INSERT INTO "equipos" ("nombre") VALUES ('Equipo 1'), ('Equipo 2')
ON CONFLICT ("nombre") DO NOTHING;
