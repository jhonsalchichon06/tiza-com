"use client";

import { DISTRITOS } from "@/lib/distritos";
import estilos from "./CamposDireccion.module.css";

export type ValorDireccion = {
  distrito: string;
  calle: string;
  numero: string;
  departamento: string;
  referencias: string;
};

export const DIRECCION_VACIA: ValorDireccion = { distrito: "", calle: "", numero: "", departamento: "", referencias: "" };

type Props = { valor: ValorDireccion; onCambio: (valor: ValorDireccion) => void };

// Campos controlados de la dirección del hogar (ADR 0013). No valida ni normaliza: lo hace el servidor.
export function CamposDireccion({ valor, onCambio }: Props) {
  const cambiar = (campo: keyof ValorDireccion) => (e: { target: { value: string } }) =>
    onCambio({ ...valor, [campo]: e.target.value });

  return (
    <div className={estilos.campos}>
      <label className={estilos.campo}>
        Distrito
        <select name="distrito" value={valor.distrito} onChange={cambiar("distrito")} required>
          <option value="">Elige tu distrito</option>
          {DISTRITOS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <label className={estilos.campo}>
        Calle, avenida o jirón
        <input name="calle" type="text" autoComplete="off" value={valor.calle} onChange={cambiar("calle")} required />
      </label>
      <label className={estilos.campo}>
        Número
        <input name="numero" type="text" autoComplete="off" value={valor.numero} onChange={cambiar("numero")} required />
      </label>
      <label className={estilos.campo}>
        Departamento o interior (opcional)
        <input name="departamento" type="text" autoComplete="off" value={valor.departamento} onChange={cambiar("departamento")} />
      </label>
      <label className={estilos.campo}>
        Referencias (opcional)
        <input name="referencias" type="text" autoComplete="off" value={valor.referencias} onChange={cambiar("referencias")} />
      </label>
    </div>
  );
}
