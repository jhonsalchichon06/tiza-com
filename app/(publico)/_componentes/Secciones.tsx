import Link from "next/link";
import type { Catalogo } from "@/lib/catalogo-publico";
import type { Pregunta } from "@/lib/preguntas";
import e from "../landing.module.css";

// Secciones síncronas de la landing: reciben el catálogo ya calculado desde `configuracion` (ADR 0008).
// Ninguna cifra de dinero, horas o porcentaje se escribe aquí.

const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function Hero({ catalogo }: { catalogo: Catalogo }) {
  return (
    <section className={e.hero}>
      <div className={`${e.wrap} ${e.heroIn}`}>
        <div>
          <p className={e.pill}>🇵🇪 Hecho en Lima, para Lima</p>
          <h1>Tu casa limpia, sin que levantes un dedo.</h1>
          <p className={e.lead}>
            Activa <b>Tiza Club</b> y las <b>primeras {catalogo.horasGratisTexto} de limpieza son gratis</b>. Reserva en línea, con
            personal propio y precio claro en soles.
          </p>
          <form className={e.start} method="get" action="/reservar">
            <label>
              <span>Tu distrito</span>
              <select name="distrito" defaultValue="">
                <option value="">Elige tu distrito…</option>
                {catalogo.distritos.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>¿Qué necesitas?</span>
              <select name="tipo" defaultValue="estandar">
                <option value="estandar">Limpieza estándar</option>
                <option value="profunda">Limpieza profunda</option>
                <option value="mudanza">Limpieza de mudanza</option>
                <option value="horas">Por horas</option>
              </select>
            </label>
            <button className={`${e.btn} ${e.btnLg}`} type="submit">
              Ver mi precio →
            </button>
          </form>
          <p className={e.fine}>Precio claro en soles · Pagas por adelantado con Yape o transferencia</p>
          <p className={e.rating}>
            <span>
              <strong>Personal propio</strong> · {catalogo.distritos.length} distritos de Lima
            </span>
          </p>
        </div>
        <div className={e.heroImg}>
          <img src="/assets/hero.svg" alt="Profesional de Tiza limpiando una sala" width={600} height={560} />
          <div className={e.sticker}>
            Primeras {catalogo.horasGratisTexto}
            <br />
            <b>GRATIS</b>
            <small>con Tiza Club</small>
          </div>
          <div className={`${e.float} ${e.floatB}`}>
            <span>✔</span> {mayuscula(catalogo.horario)}
          </div>
        </div>
      </div>
    </section>
  );
}

export function Franja({ catalogo }: { catalogo: Catalogo }) {
  return (
    <section className={e.strip}>
      <div className={`${e.wrap} ${e.stripIn}`}>
        <span>
          ✔ Pagas con <b>Yape</b>
        </span>
        <span>
          ✔ <b>Transferencia</b> bancaria
        </span>
        <span>✔ {mayuscula(catalogo.horario)}</span>
        <span>✔ Personal propio</span>
      </div>
    </section>
  );
}

export function ComoFunciona({ catalogo }: { catalogo: Catalogo }) {
  return (
    <section className={e.sec} id="como-funciona">
      <div className={e.wrap}>
        <h2 className={e.secT}>Reservar es tan fácil como pedir un delivery</h2>
        <div className={e.steps}>
          <article>
            <span className={e.n}>1</span>
            <h3>Cotiza</h3>
            <p>Dinos tu distrito y el tamaño de tu casa, o elige cuántas horas necesitas.</p>
          </article>
          <article>
            <span className={e.n}>2</span>
            <h3>Elige el día</h3>
            <p>Escoge fecha y hora. Atendemos {catalogo.horario}.</p>
          </article>
          <article>
            <span className={e.n}>3</span>
            <h3>Relájate</h3>
            <p>Llega tu equipo y tú solo disfrutas de tu casa impecable.</p>
          </article>
        </div>
      </div>
    </section>
  );
}

const SERVICIOS = {
  estandar: {
    nombre: "Limpieza estándar",
    texto: "El mantenimiento de siempre: polvo, pisos, baños, cocina y ventanas interiores.",
    imagen: "/assets/svc-estandar.svg",
    alt: "Balde y trapeador",
  },
  profunda: {
    nombre: "Limpieza profunda",
    texto: "Zócalos, sarro, grasa, puertas y juntas. Ideal para la primera vez o cada cierto tiempo.",
    imagen: "/assets/svc-profunda.svg",
    alt: "Baño limpio y desinfectado",
  },
  mudanza: {
    nombre: "Mudanza",
    texto: "Deja el departamento listo para entregar o recibe tu nuevo hogar impecable.",
    imagen: "/assets/svc-mudanza.svg",
    alt: "Cajas de mudanza",
  },
} as const;

export function Servicios({ catalogo }: { catalogo: Catalogo }) {
  return (
    <section className={`${e.sec} ${e.secAlt}`} id="servicios">
      <div className={e.wrap}>
        <h2 className={e.secT}>Un servicio para cada momento</h2>
        <div className={e.cards}>
          {catalogo.servicios.map((s) => {
            const info = SERVICIOS[s.tipo];
            return (
              <article key={s.tipo} className={`${e.card} ${e.svc}`}>
                <img src={info.imagen} alt={info.alt} width={400} height={260} loading="lazy" />
                <div className={e.svcB}>
                  <h3>{info.nombre}</h3>
                  <p>{info.texto}</p>
                  <Link className={e.link} href={`/reservar?tipo=${s.tipo}`}>
                    Desde {s.desde} →
                  </Link>
                  <p className={e.fine}>Para un hogar pequeño: {s.horas} de trabajo.</p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function Paquetes({ catalogo }: { catalogo: Catalogo }) {
  return (
    <section className={e.sec} id="paquetes">
      <div className={e.wrap}>
        <h2 className={`${e.secT} ${e.secTConSub}`}>¿Prefieres pagar por horas?</h2>
        <p className={e.secS}>Tú decides qué se limpia. Un profesional de Tiza trabaja el tiempo que elijas.</p>
        <div className={e.packs}>
          {catalogo.paquetes.map((p) => (
            <Link
              key={p.horas}
              className={`${e.card} ${e.pack} ${p.mejorPrecio ? e.packHot : ""}`}
              href={`/reservar?tipo=horas&horas=${p.horas}`}
            >
              {p.mejorPrecio ? <span className={e.tag}>Mejor precio por hora</span> : null}
              <span className={e.packH}>{p.horasTexto}</span>
              <strong>{p.precio}</strong>
              <small>{p.precioPorHora} por hora</small>
              <p>{p.descripcion}</p>
              <span className={`${e.btn} ${e.btnSm} ${p.mejorPrecio ? "" : e.btnGhost}`}>Elegir</span>
            </Link>
          ))}
        </div>
        <p className={`${e.fine} ${e.center}`}>
          Con la membresía Tiza Club las primeras {catalogo.horasGratisTexto} de tu primera limpieza son gratis, y las horas
          adicionales y las siguientes visitas tienen {catalogo.descuentoPorcentaje}% de descuento.
        </p>
      </div>
    </section>
  );
}

// Sin ninguna cifra de dinero de la membresía: el monto se muestra al pagar (PRD, REVISAR).
export function Club({ catalogo }: { catalogo: Catalogo }) {
  return (
    <section className={`${e.sec} ${e.secDark}`} id="club">
      <div className={`${e.wrap} ${e.club}`}>
        <div className={e.clubCopy}>
          <span className={`${e.pill} ${e.pillY}`}>Membresía</span>
          <h2>Tiza Club: las primeras {catalogo.horasGratisTexto} van por la casa</h2>
          <p>Activa tu membresía y las primeras {catalogo.horasGratisTexto} de tu primera limpieza son gratis. Después, cada visita cuesta menos.</p>
          <ul className={e.ticks}>
            <li>
              <b>Primeras {catalogo.horasGratisTexto} GRATIS</b> en tu primera limpieza
            </li>
            <li>{catalogo.descuentoPorcentaje}% de descuento en todas tus visitas</li>
            <li>Si cancelas a tiempo, tus horas pagadas quedan como crédito por {catalogo.creditoVigenciaTexto}</li>
          </ul>
        </div>
        <div className={`${e.card} ${e.clubCard}`}>
          <small>Tiza Club</small>
          <h3>{catalogo.membresia.mesesTexto} en un solo pago</h3>
          <p>Pagas por adelantado y eliges tu primera limpieza cuando tú quieras, dentro de la vigencia de tu membresía.</p>
          <Link href="/reservar?club=1" className={`${e.btn} ${e.btnLg}`}>
            Activar con {catalogo.horasGratisTexto} gratis →
          </Link>
          <p className={e.fine}>
            *Las primeras {catalogo.horasGratisTexto} de la primera limpieza son gratis; si tu servicio dura más, pagas solo las horas
            adicionales con {catalogo.descuentoPorcentaje}% de descuento. Una vez por cliente y por hogar; la renovación no incluye horas
            gratis. La membresía no se reembolsa.
          </p>
        </div>
      </div>
    </section>
  );
}

export function Distritos({ catalogo }: { catalogo: Catalogo }) {
  return (
    <section className={e.sec} id="distritos">
      <div className={`${e.wrap} ${e.center}`}>
        <h2 className={`${e.secT} ${e.secTConSub}`}>Llegamos a tu distrito</h2>
        <p className={e.secS}>Por ahora atendemos estos {catalogo.distritos.length} distritos de Lima.</p>
        <div className={e.chips}>
          {catalogo.distritos.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

// La misma lista en la landing y en /preguntas; desplegable sin JavaScript.
export function ListaPreguntas({ preguntas }: { preguntas: Pregunta[] }) {
  return (
    <>
      {preguntas.map((p) => (
        <details key={p.pregunta}>
          <summary>{p.pregunta}</summary>
          <p>{p.respuesta}</p>
        </details>
      ))}
    </>
  );
}

export function LlamadaFinal({ catalogo }: { catalogo: Catalogo }) {
  return (
    <section className={e.cta}>
      <div className={`${e.wrap} ${e.center}`}>
        <h2>Recupera tu fin de semana.</h2>
        <p>Cotiza en línea y reserva con tus primeras {catalogo.horasGratisTexto} gratis.</p>
        <Link href="/reservar?club=1" className={`${e.btn} ${e.btnLight}`}>
          Reservar con {catalogo.horasGratisTexto} gratis
        </Link>
      </div>
    </section>
  );
}
