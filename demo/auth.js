// Registro / inicio de sesión (demo sin servidor: la sesión vive en localStorage).
// Expone window.tzAuth y monta el modal + el botón del nav (#nav-auth).
(function () {
  const K_USERS = "tz-users", K_SESSION = "tz-user";
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const hash = async (s) => {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  };

  const auth = {
    user: () => read(K_SESSION, null),
    async register(nombre, email, pass) {
      const users = read(K_USERS, {});
      email = email.trim().toLowerCase();
      if (users[email]) throw new Error("Ya existe una cuenta con ese correo.");
      users[email] = { nombre: nombre.trim(), pass: await hash(pass) };
      write(K_USERS, users);
      write(K_SESSION, { nombre: users[email].nombre, email });
    },
    async login(email, pass) {
      const users = read(K_USERS, {});
      email = email.trim().toLowerCase();
      const u = users[email];
      if (!u || u.pass !== await hash(pass)) throw new Error("Correo o contraseña incorrectos.");
      write(K_SESSION, { nombre: u.nombre, email });
    },
    logout() { try { localStorage.removeItem(K_SESSION); } catch (e) {} },
  };
  window.tzAuth = auth;

  // ---- modal ----
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="modal__bg" data-close></div>
    <div class="modal__box card" role="dialog" aria-modal="true" aria-labelledby="au-t">
      <button class="bk-close modal__x" type="button" data-close aria-label="Cerrar">✕</button>
      <h2 id="au-t">Bienvenida a Tiza</h2>
      <div class="tabs" role="tablist">
        <button type="button" role="tab" data-tab="login" class="on">Iniciar sesión</button>
        <button type="button" role="tab" data-tab="register">Crear cuenta</button>
      </div>
      <form id="au-f" class="panel" novalidate>
        <label class="fld" data-only="register"><span>Tu nombre</span><input name="nombre" autocomplete="name" placeholder="Camila Torres"></label>
        <label class="fld"><span>Correo</span><input name="email" type="email" autocomplete="email" placeholder="tu@correo.com" required></label>
        <label class="fld"><span>Contraseña</span><input name="pass" type="password" autocomplete="current-password" minlength="6" placeholder="Mínimo 6 caracteres" required></label>
        <p class="err" id="au-e" role="alert"></p>
        <button class="btn btn--lg" type="submit">Entrar →</button>
        <p class="fine center">Al crear tu cuenta aceptas los términos de Tiza.com.</p>
      </form>
    </div>`;
  document.body.appendChild(modal);

  const form = modal.querySelector("#au-f");
  const err = modal.querySelector("#au-e");
  let mode = "login", opener = null;

  function setMode(m) {
    mode = m;
    modal.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === m));
    modal.querySelectorAll("[data-only]").forEach((l) => { l.hidden = l.dataset.only !== m; });
    form.querySelector("button[type=submit]").textContent = m === "login" ? "Entrar →" : "Crear mi cuenta →";
    form.pass.autocomplete = m === "login" ? "current-password" : "new-password";
    err.textContent = "";
  }
  function open(m) {
    opener = document.activeElement;
    setMode(m || "login");
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    form.querySelector("input:not([hidden])").focus();
  }
  function close() {
    modal.hidden = true;
    document.body.style.overflow = "";
    if (opener) opener.focus();
  }
  auth.open = open;

  modal.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) close();
    const t = e.target.closest("[data-tab]");
    if (t) setMode(t.dataset.tab);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) close(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const nombre = (f.get("nombre") || "").trim(), email = f.get("email"), pass = f.get("pass");
    if (mode === "register" && !nombre) return (err.textContent = "Escribe tu nombre.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return (err.textContent = "Escribe un correo válido.");
    if (pass.length < 6) return (err.textContent = "La contraseña debe tener al menos 6 caracteres.");
    try {
      mode === "login" ? await auth.login(email, pass) : await auth.register(nombre, email, pass);
    } catch (ex) { return (err.textContent = ex.message); }
    modal.hidden = true;
    document.body.style.overflow = "";
    window.tzGo ? window.tzGo("cuenta.html") : (location.href = "cuenta.html");
  });

  // ---- botón del nav ----
  function renderNav() {
    const slot = document.getElementById("nav-auth");
    if (!slot) return;
    const u = auth.user();
    slot.replaceChildren();
    if (u) {
      const a = document.createElement("a");
      a.href = "cuenta.html";
      a.className = "avatar-link";
      a.title = "Mi cuenta";
      const av = document.createElement("span");
      av.className = "avatar";
      av.textContent = u.nombre.charAt(0).toUpperCase();
      const n = document.createElement("span");
      n.className = "avatar-link__n";
      n.textContent = u.nombre.split(" ")[0];
      a.append(av, n);
      slot.append(a);
    } else {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn--sm btn--ghost";
      b.textContent = "Ingresar";
      b.addEventListener("click", () => open("login"));
      const r = document.createElement("button");
      r.type = "button";
      r.className = "link nav__reg";
      r.textContent = "Registrarse";
      r.addEventListener("click", () => open("register"));
      slot.append(r, b);
    }
  }
  renderNav();
})();
