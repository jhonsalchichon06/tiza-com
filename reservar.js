// Tiza.com · asistente de reserva por pasos
const WHATSAPP = "51999999999"; // cámbialo por el número real

const BASE = 70, POR_DORM = 25, POR_BANO = 20;
const TIPO = { estandar: 1, profunda: 1.5, mudanza: 1.7 };
const HORAS = { 3: 99, 4: 129, 6: 189, 8: 239 };
const FREC = { unica: 0, mensual: 0.10, quincenal: 0.15, semanal: 0.20 };
const CLUB_PRECIO = 89, CLUB_DTO = 0.10, GRATIS_HASTA = 150;
const N_TIPO = { estandar: "Limpieza estándar", profunda: "Limpieza profunda", mudanza: "Limpieza de mudanza", horas: "Limpieza por horas" };
const N_FREC = { unica: "Una vez", mensual: "Mensual", quincenal: "Quincenal", semanal: "Semanal" };
const HORARIOS = ["8:00 am", "10:00 am", "12:00 pm", "2:00 pm", "4:00 pm"];
const TOTAL_PASOS = 4;

const $ = (id) => document.getElementById(id);
const st = { tipo: null, dorm: 2, banos: 1, horas: 4, frec: "unica", fecha: null, hora: null, club: false };
let paso = 1;
let moviendo = false;

/* ---------- precios ---------- */
function base() {
  if (!st.tipo) return null;
  if (st.tipo === "horas") return HORAS[st.horas];
  return (BASE + st.dorm * POR_DORM + st.banos * POR_BANO) * TIPO[st.tipo];
}
function precios() {
  const b = base();
  if (b == null) return null;
  const trasFrec = Math.round(b * (1 - FREC[st.frec]));
  const siguientes = Math.round(b * (1 - Math.min(FREC[st.frec] + (st.club ? CLUB_DTO : 0), 0.3)));
  const primera = st.club ? Math.max(0, trasFrec - GRATIS_HASTA) : trasFrec;
  return { trasFrec, siguientes, primera };
}

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
  else if (st.tipo) rows.push(["Hogar", `${st.dorm} dorm. · ${st.banos} baño${st.banos > 1 ? "s" : ""}`]);
  if (st.tipo) rows.push(["Frecuencia", N_FREC[st.frec]]);
  if (st.fecha) rows.push(["Día", fechaCorta(st.fecha)]);
  if (st.hora) rows.push(["Hora", st.hora]);
  $("sum").innerHTML = rows.length
    ? rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")
    : '<p class="muted">Elige un servicio para ver tu precio.</p>';

  const p = precios();
  const tot = $("tot"), lab = $("totLabel"), note = $("sumNote");
  if (!p) { tot.textContent = "—"; lab.textContent = "Precio por visita"; note.textContent = ""; return; }
  if (st.club) {
    lab.textContent = "Tu 1ª limpieza";
    tot.innerHTML = p.primera === 0 ? '<span class="free">GRATIS</span>' : `S/ ${p.primera}`;
    note.innerHTML = `Membresía Tiza Club: <b>S/ ${CLUB_PRECIO}/mes</b>.<br>Siguientes visitas: <b>S/ ${p.siguientes}</b> c/u.`;
  } else {
    lab.textContent = "Precio por visita";
    tot.textContent = `S/ ${p.trasFrec}`;
    note.innerHTML = `Pagas después del servicio.<br>Con <b>Tiza Club</b> tu 1ª limpieza sería <b>GRATIS</b>.`;
  }
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
$("o-frec").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  st.frec = b.dataset.v;
  marcar("o-frec", st.frec);
  renderResumen();
});
document.querySelectorAll(".stepper button").forEach((b) =>
  b.addEventListener("click", () => {
    const k = b.dataset.t;
    const [min, max] = k === "dorm" ? [1, 6] : [1, 5];
    st[k] = Math.min(max, Math.max(min, st[k] + Number(b.dataset.d)));
    $(k).textContent = st[k];
    renderResumen();
  })
);
$("distrito").addEventListener("change", renderResumen);
$("club").addEventListener("change", (e) => {
  st.club = e.target.checked;
  $("clubBox").classList.toggle("on", st.club);
  renderResumen();
});

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
  let html = "", n = 0, i = 1;
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
    renderResumen();
  });
  $("times").innerHTML = HORARIOS.map((h) => `<button type="button" data-v="${h}">${h}</button>`).join("");
  $("times").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    st.hora = b.dataset.v;
    marcar("times", st.hora);
    renderResumen();
  });
}

/* ---------- pasos y transiciones ---------- */
function panel(n) { return document.querySelector(`.panel[data-step="${n}"]`); }

function ir(n) {
  if (n === paso || moviendo) return;
  const dir = n > paso ? "r" : "l";
  const sale = panel(paso), entra = panel(n);
  moviendo = true;
  sale.classList.add(dir === "r" ? "leave-l" : "leave-r");
  setTimeout(() => {
    sale.hidden = true;
    sale.classList.remove("leave-l", "leave-r");
    entra.hidden = false;
    entra.classList.add(dir === "r" ? "enter-r" : "enter-l");
    setTimeout(() => { entra.classList.remove("enter-r", "enter-l"); moviendo = false; }, 340);
    paso = n;
    actualizarNav();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, 260);
}

function actualizarNav() {
  const ok = paso === 5;
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
  return true;
}

$("next").addEventListener("click", () => {
  if (!validar()) return;
  if (paso < TOTAL_PASOS) ir(paso + 1);
  else confirmar();
});
$("back").addEventListener("click", () => ir(paso - 1));

/* ---------- confirmar ---------- */
function confirmar() {
  const p = precios();
  const lineas = [
    "Hola Tiza 👋, quiero reservar una limpieza:",
    `• Servicio: ${N_TIPO[st.tipo]}`,
    st.tipo === "horas" ? `• Duración: ${st.horas} horas` : `• Hogar: ${st.dorm} dormitorio(s), ${st.banos} baño(s)`,
    `• Distrito: ${$("distrito").value}`,
    `• Frecuencia: ${N_FREC[st.frec]}`,
    `• Día y hora: ${fechaCorta(st.fecha)}, ${st.hora}`,
    `• Dirección: ${$("dir").value.trim()}`,
    $("ref").value.trim() ? `• Referencia: ${$("ref").value.trim()}` : null,
    st.club
      ? `• Tiza Club: SÍ (S/ ${CLUB_PRECIO}/mes) · 1ª limpieza: ${p.primera === 0 ? "GRATIS" : "S/ " + p.primera} · siguientes: S/ ${p.siguientes}`
      : `• Precio por visita: S/ ${p.trasFrec}`,
    `• Nombre: ${$("nombre").value.trim()}`,
    `• WhatsApp: ${$("tel").value.replace(/\s/g, "")}`,
  ].filter(Boolean);
  const url = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(lineas.join("\n"))}`;
  $("okName").textContent = $("nombre").value.trim().split(" ")[0];
  $("okWa").href = url;
  window.open(url, "_blank", "noopener");
  ir(5);
}

/* ---------- arranque ---------- */
construirDias();
const q = new URLSearchParams(location.search);
if (q.get("distrito")) {
  const opt = [...$("distrito").options].find((o) => o.value === q.get("distrito"));
  if (opt) $("distrito").value = opt.value;
}
if (q.get("club")) { st.club = true; $("club").checked = true; $("clubBox").classList.add("on"); }
if (HORAS[q.get("horas")]) st.horas = Number(q.get("horas"));
if (N_TIPO[q.get("tipo")]) {
  st.tipo = q.get("tipo");
  marcar("o-tipo", st.tipo);
  syncPaso2();
  panel(1).hidden = true;
  panel(2).hidden = false;
  paso = 2;
}
marcar("o-frec", st.frec);
marcar("o-horas", st.horas);
actualizarNav();
renderResumen();
