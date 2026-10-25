import { auth as authPorDefecto, type Auth } from "./auth";
import { ErrorApi, manejar } from "./errores";
import { aUsuario, requerirSesion } from "./sesion";
import { esquemaInicio, esquemaOlvide, esquemaRegistro, esquemaRestablecer, traducirErrorAuth, validar } from "./validacion-sesion";

// Las rutas que cambian estado solo aceptan JSON: un formulario de otro sitio no puede enviarlo sin CORS.
function exigirJson(req: Request) {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ErrorApi(415, "tipo_no_soportado", "Envía los datos en formato JSON.");
  }
}

async function leerJson(req: Request): Promise<unknown> {
  exigirJson(req);
  try {
    return await req.json();
  } catch {
    throw ErrorApi.invalido("Los datos enviados no son válidos.");
  }
}

// Copia las cookies que generó Better Auth a nuestra respuesta.
function conCookies(respuesta: Response, cabeceras: Headers): Response {
  for (const cookie of cabeceras.getSetCookie()) respuesta.headers.append("set-cookie", cookie);
  return respuesta;
}

async function llamar<T>(operacion: () => Promise<T>): Promise<T> {
  try {
    return await operacion();
  } catch (error) {
    throw traducirErrorAuth(error);
  }
}

export const MENSAJE_OLVIDE = "Si el correo tiene una cuenta, te enviamos un enlace para restablecer tu contraseña.";

export function crearRutasSesion(a: () => Auth = authPorDefecto) {
  const registro = manejar(async (req: Request) => {
    const datos = validar(esquemaRegistro, await leerJson(req));
    const { headers, response } = await llamar(() =>
      a().api.signUpEmail({
        body: { email: datos.correo, password: datos.contrasena, name: datos.nombre, telefono: datos.celular },
        headers: req.headers,
        returnHeaders: true,
      }),
    );
    return conCookies(Response.json({ usuario: aUsuario(response.user) }, { status: 201 }), headers);
  });

  const iniciar = manejar(async (req: Request) => {
    const datos = validar(esquemaInicio, await leerJson(req));
    const { headers, response } = await llamar(() =>
      a().api.signInEmail({
        body: { email: datos.correo, password: datos.contrasena },
        headers: req.headers,
        returnHeaders: true,
      }),
    );
    return conCookies(Response.json({ usuario: aUsuario(response.user) }), headers);
  });

  const actual = manejar(async (req: Request) => {
    return Response.json({ usuario: await requerirSesion(req.headers, a()) });
  });

  const cerrar = manejar(async (req: Request) => {
    exigirJson(req);
    const sinCookie = new Response(null, { status: 204 });
    if (!(await a().api.getSession({ headers: req.headers }))) return sinCookie;
    const { headers } = await a().api.signOut({ headers: req.headers, returnHeaders: true });
    return conCookies(sinCookie, headers);
  });

  // Misma respuesta exista o no la cuenta; el correo sale después, sin que la respuesta lo espere.
  const olvide = manejar(async (req: Request) => {
    const datos = validar(esquemaOlvide, await leerJson(req));
    await llamar(() => a().api.requestPasswordReset({ body: { email: datos.correo } }));
    return Response.json({ mensaje: MENSAJE_OLVIDE });
  });

  // No inicia sesión: la persona entra después con su contraseña nueva.
  const restablecer = manejar(async (req: Request) => {
    const datos = validar(esquemaRestablecer, await leerJson(req));
    await llamar(() => a().api.resetPassword({ body: { token: datos.token, newPassword: datos.contrasena } }));
    return Response.json({ ok: true });
  });

  return { registro, iniciar, actual, cerrar, olvide, restablecer };
}
