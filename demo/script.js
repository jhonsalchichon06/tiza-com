// Página principal: el formulario del hero lleva a reservar.html con los datos ya elegidos.
document.getElementById("start").addEventListener("submit", (e) => {
  e.preventDefault();
  const p = new URLSearchParams();
  const d = document.getElementById("s-distrito").value;
  if (d) p.set("distrito", d);
  p.set("tipo", document.getElementById("s-tipo").value);
  window.tzGo("reservar.html?" + p.toString());
});
