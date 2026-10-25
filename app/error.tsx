"use client";

// Mensaje genérico: el detalle del error queda en los logs, nunca en pantalla (ADR 0006).
export default function ErrorGeneral({ reset }: { error: Error; reset: () => void }) {
  return (
    <main style={{ maxWidth: 480, margin: "15vh auto", padding: 16, fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
      <h1>Algo salió mal</h1>
      <p>No pudimos cargar la página. Inténtalo de nuevo en unos segundos.</p>
      <button type="button" onClick={() => reset()} style={{ padding: "10px 22px", fontSize: "1rem", cursor: "pointer" }}>
        Reintentar
      </button>
    </main>
  );
}
