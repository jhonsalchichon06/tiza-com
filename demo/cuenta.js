// Mi cuenta: saludo, historial desplegable y reseñas. Requiere sesión (auth.js).
(function () {
  const user = window.tzAuth.user();
  if (!user) { location.replace("index.html"); return; }

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, txt) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };
  const first = user.nombre.split(" ")[0];
  document.title = "Mi cuenta · Tiza.com";
  $("hola").textContent = "Hola, " + first + ". Tu casa está al día.";
  $("hola-nav").textContent = "Hola, " + first;
  $("avatar").textContent = first.charAt(0).toUpperCase();
  $("logout").addEventListener("click", () => { window.tzAuth.logout(); window.tzGo("index.html"); });

  // Datos de ejemplo (sustituir por la API cuando exista).
  const historial = [
    { fecha: "07 oct", servicio: "Limpieza de cocina y baños", horas: "2 h", club: true, pro: "Rosa M.", direccion: "Av. Larco 1150", fotos: ["Cocina", "Baño", "Lavadero"] },
    { fecha: "23 sep", servicio: "Limpieza general", horas: "4 h", club: true, pro: "Lucía P.", direccion: "Av. Larco 1150", fotos: ["Sala", "Dormitorio", "Cocina"] },
    { fecha: "09 sep", servicio: "Limpieza profunda", horas: "5 h", club: false, pro: "Rosa M.", direccion: "Av. Larco 1150", fotos: ["Sala", "Baño", "Terraza"] },
    { fecha: "26 ago", servicio: "Limpieza general", horas: "4 h", club: true, pro: "Marta G.", direccion: "Av. Larco 1150", fotos: ["Sala", "Cocina", "Dormitorio"] },
  ];
  const KEY = "tz-reviews";
  let reviews = {};
  try { reviews = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(reviews)); } catch (e) {} };
  let open = 0;

  function reviewBox(i, h) {
    const box = el("div", "hist__rev");
    box.append(el("h4", null, "Tu reseña de " + h.pro));
    const r = reviews[i];
    if (r && r.sent) {
      const done = el("div", "rev-done");
      done.append(el("div", "stars", "★".repeat(r.stars) + "☆".repeat(5 - r.stars)), el("p", null, r.text || "Sin comentario."), el("small", "free", "✔ Reseña enviada. ¡Gracias!"));
      box.append(done);
      return box;
    }
    let stars = 0;
    const row = el("div", "rate");
    const btns = [1, 2, 3, 4, 5].map((k) => {
      const b = el("button", null, "★");
      b.type = "button";
      b.setAttribute("aria-label", k + " de 5 estrellas");
      b.addEventListener("click", () => { stars = k; err.textContent = ""; btns.forEach((x, j) => x.classList.toggle("on", j < k)); });
      return b;
    });
    row.append(...btns);
    const ta = el("textarea");
    ta.rows = 4;
    ta.placeholder = "Cuéntanos cómo fue tu experiencia con " + h.pro;
    const err = el("span", "err");
    const send = el("button", "btn btn--sm", "Enviar reseña →");
    send.type = "button";
    send.addEventListener("click", () => {
      if (!stars) { err.textContent = "Elige una calificación."; return; }
      reviews[i] = { sent: true, stars, text: ta.value.trim() };
      save();
      render();
    });
    const foot = el("div", "rev-foot");
    foot.append(send, err);
    box.append(row, ta, foot);
    return box;
  }

  function detail(i, h) {
    const d = el("div", "hist__d");
    const fotos = el("div");
    fotos.append(el("h4", null, "Fotos del servicio"));
    const grid = el("div", "fotos");
    h.fotos.forEach((f) => grid.append(el("div", "foto", "✦ " + f)));
    fotos.append(grid, el("p", "muted fine", "Profesional: " + h.pro + " · " + h.direccion));
    d.append(fotos, reviewBox(i, h));
    return d;
  }

  function render() {
    const list = $("historial");
    list.replaceChildren();
    historial.forEach((h, i) => {
      const isOpen = open === i;
      const item = el("div", "hist");
      const head = el("button", "hist__h");
      head.type = "button";
      head.setAttribute("aria-expanded", isOpen);
      head.append(
        el("span", "muted", h.fecha),
        (() => { const w = el("span", "hist__s"); w.append(el("b", null, h.servicio), el("span", "badge" + (h.club ? " badge--club" : ""), h.club ? "✦ Tiza Club" : "Por horas")); return w; })(),
        el("span", "muted", h.horas),
        el("span", "badge badge--ok", "Completado"),
        el("span", "link", isOpen ? "Cerrar ▲" : "Ver detalle ▼")
      );
      head.addEventListener("click", () => { open = isOpen ? -1 : i; render(); });
      item.append(head);
      if (isOpen) item.append(detail(i, h));
      list.append(item);
    });
  }
  render();
})();
