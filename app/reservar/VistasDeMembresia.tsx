import Link from "next/link";
import { Marco } from "./Marco";
import estilos from "./reservar.module.css";

// Las dos vistas de /reservar que no muestran el asistente: la del pago en revisión y la de la membresía vencida.
export function PagoEnRevision() {
  return (
    <Marco>
      <h1 className={estilos.titulo}>Tu pago está en revisión</h1>
      <p className={estilos.subtitulo}>
        Ya recibimos tu comprobante. Cuando lo aprobemos podrás elegir el nuevo día y la hora de tu limpieza desde tu cuenta.
      </p>
      <div className={estilos.acciones}>
        <Link className={estilos.boton} href="/cuenta">
          Ir a mi cuenta
        </Link>
      </div>
    </Marco>
  );
}

// `fecha` ya viene escrita para el cliente (por ejemplo, «15 de diciembre de 2026»); null si no se pudo leer.
export function MembresiaVencida({ fecha }: { fecha: string | null }) {
  return (
    <Marco>
      <h1 className={estilos.titulo}>{fecha ? `Tu membresía venció el ${fecha}` : "Tu membresía venció"}</h1>
      <p className={estilos.subtitulo}>Renueva tu membresía desde tu cuenta para seguir reservando tus limpiezas.</p>
      <div className={estilos.acciones}>
        <Link className={estilos.boton} href="/cuenta">
          Ir a mi cuenta
        </Link>
      </div>
    </Marco>
  );
}
