import Link from "next/link";
import type { ElementoDePago } from "@/lib/pagos/listado";
import { formatearSoles } from "@/lib/soles";
import { CONCEPTOS, ESTADOS_DE_RESERVA, METODOS, fechaYHora } from "./formato";
import estilos from "./pagos.module.css";

// Lista de pagos por revisar, ya ordenada por el servidor (vencimiento más próximo primero).
export function VistaListaPagos({ pagos }: { pagos: ElementoDePago[] }) {
  return (
    <main className={estilos.pagina}>
      <Link href="/admin" className={estilos.volver}>
        ← Portal de administración
      </Link>
      <h1 className={estilos.titulo}>Pagos por revisar</h1>
      <p className={estilos.ayuda}>Abre un pago para ver su comprobante, aprobarlo o rechazarlo.</p>
      {pagos.length === 0 ? (
        <p className={estilos.vacio}>No hay pagos por revisar</p>
      ) : (
        <ul className={estilos.lista}>
          {pagos.map((p) => (
            <li key={p.pago.id}>
              <Link href={`/admin/pagos/${p.pago.id}`} className={estilos.fila}>
                <span className={estilos.cliente}>{p.cliente.nombre}</span>
                <span className={estilos.monto}>{formatearSoles(p.pago.monto)}</span>
                <span className={estilos.detalle}>
                  {CONCEPTOS[p.pago.concepto] ?? p.pago.concepto} · {METODOS[p.pago.metodo] ?? p.pago.metodo}
                  {p.pago.reemplaza_a ? " · Comprobante nuevo" : ""}
                </span>
                <span className={estilos.detalle}>
                  {p.reserva?.estado === "pendiente" && p.reserva.expira_en
                    ? `Vence ${fechaYHora(p.reserva.expira_en)}`
                    : p.reserva
                      ? `Reserva ${(ESTADOS_DE_RESERVA[p.reserva.estado ?? ""] ?? "").toLowerCase()}`
                      : "Sin reserva"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
