INSERT INTO "configuracion" ("clave", "valor", "provisional") VALUES ('cancelacion_minima_horas', '24', false) ON CONFLICT ("clave") DO NOTHING;
