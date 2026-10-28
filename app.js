"use strict";

var TERMS_VERSION = "2026-10-28-borrador";
var METHODS = ["Transferencia, cuando exista", "Tarjeta, cuando exista", "Otro medio futuro"];
var NEXT_OK = {
  "panel.html": true,
  "depositos.html": true,
  "historial.html": true,
  "ajustes.html": true,
  "avisos.html": true,
  "admin.html": true
};
var STATUS_LABEL = {
  pendiente: "Pendiente",
  en_revision: "En revisión",
  archivada: "Archivada"
};
var CONFIG_HELP = "Falta la configuración de Supabase. Abre config.js, pega la URL del proyecto y la clave anon, y publica de nuevo. Los pasos están en SETUP.md. No pegues la clave service_role.";
var LIB_HELP = "No se cargó la librería de Supabase. Revisa tu conexión y recarga la página.";
var SCHEMA_HELP = "La cuenta respondió, pero faltan las tablas. Ejecuta supabase/schema.sql en el SQL Editor de Supabase.";

window.addEventListener("error", function (event) {
  if (event && event.message) document.documentElement.setAttribute("data-js-error", event.message);
});
window.addEventListener("unhandledrejection", function (event) {
  var reason = event && event.reason;
  var message = reason && (reason.message || String(reason));
  if (message) document.documentElement.setAttribute("data-js-error", message);
});

var client = null;
var clientFailed = false;

function $(id) { return document.getElementById(id); }

function config() {
  return window.AIMA_CONFIG || {};
}

function isPlaceholder(value) {
  return /TU_PROYECTO|TU_ANON|YOUR_|REEMPLAZA|placeholder/i.test(String(value || ""));
}

function serviceRoleKey(key) {
  try {
    var part = String(key).split(".")[1];
    if (!part) return false;
    var padded = part.replace(/-/g, "+").replace(/_/g, "/");
    while (padded.length % 4) padded += "=";
    var payload = JSON.parse(atob(padded));
    return payload.role === "service_role";
  } catch (err) {
    return false;
  }
}

function configured() {
  var url = String(config().url || "").trim();
  var key = String(config().anonKey || "").trim();
  if (!/^https:\/\/.+/i.test(url) || key.length < 20) return false;
  if (isPlaceholder(url) || isPlaceholder(key)) return false;
  if (serviceRoleKey(key)) return false;
  return true;
}

function getClient() {
  if (client || clientFailed) return client;
  if (!configured() || !window.supabase || typeof window.supabase.createClient !== "function") return null;
  try {
    client = window.supabase.createClient(String(config().url).trim(), String(config().anonKey).trim(), {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "implicit"
      }
    });
  } catch (err) {
    clientFailed = true;
    client = null;
  }
  return client;
}

function currentFile() {
  var parts = location.pathname.split("/").filter(Boolean);
  var last = parts.length ? parts[parts.length - 1] : "index.html";
  if (last.indexOf(".") === -1) return "index.html";
  return last;
}

function pageUrl(file) {
  return new URL(file, window.location.href).href;
}

function safeNext(value) {
  return NEXT_OK[value] ? value : "panel.html";
}

function setText(id, value) {
  var node = $(id);
  if (node) node.textContent = value == null || value === "" ? "—" : String(value);
}

function setMsg(id, text, ok) {
  var node = $(id);
  if (!node) return;
  node.textContent = text || "";
  node.classList.toggle("ok", !!ok && !!text);
  node.classList.toggle("bad", !!text && !ok);
}

function setSystem(text) {
  setMsg("system-msg", text, false);
}

function explain(error) {
  var message = (error && (error.message || error.details || error.hint)) || "";
  if (/invalid login credentials/i.test(message)) return "Correo o contraseña incorrectos.";
  if (/already registered|already been registered/i.test(message)) return "Ya existe una cuenta con ese correo.";
  if (/email not confirmed/i.test(message)) return "Confirma el correo antes de entrar, o desactiva la confirmación en Supabase mientras pruebas.";
  if (/service_role|Invalid API key|No API key/i.test(message)) return "La clave de Supabase fue rechazada. Revisa que en config.js esté la clave anon.";
  if (/Could not find the table|schema cache|does not exist/i.test(message)) return SCHEMA_HELP;
  if (/new row violates row-level security/i.test(message)) return "La base rechazó el cambio. Revisa que schema.sql se haya ejecutado y que la sesión sea tuya.";
  if (/estado no permitido|no autorizado/i.test(message)) return "No tienes permiso para ese cambio.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) return "No hubo conexión con Supabase. Revisa la URL del proyecto y tu red.";
  return message || "Ocurrió un error. Inténtalo de nuevo.";
}

function formatDate(iso) {
  if (!iso) return "—";
  var date = new Date(iso);
  if (isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatAmount(value) {
  var number = Number(value);
  if (!isFinite(number)) return "—";
  return new Intl.NumberFormat("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number);
}

function ageYears(isoDate) {
  if (!isoDate) return null;
  var born = new Date(isoDate + "T00:00:00");
  if (isNaN(born.getTime())) return null;
  var today = new Date();
  var years = today.getFullYear() - born.getFullYear();
  var month = today.getMonth() - born.getMonth();
  if (month < 0 || (month === 0 && today.getDate() < born.getDate())) years -= 1;
  return years;
}

function cleanOptional(value) {
  var text = String(value || "").trim();
  return text ? text : null;
}

async function withBusy(button, fn) {
  if (button) button.disabled = true;
  try {
    await fn();
  } catch (err) {
    setSystem(explain(err));
  } finally {
    if (button) button.disabled = false;
  }
}

async function sessionUser() {
  var sb = getClient();
  if (!sb) return null;
  var result = await sb.auth.getSession();
  if (result.error || !result.data || !result.data.session) return null;
  return result.data.session;
}

async function ensureProfile(session) {
  var sb = getClient();
  var existing = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  if (existing.error) return existing;
  var meta = session.user.user_metadata || {};
  if (!existing.data) {
    var inserted = await sb.from("profiles").insert({
      id: session.user.id,
      nombre: meta.nombre || "",
      email: session.user.email || null,
      terms_version: meta.terms_version || null,
      terms_accepted_at: meta.terms_accepted_at || null
    }).select("*").single();
    if (inserted.error && /duplicate|unique/i.test(inserted.error.message || "")) {
      return sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
    }
    return inserted;
  }
  if (!existing.data.terms_accepted_at && meta.terms_accepted_at) {
    var patched = await sb.from("profiles").update({
      terms_accepted_at: meta.terms_accepted_at,
      terms_version: meta.terms_version || existing.data.terms_version,
      nombre: existing.data.nombre || meta.nombre || ""
    }).eq("id", session.user.id).select("*").single();
    if (!patched.error && patched.data) return patched;
  }
  return existing;
}

function paintNav(session, isAdmin) {
  var file = currentFile();
  document.querySelectorAll("[data-guest]").forEach(function (node) { node.hidden = !!session; });
  document.querySelectorAll("[data-user]").forEach(function (node) { node.hidden = !session; });
  document.querySelectorAll("[data-admin]").forEach(function (node) { node.hidden = !isAdmin; });
  document.querySelectorAll(".nav a").forEach(function (link) {
    var href = link.getAttribute("href");
    var current = href === file || ((file === "index.html") && href === "index.html");
    if (current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

async function paintSession() {
  if (serviceRoleKey(config().anonKey)) {
    setSystem("config.js tiene la clave service_role. Quítala y pega solo la clave anon.");
    paintNav(null, false);
    return null;
  }
  if (!configured()) {
    paintNav(null, false);
    return null;
  }
  if (!window.supabase) {
    setSystem(LIB_HELP);
    paintNav(null, false);
    return null;
  }
  var session = await sessionUser();
  var isAdmin = false;
  if (session) {
    var profile = await getClient().from("profiles").select("is_admin").eq("id", session.user.id).maybeSingle();
    if (!profile.error && profile.data && profile.data.is_admin) isAdmin = true;
  }
  paintNav(session, isAdmin);
  var hash = location.hash || "";
  if (hash.indexOf("access_token") !== -1 && currentFile() === "restablecer.html") {
    history.replaceState(null, "", location.pathname + location.search);
  }
  return session;
}

async function gate() {
  var loading = $("loading");
  if (serviceRoleKey(config().anonKey)) {
    if (loading) loading.hidden = true;
    setSystem("config.js tiene la clave service_role. Quítala y pega solo la clave anon.");
    return null;
  }
  if (!configured()) {
    if (loading) loading.hidden = true;
    setSystem(CONFIG_HELP);
    return null;
  }
  if (!getClient()) {
    if (loading) loading.hidden = true;
    setSystem(LIB_HELP);
    return null;
  }
  var session = await sessionUser();
  if (!session) {
    location.replace("login.html?next=" + encodeURIComponent(currentFile()));
    return null;
  }
  return session;
}

function bindChrome() {
  var button = document.querySelector(".nav-toggle");
  var nav = $("nav");
  if (button && nav) {
    button.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      button.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && nav.classList.contains("is-open")) {
        nav.classList.remove("is-open");
        button.setAttribute("aria-expanded", "false");
        button.focus();
      }
    });
  }
  document.querySelectorAll("[data-logout]").forEach(function (node) {
    node.addEventListener("click", function () {
      var sb = getClient();
      var done = function () { location.href = "index.html"; };
      if (!sb) { done(); return; }
      sb.auth.signOut().then(done, done);
    });
  });
}

function requireConfiguredForm(form, messageId) {
  if (configured() && getClient()) return true;
  if (serviceRoleKey(config().anonKey)) setMsg(messageId, "Esa clave es service_role. Usa la clave anon.", false);
  else if (!window.supabase) setMsg(messageId, LIB_HELP, false);
  else setMsg(messageId, CONFIG_HELP, false);
  return false;
}

function bindRegister() {
  var form = $("form-registro");
  if (!form) return;
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var button = form.querySelector("button[type=submit]");
    withBusy(button, async function () {
      setMsg("form-msg", "", false);
      var nombre = String($("nombre").value || "").trim();
      var email = String($("email").value || "").trim().toLowerCase();
      var password = String($("password").value || "");
      var password2 = String($("password2").value || "");
      if (nombre.length < 2) { setMsg("form-msg", "Escribe tu nombre.", false); return; }
      if (password.length < 8) { setMsg("form-msg", "La contraseña debe tener al menos 8 caracteres.", false); return; }
      if (password !== password2) { setMsg("form-msg", "Las contraseñas no coinciden.", false); return; }
      if (!$("mayor").checked) { setMsg("form-msg", "Debes confirmar que tienes 18 años o más.", false); return; }
      if (!$("riesgo").checked) { setMsg("form-msg", "Debes confirmar que leíste el aviso de riesgo.", false); return; }
      if (!$("terms").checked) { setMsg("form-msg", "Debes aceptar los Términos y Condiciones para crear la cuenta.", false); return; }
      if (!requireConfiguredForm(form, "form-msg")) return;
      var acceptedAt = new Date().toISOString();
      var result = await getClient().auth.signUp({
        email: email,
        password: password,
        options: {
          emailRedirectTo: pageUrl("panel.html"),
          data: {
            nombre: nombre,
            terms_version: TERMS_VERSION,
            terms_accepted_at: acceptedAt
          }
        }
      });
      if (result.error) { setMsg("form-msg", explain(result.error), false); return; }
      if (result.data && result.data.session) {
        location.href = "panel.html";
        return;
      }
      setMsg("form-msg", "Cuenta creada. Revisa tu correo para confirmarla y luego entra desde Iniciar sesión. Si desactivaste la confirmación en Supabase, entra directamente.", true);
      form.reset();
    });
  });
}

function bindLogin() {
  var form = $("form-login");
  if (!form) return;
  var params = new URLSearchParams(location.search);
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var button = form.querySelector("button[type=submit]");
    withBusy(button, async function () {
      setMsg("form-msg", "", false);
      if (!requireConfiguredForm(form, "form-msg")) return;
      var email = String($("email").value || "").trim().toLowerCase();
      var password = String($("password").value || "");
      var result = await getClient().auth.signInWithPassword({ email: email, password: password });
      if (result.error) { setMsg("form-msg", explain(result.error), false); return; }
      location.href = safeNext(params.get("next"));
    });
  });
}

function bindRecover() {
  var form = $("form-recuperar");
  if (!form) return;
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var button = form.querySelector("button[type=submit]");
    withBusy(button, async function () {
      setMsg("form-msg", "", false);
      if (!requireConfiguredForm(form, "form-msg")) return;
      var email = String($("email").value || "").trim().toLowerCase();
      var result = await getClient().auth.resetPasswordForEmail(email, { redirectTo: pageUrl("restablecer.html") });
      if (result.error) { setMsg("form-msg", explain(result.error), false); return; }
      setMsg("form-msg", "Si existe una cuenta con ese correo, enviaremos un enlace para elegir otra contraseña. Revisa también el spam.", true);
      form.reset();
    });
  });
}

function bindReset() {
  var form = $("form-restablecer");
  if (!form) return;
  var params = new URLSearchParams(location.search);
  var hash = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  var described = params.get("error_description") || hash.get("error_description");
  if (described) setMsg("form-msg", described, false);
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var button = form.querySelector("button[type=submit]");
    withBusy(button, async function () {
      setMsg("form-msg", "", false);
      if (!requireConfiguredForm(form, "form-msg")) return;
      var session = await sessionUser();
      if (!session) {
        setMsg("form-msg", "El enlace no abrió una sesión. Pide otro desde Recuperar contraseña, en este mismo navegador.", false);
        return;
      }
      var password = String($("password").value || "");
      var password2 = String($("password2").value || "");
      if (password.length < 8) { setMsg("form-msg", "La contraseña debe tener al menos 8 caracteres.", false); return; }
      if (password !== password2) { setMsg("form-msg", "Las contraseñas no coinciden.", false); return; }
      var result = await getClient().auth.updateUser({ password: password });
      if (result.error) { setMsg("form-msg", explain(result.error), false); return; }
      location.href = "panel.html";
    });
  });
}

function depositRows(requests, mountId, emptyId) {
  var body = $(mountId);
  var empty = $(emptyId);
  if (!body) return;
  body.textContent = "";
  var rows = requests || [];
  if (empty) empty.hidden = rows.length !== 0;
  rows.forEach(function (row) {
    var tr = document.createElement("tr");
    [formatDate(row.created_at), formatAmount(row.amount), row.method, STATUS_LABEL[row.status] || row.status].forEach(function (value) {
      var cell = document.createElement("td");
      if (value === (STATUS_LABEL[row.status] || row.status)) {
        var badge = document.createElement("span");
        badge.className = "badge " + (row.status || "");
        badge.textContent = value;
        cell.appendChild(badge);
      } else {
        cell.textContent = value;
      }
      tr.appendChild(cell);
    });
    body.appendChild(tr);
  });
}

async function loadDeposits(limit) {
  var result = await getClient().from("deposit_requests").select("id, amount, method, status, created_at").order("created_at", { ascending: false }).limit(limit || 100);
  if (result.error) throw result.error;
  return result.data || [];
}

function bindDepositForm(listId, emptyId, limit) {
  var form = $("deposit-form");
  if (!form) return;
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var button = form.querySelector("button[type=submit]");
    withBusy(button, async function () {
      setMsg("deposit-msg", "", false);
      var session = await sessionUser();
      if (!session) { location.replace("login.html?next=" + encodeURIComponent(currentFile())); return; }
      var amount = Number(String($("amount").value || "").replace(",", "."));
      var method = $("method").value;
      if (!isFinite(amount) || amount <= 0 || amount > 1000000) {
        setMsg("deposit-msg", "Escribe un monto mayor que 0 y hasta 1.000.000. No se hará ningún cargo.", false);
        return;
      }
      if (METHODS.indexOf(method) === -1) {
        setMsg("deposit-msg", "Elige un medio de la lista. No pedimos cuentas ni monederos.", false);
        return;
      }
      var inserted = await getClient().from("deposit_requests").insert({
        user_id: session.user.id,
        amount: amount,
        method: method,
        status: "pendiente"
      });
      if (inserted.error) { setMsg("deposit-msg", explain(inserted.error), false); return; }
      form.reset();
      setMsg("deposit-msg", "Intención registrada con estado pendiente. No se ha cobrado nada y AIMA no recibe dinero.", true);
      try {
        depositRows(await loadDeposits(limit), listId, emptyId);
      } catch (err) {
        setMsg("deposit-msg", explain(err), false);
      }
    });
  });
}

async function showDepositList(listId, emptyId, limit) {
  try {
    depositRows(await loadDeposits(limit), listId, emptyId);
  } catch (err) {
    setMsg("deposit-msg", explain(err), false);
    setMsg("form-msg", explain(err), false);
  }
}

function fillProfileForm(profile) {
  if (!$("nombre")) return;
  $("nombre").value = profile.nombre || "";
  if ($("telefono")) $("telefono").value = profile.telefono || "";
  if ($("fecha")) $("fecha").value = profile.fecha_nacimiento || "";
  if ($("pais")) $("pais").value = profile.pais || "";
  if ($("ciudad")) $("ciudad").value = profile.ciudad || "";
  if ($("documento-tipo")) $("documento-tipo").value = profile.documento_tipo || "";
  if ($("documento-numero")) $("documento-numero").value = profile.documento_numero || "";
  var terms = $("terms-state");
  if (terms) {
    terms.textContent = profile.terms_version
      ? "Términos aceptados: versión " + profile.terms_version + (profile.terms_accepted_at ? " el " + formatDate(profile.terms_accepted_at) : "") + "."
      : "Todavía no consta en el perfil la aceptación de los términos.";
  }
}

async function openAccount(options) {
  var session = await gate();
  if (!session) return null;
  var result = await ensureProfile(session);
  var ready = $("app-ready");
  var loading = $("loading");
  if (loading) loading.hidden = true;
  if (result.error) {
    setSystem(explain(result.error));
    return null;
  }
  if (ready) ready.hidden = false;
  var profile = result.data || {};
  if (options && options.identity) {
    setText("p-nombre", profile.nombre || (session.user.user_metadata && session.user.user_metadata.nombre) || "");
    setText("p-email", session.user.email || profile.email || "");
    setText("p-id", profile.aima_id || "");
    var copy = $("copy-id");
    if (copy) {
      copy.addEventListener("click", function () {
        var id = ($("p-id") && $("p-id").textContent) || "";
        if (!id || id === "—") return;
        if (!navigator.clipboard) { setMsg("deposit-msg", "Selecciona el ID y cópialo manualmente.", false); return; }
        navigator.clipboard.writeText(id).then(function () {
          setMsg("deposit-msg", "ID copiado.", true);
        }, function () {
          setMsg("deposit-msg", "No se pudo copiar solo. Selecciona el ID y cópialo.", false);
        });
      });
    }
  }
  if (options && options.form) fillProfileForm(profile);
  return { session: session, profile: profile };
}

var pages = {
  registro: async function () {
    if (configured() && getClient()) {
      var session = await sessionUser();
      if (session) {
        var form = $("form-registro");
        if (form) form.hidden = true;
        setMsg("form-msg", "Ya iniciaste sesión. Puedes ir al panel.", true);
        return;
      }
    } else if (!configured()) {
      setSystem(CONFIG_HELP);
    }
    bindRegister();
  },
  login: async function () {
    if (configured() && getClient()) {
      var session = await sessionUser();
      if (session) { location.replace(safeNext(new URLSearchParams(location.search).get("next"))); return; }
    } else if (!configured()) {
      setSystem(CONFIG_HELP);
    }
    bindLogin();
  },
  recuperar: async function () {
    if (!configured()) setSystem(CONFIG_HELP);
    bindRecover();
  },
  restablecer: async function () {
    if (!configured()) setSystem(CONFIG_HELP);
    var box = $("recovery-box");
    var wait = $("recovery-wait");
    var session = configured() ? await sessionUser() : null;
    if (box) box.hidden = !session;
    if (wait) wait.hidden = !!session;
    bindReset();
  },
  panel: async function () {
    var account = await openAccount({ identity: true });
    if (!account) return;
    bindDepositForm("deposit-list", "deposit-empty", 5);
    await showDepositList("deposit-list", "deposit-empty", 5);
  },
  depositos: async function () {
    var account = await openAccount({});
    if (!account) return;
    bindDepositForm("deposit-list", "deposit-empty", 100);
    await showDepositList("deposit-list", "deposit-empty", 100);
  },
  historial: async function () {
    var account = await openAccount({});
    if (!account) return;
    await showDepositList("history-list", "history-empty", 100);
  },
  ajustes: async function () {
    var account = await openAccount({ form: true });
    if (!account) return;
    var profileForm = $("profile-form");
    if (profileForm) {
      profileForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var button = profileForm.querySelector("button[type=submit]");
        withBusy(button, async function () {
          setMsg("profile-msg", "", false);
          var nombre = String($("nombre").value || "").trim();
          if (nombre.length < 2) { setMsg("profile-msg", "El nombre debe tener al menos 2 caracteres.", false); return; }
          var fecha = cleanOptional($("fecha") && $("fecha").value);
          if (fecha && ageYears(fecha) !== null && ageYears(fecha) < 18) {
            setMsg("profile-msg", "AIMA es solo para personas de 18 años o más.", false);
            return;
          }
          var tipo = cleanOptional($("documento-tipo") && $("documento-tipo").value);
          var saved = await getClient().from("profiles").update({
            nombre: nombre,
            telefono: cleanOptional($("telefono") && $("telefono").value),
            fecha_nacimiento: fecha,
            pais: cleanOptional($("pais") && $("pais").value),
            ciudad: cleanOptional($("ciudad") && $("ciudad").value),
            documento_tipo: tipo,
            documento_numero: cleanOptional($("documento-numero") && $("documento-numero").value),
            kyc_estado: "datos_guardados"
          }).eq("id", account.session.user.id).select("*").single();
          if (saved.error) { setMsg("profile-msg", explain(saved.error), false); return; }
          setText("p-nombre", saved.data.nombre);
          setMsg("profile-msg", "Datos guardados. Esto no verifica tu identidad ni habilita depósitos.", true);
        });
      });
    }
    var passwordForm = $("password-form");
    if (passwordForm) {
      passwordForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var button = passwordForm.querySelector("button[type=submit]");
        withBusy(button, async function () {
          setMsg("password-msg", "", false);
          var current = String($("current-password").value || "");
          var next = String($("new-password").value || "");
          var again = String($("new-password-2").value || "");
          if (next.length < 8) { setMsg("password-msg", "La contraseña nueva debe tener al menos 8 caracteres.", false); return; }
          if (next !== again) { setMsg("password-msg", "Las contraseñas no coinciden.", false); return; }
          var signed = await getClient().auth.signInWithPassword({ email: account.session.user.email, password: current });
          if (signed.error) { setMsg("password-msg", "La contraseña actual no coincide.", false); return; }
          var updated = await getClient().auth.updateUser({ password: next });
          if (updated.error) { setMsg("password-msg", explain(updated.error), false); return; }
          passwordForm.reset();
          setMsg("password-msg", "Contraseña actualizada.", true);
        });
      });
    }
  },
  avisos: async function () {
    var account = await openAccount({});
    if (!account) return;
    var list = $("news-list");
    var empty = $("news-empty");
    var result = await getClient().from("announcements").select("id, title, body, created_at").eq("published", true).order("created_at", { ascending: false }).limit(50);
    if (result.error) { setSystem(explain(result.error)); return; }
    if (!list) return;
    list.textContent = "";
    var rows = result.data || [];
    if (empty) empty.hidden = rows.length !== 0;
    rows.forEach(function (row) {
      var article = document.createElement("article");
      article.className = "card";
      var title = document.createElement("h2");
      title.textContent = row.title;
      var time = document.createElement("time");
      time.dateTime = row.created_at || "";
      time.textContent = formatDate(row.created_at);
      var body = document.createElement("p");
      body.textContent = row.body;
      article.appendChild(title);
      article.appendChild(time);
      article.appendChild(body);
      list.appendChild(article);
    });
  },
  admin: async function () {
    var account = await openAccount({});
    if (!account) return;
    var denied = $("admin-denied");
    var tools = $("admin-tools");
    if (!account.profile || !account.profile.is_admin) {
      if (denied) denied.hidden = false;
      if (tools) tools.hidden = true;
      return;
    }
    if (denied) denied.hidden = true;
    if (tools) tools.hidden = false;
    await renderAdminTable();
    var news = $("news-form");
    if (news) {
      news.addEventListener("submit", function (event) {
        event.preventDefault();
        var button = news.querySelector("button[type=submit]");
        withBusy(button, async function () {
          setMsg("news-msg", "", false);
          var title = String($("news-title").value || "").trim();
          var body = String($("news-body").value || "").trim();
          if (title.length < 3 || body.length < 3) { setMsg("news-msg", "Escribe un título y un texto de al menos 3 caracteres.", false); return; }
          var inserted = await getClient().from("announcements").insert({ title: title, body: body, published: true });
          if (inserted.error) { setMsg("news-msg", explain(inserted.error), false); return; }
          news.reset();
          setMsg("news-msg", "Aviso publicado para las cuentas que entren a Avisos.", true);
          await renderAdminNews();
        });
      });
    }
    await renderAdminNews();
  }
};

async function renderAdminTable() {
  var body = $("admin-list");
  if (!body) return;
  var requests = await getClient().from("deposit_requests").select("id, amount, method, status, created_at, user_id").order("created_at", { ascending: false }).limit(100);
  if (requests.error) { setMsg("admin-msg", explain(requests.error), false); return; }
  var rows = requests.data || [];
  var ids = rows.map(function (row) { return row.user_id; }).filter(function (id, index, all) { return id && all.indexOf(id) === index; });
  var profiles = { data: [] };
  if (ids.length) {
    profiles = await getClient().from("profiles").select("id, nombre, aima_id, email").in("id", ids);
    if (profiles.error) { setMsg("admin-msg", explain(profiles.error), false); return; }
  }
  var byId = {};
  (profiles.data || []).forEach(function (profile) { byId[profile.id] = profile; });
  body.textContent = "";
  var empty = $("admin-empty");
  if (empty) empty.hidden = rows.length !== 0;
  rows.forEach(function (row) {
    var profile = byId[row.user_id] || {};
    var tr = document.createElement("tr");
    [profile.nombre || "—", profile.aima_id || "—", profile.email || "—", formatDate(row.created_at), formatAmount(row.amount), row.method].forEach(function (value) {
      var cell = document.createElement("td");
      cell.textContent = value;
      tr.appendChild(cell);
    });
    var statusCell = document.createElement("td");
    var select = document.createElement("select");
    select.setAttribute("aria-label", "Estado de la intención");
    ["pendiente", "en_revision", "archivada"].forEach(function (status) {
      var option = document.createElement("option");
      option.value = status;
      option.textContent = STATUS_LABEL[status];
      if (status === row.status) option.selected = true;
      select.appendChild(option);
    });
    var save = document.createElement("button");
    save.type = "button";
    save.className = "btn";
    save.textContent = "Guardar estado";
    save.addEventListener("click", function () {
      withBusy(save, async function () {
        var updated = await getClient().from("deposit_requests").update({ status: select.value }).eq("id", row.id);
        setMsg("admin-msg", updated.error ? explain(updated.error) : "Estado actualizado. Esto no mueve dinero ni habilita depósitos.", !updated.error);
      });
    });
    statusCell.appendChild(select);
    statusCell.appendChild(document.createElement("br"));
    statusCell.appendChild(save);
    tr.appendChild(statusCell);
    body.appendChild(tr);
  });
}

async function renderAdminNews() {
  var list = $("admin-news");
  if (!list) return;
  var result = await getClient().from("announcements").select("id, title, published, created_at").order("created_at", { ascending: false }).limit(30);
  if (result.error) { setMsg("news-msg", explain(result.error), false); return; }
  list.textContent = "";
  (result.data || []).forEach(function (row) {
    var item = document.createElement("li");
    var label = document.createElement("span");
    label.textContent = row.title + (row.published ? " · visible" : " · oculto");
    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn-ghost";
    toggle.textContent = row.published ? "Ocultar" : "Publicar";
    toggle.addEventListener("click", function () {
      withBusy(toggle, async function () {
        var updated = await getClient().from("announcements").update({ published: !row.published }).eq("id", row.id);
        if (updated.error) { setMsg("news-msg", explain(updated.error), false); return; }
        await renderAdminNews();
      });
    });
    item.appendChild(label);
    item.appendChild(document.createTextNode(" "));
    item.appendChild(toggle);
    list.appendChild(item);
  });
}

async function init() {
  try {
    bindChrome();
    await paintSession();
    var page = document.body.getAttribute("data-page") || "";
    if (pages[page]) await pages[page]();
  } catch (err) {
    setSystem(explain(err));
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
