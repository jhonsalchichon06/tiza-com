INSERT INTO "configuracion" ("clave", "valor", "provisional") VALUES ('renovacion_aviso_dias', '14', true) ON CONFLICT ("clave") DO NOTHING;
