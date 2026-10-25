"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AMBIENTES, ETIQUETAS_DE_AMBIENTE } from "@/lib/fotos/ambientes";
import { registrarFotosPorHttp } from "@/lib/fotos/api-cliente";
import { ErrorAlRegistrar, envioUnico, faltaAmbiente, recortarSeleccion, subirLote, type ItemDeFoto } from "@/lib/fotos/subir-lote";
import estilos from "./fotos.module.css";

export const TEXTO_FALTA_AMBIENTE = "Elige el ambiente de cada foto antes de subirlas.";
export const TEXTO_REVISAR_VISTA_PREVIA = "Revisa que cada foto sea de esta limpieza: por ahora no se pueden borrar después de subirlas.";
export const textoRecortado = (sobran: number, caben: number) =>
  `Solo caben ${caben} ${caben === 1 ? "foto más" : "fotos más"} en esta reserva. Dejamos fuera ${sobran}.`;

type Elegida = ItemDeFoto & { previa: string };

type VistaProps = {
  caben: number;
  elegidas: Elegida[];
  fallidas: Record<string, string>;
  progreso: Record<string, number>;
  enviando: boolean;
  mensaje: string | null;
  aviso: string | null;
  pedirAmbiente: boolean;
  onElegir: (archivos: File[]) => void;
  onAmbiente: (clave: string, ambiente: string) => void;
  onQuitar: (clave: string) => void;
  onSubir: () => void;
  onReintentar: (clave: string) => void;
};

// Presentación pura (se prueba con `renderToStaticMarkup`).
export function VistaSubirFotos(p: VistaProps) {
  return (
    <form className={estilos.formulario} onSubmit={(e) => { e.preventDefault(); p.onSubir(); }} noValidate>
      <p className={estilos.cupo}>
        Puedes subir {p.caben} {p.caben === 1 ? "foto más" : "fotos más"} (JPG, PNG o WebP, de hasta 5 MB cada una).
      </p>
      <div className={estilos.campoArchivos}>
        <label htmlFor="archivos-fotos">Elige las fotos</label>
        <input
          id="archivos-fotos"
          className={estilos.entradaArchivos}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={p.enviando}
          onChange={(e) => {
            p.onElegir(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      {p.aviso ? <p className={estilos.nota} role="note">{p.aviso}</p> : null}

      {p.elegidas.length > 0 ? (
        <>
          <p className={estilos.nota} role="note">{TEXTO_REVISAR_VISTA_PREVIA}</p>
          <ul className={estilos.elegidas}>
            {p.elegidas.map((e) => {
              const motivo = p.fallidas[e.clave];
              const avance = p.progreso[e.clave];
              return (
                <li key={e.clave} className={`${estilos.elegida} ${motivo ? estilos.elegidaFallida : ""}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className={estilos.vistaPrevia} src={e.previa} alt={`Vista previa de ${e.archivo.name}`} />
                  <div className={estilos.datosElegida}>
                    <span className={estilos.nombre}>{e.archivo.name}</span>
                    <label className={estilos.campo}>
                      Ambiente
                      <select value={e.ambiente} disabled={p.enviando} required onChange={(ev) => p.onAmbiente(e.clave, ev.target.value)}>
                        <option value="">Elige el ambiente</option>
                        {AMBIENTES.map((a) => (
                          <option key={a} value={a}>
                            {ETIQUETAS_DE_AMBIENTE[a]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {p.enviando && avance !== undefined && !motivo ? <span className={estilos.progreso}>Subiendo… {Math.round(avance)} %</span> : null}
                    {motivo ? <p className={estilos.error} role="alert">{motivo}</p> : null}
                    <div className={estilos.acciones}>
                      {motivo ? (
                        <button type="button" className={estilos.boton} disabled={p.enviando} onClick={() => p.onReintentar(e.clave)}>
                          Reintentar
                        </button>
                      ) : null}
                      <button type="button" className={`${estilos.boton} ${estilos.botonSecundario}`} disabled={p.enviando} onClick={() => p.onQuitar(e.clave)}>
                        Quitar
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {p.pedirAmbiente ? <p className={estilos.error} role="alert">{TEXTO_FALTA_AMBIENTE}</p> : null}
      {p.mensaje ? <p className={estilos.error} role="alert">{p.mensaje}</p> : null}
      <div className={estilos.acciones}>
        <button type="submit" className={estilos.boton} disabled={p.enviando || p.elegidas.length === 0}>
          {p.enviando ? "Subiendo…" : "Subir fotos"}
        </button>
      </div>
    </form>
  );
}

let contador = 0;

// Formulario de subida de varias fotos. Las valida, reduce y sube el navegador directo a Blob (#8); luego UN solo registro. La
// lógica está en `subirLote` (probada con dobles); aquí solo se conecta con el estado de la pantalla. El servidor decide todo.
export function SubirFotos({ reservaId, caben }: { reservaId: string; caben: number }) {
  const router = useRouter();
  const [elegidas, setElegidas] = useState<Elegida[]>([]);
  const [fallidas, setFallidas] = useState<Record<string, string>>({});
  const [progreso, setProgreso] = useState<Record<string, number>>({});
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pedirAmbiente, setPedirAmbiente] = useState(false);
  const actuales = useRef<Elegida[]>([]);
  actuales.current = elegidas;

  // Libera las vistas previas que sigan abiertas al salir de la pantalla.
  useEffect(() => () => actuales.current.forEach((e) => URL.revokeObjectURL(e.previa)), []);

  function elegir(archivos: File[]) {
    setMensaje(null);
    const hueco = caben - actuales.current.length;
    const { aceptados, sobran } = recortarSeleccion(archivos, hueco);
    setAviso(sobran > 0 ? textoRecortado(sobran, caben) : null);
    setElegidas((previas) => [
      ...previas,
      ...aceptados.map((archivo) => ({ clave: `f${++contador}`, archivo, ambiente: "", previa: URL.createObjectURL(archivo) })),
    ]);
  }

  function quitar(clave: string) {
    setElegidas((previas) => {
      previas.filter((e) => e.clave === clave).forEach((e) => URL.revokeObjectURL(e.previa));
      return previas.filter((e) => e.clave !== clave);
    });
    setFallidas(({ [clave]: _fuera, ...resto }) => resto);
  }

  const enviar = useMemo(
    () =>
      envioUnico(async (clavesAEnviar: string[] | null) => {
        const lista = actuales.current.filter((e) => !clavesAEnviar || clavesAEnviar.includes(e.clave));
        if (lista.length === 0) return;
        if (faltaAmbiente(lista)) {
          setPedirAmbiente(true);
          return;
        }
        setPedirAmbiente(false);
        setMensaje(null);
        setEnviando(true);
        setFallidas({});
        try {
          const resultado = await subirLote({
            archivos: lista,
            reservaId,
            registrar: (fotos) => registrarFotosPorHttp(reservaId, fotos),
            onProgreso: (clave, porcentaje) => setProgreso((p) => ({ ...p, [clave]: porcentaje })),
          });
          const hechas = new Set(resultado.registradas);
          setElegidas((previas) => {
            previas.filter((e) => hechas.has(e.clave)).forEach((e) => URL.revokeObjectURL(e.previa));
            return previas.filter((e) => !hechas.has(e.clave));
          });
          setFallidas(Object.fromEntries(resultado.fallidas.map((f) => [f.clave, f.motivo])));
          if (resultado.fallidas.length > 0) setMensaje("Algunas fotos no se subieron. Reinténtalas o quítalas.");
          router.refresh();
        } catch (error) {
          setMensaje(error instanceof Error ? error.message : "No pudimos registrar las fotos.");
          // Las que ya subieron conservan su ruta: reintentar no las sube otra vez.
          if (error instanceof ErrorAlRegistrar) {
            const rutas = new Map(error.subidas.map((s) => [s.clave, s.ruta]));
            setElegidas((previas) => previas.map((e) => (rutas.has(e.clave) ? { ...e, ruta: rutas.get(e.clave) } : e)));
          }
          router.refresh();
        } finally {
          setProgreso({});
          setEnviando(false);
        }
      }),
    [reservaId, router],
  );

  return (
    <VistaSubirFotos
      caben={caben}
      elegidas={elegidas}
      fallidas={fallidas}
      progreso={progreso}
      enviando={enviando}
      mensaje={mensaje}
      aviso={aviso}
      pedirAmbiente={pedirAmbiente}
      onElegir={elegir}
      onAmbiente={(clave, ambiente) => setElegidas((previas) => previas.map((e) => (e.clave === clave ? { ...e, ambiente } : e)))}
      onQuitar={quitar}
      onSubir={() => void enviar(null)}
      onReintentar={(clave) => void enviar([clave])}
    />
  );
}
