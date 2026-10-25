const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Sin esta comprobación, un id como `abc` llega a Postgres como uuid inválido (22P02) y la ruta responde 500 en vez de 404.
export const esUuid = (valor: unknown): valor is string => typeof valor === "string" && FORMATO_UUID.test(valor);
