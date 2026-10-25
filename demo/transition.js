// Transición entre páginas: una cortina con el logo sube, se navega y luego sale por arriba.
(function () {
  const root = document.documentElement;
  const pt = document.querySelector(".pt");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const flag = (v) => { try { v ? sessionStorage.setItem("tz-pt", "1") : sessionStorage.removeItem("tz-pt"); } catch (e) {} };

  function reset() {
    if (!pt) return;
    pt.style.transition = "none";
    pt.classList.remove("in", "up");
    void pt.offsetWidth;
    pt.style.transition = "";
  }

  // Entrada: si venimos de una transición, la cortina ya está cubriendo la pantalla; la deslizamos hacia arriba.
  function enter() {
    if (!pt) return;
    if (!root.classList.contains("tz-enter")) return;
    flag(false);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.classList.remove("tz-enter");
      pt.classList.add("up");
      setTimeout(reset, 700);
    }));
  }
  enter();

  // Salida: interceptamos los enlaces internos a otras páginas.
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a || !pt || reduce) return;
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || a.target === "_blank") return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search) return;
    e.preventDefault();
    flag(true);
    pt.classList.add("in");
    setTimeout(() => { location.href = url.href; }, 520);
  });

  // Al volver con el botón "atrás" desde caché, quitamos la cortina.
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) { root.classList.remove("tz-enter"); flag(false); reset(); }
  });

  // Permite que otras partes del sitio naveguen con la misma transición.
  window.tzGo = (href) => {
    if (!pt || reduce) { location.href = href; return; }
    flag(true);
    pt.classList.add("in");
    setTimeout(() => { location.href = href; }, 520);
  };
})();
