// Tiza.com · asistente de reserva por pasos
const WHATSAPP = "51999999999"; // cámbialo por el número real

const TIPO = { estandar: 1, profunda: 1.5, mudanza: 1.7 };
const HORAS = { 3: 99, 4: 129, 6: 189, 8: 239 };
// niveles del hogar (además de 1 cocina): se usa el primero cuyos dormitorios y baños cubren el hogar
const NIVELES = [
  { dorm: 0, banos: 1, horas: 2, precio: 66 },
  { dorm: 1, banos: 1, horas: 3, precio: 99 },
  { dorm: 2, banos: 2, horas: 4, precio: 129 },
  { dorm: Infinity, banos: Infinity, horas: 6, precio: 189 },
];
const DUR_EXTRA = { estandar: 0, profunda: 1, mudanza: 2 };
const UMBRAL_APOYO = 6; // más de 6 h por tamaño: va una persona de apoyo y el tiempo se reduce a la mitad
const CLUB_PRECIO = 89, CLUB_MESES = 3, CLUB_DTO = 0.10, HORAS_GRATIS = 3;
const APERTURA = 8, CIERRE = 18, ANTICIPACION_H = 48; // lunes a sábado de 8 am a 6 pm, 48 h de anticipación
const COMP_TIPOS = ["image/jpeg", "image/png", "image/webp"], COMP_MAX = 5 * 1024 * 1024;
const N_TIPO = { estandar: "Limpieza estándar", profunda: "Limpieza profunda", mudanza: "Limpieza de mudanza", horas: "Limpieza por horas" };
const N_PAGO = { yape: "Yape", transferencia: "Transferencia" };
const TOTAL_PASOS = 5;

const $ = (id) => document.getElementById(id);
const st = { tipo: null, dorm: 2, banos: 1, horas: 4, fecha: null, hora: null, pago: null };
let paso = 1;
let moviendo = false;

/* ---------- precios ---------- */
function nivel() {
  return NIVELES.find((n) => st.dorm <= n.dorm && st.banos <= n.banos);
}
function base() {
  if (!st.tipo) return null;
  if (st.tipo === "horas") return HORAS[st.horas];
  return nivel().precio * TIPO[st.tipo];
}
function duracion() {
  if (!st.tipo) return null;
  if (st.tipo === "horas") return { trabajo: st.horas, agenda: st.horas, apoyo: false };
  const trabajo = nivel().horas + DUR_EXTRA[st.tipo];
  const apoyo = trabajo > UMBRAL_APOYO;
  // con apoyo: la mitad del tiempo, redondeada hacia arriba a 30 minutos
  return { trabajo, agenda: apoyo ? Math.ceil(trabajo / 2 / 0.5) * 0.5 : trabajo, apoyo };
}
function precios() {
  const b = base();
  if (b == null) return null;
  const { trabajo } = duracion();
  const lista = Math.round(b * 100) / 100;
  const siguientes = Math.round(b * (1 - CLUB_DTO) * 100) / 100;
  // las 3 primeras horas son gratis; las adicionales se cobran proporcionales, con el descuento de miembro
  const horasExtra = Math.max(0, trabajo - HORAS_GRATIS);
  const primera = Math.round(lista / trabajo * horasExtra * (1 - CLUB_DTO) * 100) / 100;
  const membresia = CLUB_PRECIO * CLUB_MESES;
  return { lista, siguientes, primera, horasExtra, membresia, total: membresia + primera };
}
const soles = (n) => `S/ ${Number.isInteger(n) ? n : n.toFixed(2)}`;
const horasTxt = (h) => `${String(h).replace(".", ",")} h`;

/* ---------- resumen ---------- */
function fechaCorta(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  return new Intl.DateTimeFormat("es-PE", { weekday: "long", day: "numeric", month: "long" }).format(d);
}
function renderResumen() {
  const rows = [];
  if (st.tipo) rows.push(["Servicio", N_TIPO[st.tipo]]);
  const dist = $("distrito").value;
  if (dist) rows.push(["Distrito", dist]);
  if (st.tipo === "horas") rows.push(["Duración", `${st.horas} horas`]);
  else if (st.tipo) {
    rows.push(["Hogar", `${st.dorm} dorm. · ${st.banos} baño${st.banos > 1 ? "s" : ""}`]);
    const d = duracion();
    rows.push(["Duración", d.apoyo ? `${horasTxt(d.agenda)} con 2 personas` : horasTxt(d.trabajo)]);
  }
  if (st.fecha) rows.push(["Día", fechaCorta(st.fecha)]);
  if (st.hora) rows.push(["Hora", st.hora]);
  if (st.pago) rows.push(["Pago", N_PAGO[st.pago]]);
  $("sum").innerHTML = rows.length
    ? rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")
    : '<p class="muted">Elige un servicio para ver tu precio.</p>';

  const p = precios();
  const tot = $("tot"), lab = $("totLabel"), note = $("sumNote");
  lab.textContent = "Tu 1ª limpieza";
  if (!p) { tot.textContent = "—"; note.textContent = ""; renderPago(); return; }
  tot.innerHTML = p.primera === 0 ? '<span class="free">GRATIS</span>' : soles(p.primera);
  const extra = p.horasExtra > 0
    ? `Primeras ${HORAS_GRATIS} h gratis; pagas ${horasTxt(p.horasExtra)} adicionales con 10% de descuento.<br>`
    : `Tus ${HORAS_GRATIS} primeras horas son gratis.<br>`;
  note.innerHTML = `${extra}Membresía Tiza Club: <b>S/ ${CLUB_PRECIO}/mes</b>, ${CLUB_MESES} meses en un solo pago.<br>Siguientes visitas: <b>${soles(p.siguientes)}</b> c/u.`;
  renderPago();
}

/* ---------- selección de opciones ---------- */
function marcar(contenedor, valor) {
  $(contenedor).querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === String(valor)));
}
$("o-tipo").addEventListener("click", (e) => {
  const b = e.target.closest(".opt");
  if (!b) return;
  st.tipo = b.dataset.v;
  marcar("o-tipo", st.tipo);
  syncPaso2();
  renderResumen();
  setTimeout(() => ir(2), 220); // avanza solo, como en Angi
});
$("o-horas").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  st.horas = Number(b.dataset.v);
  marcar("o-horas", st.horas);
  renderResumen();
});
document.querySelectorAll(".stepper button").forEach((b) =>
  b.addEventListener("click", () => {
    const k = b.dataset.t;
    const [min, max] = k === "dorm" ? [0, 6] : [1, 5];
    st[k] = Math.min(max, Math.max(min, st[k] + Number(b.dataset.d)));
    $(k).textContent = st[k];
    renderResumen();
  })
);
$("distrito").addEventListener("change", renderResumen);

function syncPaso2() {
  const h = st.tipo === "horas";
  $("blk-horas").hidden = !h;
  $("blk-tam").hidden = h;
  marcar("o-horas", st.horas);
}

/* ---------- calendario ---------- */
function construirDias() {
  const cont = $("days");
  const f = new Intl.DateTimeFormat("es-PE", { weekday: "short", day: "numeric", month: "short" });
  const hoy = new Date();
  let html = "", n = 0, i = 2; // con 48 h de anticipación, el primer día posible es pasado mañana
  while (n < 10) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + i++);
    if (d.getDay() === 0) continue; // sin domingos
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const [dia, num, mes] = f.formatToParts(d).filter((p) => p.type !== "literal").map((p) => p.value);
    html += `<button type="button" data-v="${iso}"><small>${dia.replace(".", "")}</small><b>${num}</b><small>${mes.replace(".", "")}</small></button>`;
    n++;
  }
  cont.innerHTML = html;
  cont.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    st.fecha = b.dataset.v;
    marcar("days", st.fecha);
    renderHorarios();
    renderResumen();
  });
  $("times").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    st.hora = b.dataset.v;
    marcar("times", st.hora);
    renderResumen();
  });
}

function etiquetaHora(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${h > 12 ? h - 12 : h}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
// horarios cada 30 min: el servicio debe terminar a las 6 pm y empezar con 48 h de anticipación
function renderHorarios() {
  const cont = $("times");
  if (!st.fecha || !st.tipo) { cont.innerHTML = '<p class="muted">Elige un día para ver los horarios.</p>'; return; }
  const limite = Date.now() + ANTICIPACION_H * 3600 * 1000;
  const ultimo = (CIERRE - duracion().agenda) * 60;
  const [a, mes, dia] = st.fecha.split("-").map(Number);
  let html = "";
  for (let min = APERTURA * 60; min <= ultimo; min += 30) {
    const inicio = new Date(a, mes - 1, dia, Math.floor(min / 60), min % 60).getTime();
    const txt = etiquetaHora(min);
    html += `<button type="button" data-v="${txt}"${inicio < limite ? " disabled" : ""}>${txt}</button>`;
  }
  cont.innerHTML = html;
  const elegido = cont.querySelector(`button[data-v="${st.hora}"]:not(:disabled)`);
  if (!elegido) st.hora = null;
  marcar("times", st.hora);
}

/* ---------- pago ---------- */
$("o-pago").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  st.pago = b.dataset.v;
  marcar("o-pago", st.pago);
  $("pay-yape").hidden = st.pago !== "yape";
  $("pay-transf").hidden = st.pago !== "transferencia";
  renderResumen();
});
function renderPago() {
  const p = precios();
  if (!p) { $("paySum").innerHTML = ""; return; }
  $("paySum").innerHTML = [
    [`Membresía Tiza Club (${CLUB_MESES} meses)`, soles(p.membresia)],
    [p.horasExtra > 0 ? `1ª limpieza: ${horasTxt(p.horasExtra)} adicionales` : "1ª limpieza", p.primera === 0 ? "GRATIS" : soles(p.primera)],
    ["Total a pagar", soles(p.total)],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
}
function comprobanteError() {
  const f = $("comp").files[0];
  if (!f) return "Sube la imagen de tu comprobante.";
  if (!COMP_TIPOS.includes(f.type)) return "El comprobante debe ser una imagen JPG, PNG o WebP.";
  if (f.size > COMP_MAX) return "La imagen pesa más de 5 MB. Sube una más liviana.";
  return "";
}
$("comp").addEventListener("change", () => error("err5", $("comp").files[0] ? comprobanteError() : ""));

/* ---------- pasos y transiciones ---------- */
function panel(n) { return document.querySelector(`.panel[data-step="${n}"]`); }

// Un clic que llega durante la animación entre pasos no se pierde: queda en espera y se
// ejecuta al terminar, ya con el paso nuevo (así valida los datos del paso correcto).
let pendiente = null;
function alQuedarQuieto(accion) {
  if (moviendo) pendiente = accion;
  else accion();
}

function ir(n) {
  if (moviendo) { pendiente = () => ir(n); return; }
  if (n === paso) return;
  const dir = n > paso ? "r" : "l";
  const sale = panel(paso), entra = panel(n);
  if (n === 3) renderHorarios(); // la duración pudo cambiar en el paso 2
  moviendo = true;
  sale.classList.add(dir === "r" ? "leave-l" : "leave-r");
  setTimeout(() => {
    sale.hidden = true;
    sale.classList.remove("leave-l", "leave-r");
    entra.hidden = false;
    entra.classList.add(dir === "r" ? "enter-r" : "enter-l");
    setTimeout(() => {
      entra.classList.remove("enter-r", "enter-l");
      moviendo = false;
      const accion = pendiente;
      pendiente = null;
      if (accion) accion();
    }, 340);
    paso = n;
    actualizarNav();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, 260);
}

function actualizarNav() {
  const ok = paso === TOTAL_PASOS + 1;
  $("nav").hidden = ok || paso === 1;
  $("bar").style.width = `${Math.min(paso, TOTAL_PASOS) / TOTAL_PASOS * 100}%`;
  $("stepLabel").textContent = ok ? "¡Listo!" : `Paso ${paso} de ${TOTAL_PASOS}`;
  $("next").textContent = paso === TOTAL_PASOS ? "Confirmar reserva ✓" : "Continuar →";
}

function error(id, msg) {
  const el = $(id);
  el.textContent = msg || "";
  el.hidden = !msg;
  return !msg;
}

function validar() {
  if (paso === 2) return error("err2", $("distrito").value ? "" : "Elige tu distrito para continuar.");
  if (paso === 3) return error("err3", st.fecha && st.hora ? "" : "Elige un día y una hora.");
  if (paso === 4) {
    if (!$("nombre").value.trim()) return error("err4", "Escribe tu nombre.");
    if (!/^9\d{8}$/.test($("tel").value.replace(/\s/g, ""))) return error("err4", "Ingresa un WhatsApp válido de 9 dígitos (empieza con 9).");
    if (!$("dir").value.trim()) return error("err4", "Escribe la dirección del servicio.");
    return error("err4", "");
  }
  if (paso === 5) {
    if (!st.pago) return error("err5", "Elige cómo vas a pagar: Yape o transferencia.");
    return error("err5", comprobanteError());
  }
  return true;
}

$("next").addEventListener("click", () =>
  alQuedarQuieto(() => {
    if (!validar()) return;
    if (paso < TOTAL_PASOS) ir(paso + 1);
    else confirmar();
  }),
);
$("back").addEventListener("click", () => alQuedarQuieto(() => ir(paso - 1)));

/* ---------- confirmar ---------- */
function confirmar() {
  const p = precios();
  const lineas = [
    "Hola Tiza 👋, acabo de reservar una limpieza y subí mi comprobante:",
    `• Servicio: ${N_TIPO[st.tipo]}`,
    st.tipo === "horas" ? `• Duración: ${st.horas} horas` : `• Hogar: ${st.dorm} dormitorio(s), ${st.banos} baño(s)`,
    `• Distrito: ${$("distrito").value}`,
    `• Día y hora: ${fechaCorta(st.fecha)}, ${st.hora}`,
    `• Dirección: ${$("dir").value.trim()}`,
    $("ref").value.trim() ? `• Referencia: ${$("ref").value.trim()}` : null,
    `• Tiza Club: ${soles(p.membresia)} (${CLUB_MESES} meses) · 1ª limpieza: ${p.primera === 0 ? "GRATIS" : `primeras ${HORAS_GRATIS} h gratis + ${soles(p.primera)}`}`,
    `• Pago: ${N_PAGO[st.pago]} · total ${soles(p.total)}`,
    `• Nombre: ${$("nombre").value.trim()}`,
    `• WhatsApp: ${$("tel").value.replace(/\s/g, "")}`,
  ].filter(Boolean);
  // WhatsApp es solo para coordinar detalles: se ofrece el enlace, no se abre solo
  $("okName").textContent = $("nombre").value.trim().split(" ")[0];
  $("okWa").href = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(lineas.join("\n"))}`;
  ir(TOTAL_PASOS + 1);
}

/* ---------- arranque ---------- */
construirDias();
renderHorarios();
const q = new URLSearchParams(location.search);
if (q.get("distrito")) {
  const opt = [...$("distrito").options].find((o) => o.value === q.get("distrito"));
  if (opt) $("distrito").value = opt.value;
}
if (HORAS[q.get("horas")]) st.horas = Number(q.get("horas"));
if (N_TIPO[q.get("tipo")]) {
  st.tipo = q.get("tipo");
  marcar("o-tipo", st.tipo);
  syncPaso2();
  panel(1).hidden = true;
  panel(2).hidden = false;
  paso = 2;
}
marcar("o-horas", st.horas);
actualizarNav();
renderResumen();
