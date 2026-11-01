// OposiVoz Pro: claves de licencia de Polar comprobadas desde el navegador, sin cuentas y sin secretos en la web.
// Polar (merchant of record) cobra, factura y liquida el IVA; al pagar, el opositor recibe una clave por correo. La web
// la activa en este navegador (endpoint público /customer-portal/license-keys/activate: no lleva token) y la vuelve a
// comprobar como mucho una vez al día. Sin conexión, Pro sigue unos días desde la última comprobación buena.
// Vale en el navegador (window.Pro) y en Node (require) para las pruebas.
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica();
  else raiz.Pro = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const API = { sandbox: "https://sandbox-api.polar.sh", real: "https://api.polar.sh" };
  const COMPROBAR_CADA_H = 24;
  const GRACIA_DIAS = 14;                  // sin conexión (en el metro, en el pueblo), Pro aguanta 14 días
  const SIMULACRO_LARGO = 100;
  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

  // La configuración publicada (pro-config.js) y, solo en localhost, «?pro=sandbox» para probarlo sin tocarla.
  function configurar(base, loc) {
    const cfg = { activo: false, entorno: "sandbox", organizacion: "", pago: {}, portal: "", ...(base || {}) };
    if (cfg.entorno !== "real") cfg.entorno = "sandbox";
    if (loc && LOCAL.test(loc.hostname) && new URLSearchParams(loc.search).get("pro") === "sandbox") {
      cfg.activo = true; cfg.entorno = "sandbox";
    }
    cfg.api = API[cfg.entorno];
    return cfg;
  }

  async function llamar(cfg, ruta, cuerpo, f) {
    let r;
    try {
      r = await f(`${cfg.api}/v1/customer-portal/license-keys/${ruta}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    } catch {
      return { status: 0, datos: null };   // sin red
    }
    let datos = null;
    try { datos = r.status === 204 ? null : await r.json(); } catch { /* sin cuerpo */ }
    return { status: r.status, datos };
  }

  function desdeClave(lk, clave, activacion, ahora) {
    return { clave, activacion: activacion || null, estado: lk.status, caduca: lk.expires_at || null,
      mostrar: lk.display_key || `****-${clave.slice(-6)}`, comprobada: ahora.toISOString() };
  }

  // Activa la clave en este navegador. Devuelve { licencia } o { error: "config" | "clave" | "limite" | "red" | "revocada" }.
  async function activar(clave, cfg, { fetch: f = globalThis.fetch, ahora = new Date(), etiqueta = "OposiVoz en el navegador" } = {}) {
    clave = String(clave || "").trim();
    if (!cfg.organizacion) return { error: "config" };
    if (clave.length < 8) return { error: "clave" };
    const base = { key: clave, organization_id: cfg.organizacion };
    const act = await llamar(cfg, "activate", { ...base, label: etiqueta.slice(0, 80) }, f);
    if (act.status === 0) return { error: "red" };
    if (act.status === 404 || act.status === 422) return { error: "clave" };
    let lic;
    if (act.status === 200 && act.datos && act.datos.license_key) {
      lic = desdeClave(act.datos.license_key, clave, act.datos.id, ahora);
    } else if (act.status === 403) {
      // 403: o se ha llegado al límite de dispositivos, o la clave no usa activaciones. Lo dice la validación.
      const val = await llamar(cfg, "validate", base, f);
      if (val.status === 0) return { error: "red" };
      if (val.status !== 200 || !val.datos) return { error: "clave" };
      if (val.datos.limit_activations) return { error: "limite" };
      lic = desdeClave(val.datos, clave, null, ahora);
    } else {
      return { error: "red" };
    }
    if (lic.estado !== "granted") return { error: "revocada", licencia: lic };
    return { licencia: lic };
  }

  // Vuelve a preguntar a Polar. Sin red, la licencia se queda como estaba (y corre la gracia).
  async function comprobar(lic, cfg, { fetch: f = globalThis.fetch, ahora = new Date() } = {}) {
    const cuerpo = { key: lic.clave, organization_id: cfg.organizacion, ...(lic.activacion ? { activation_id: lic.activacion } : {}) };
    const r = await llamar(cfg, "validate", cuerpo, f);
    if (r.status === 0 || r.status >= 500 || r.status === 429) return { licencia: lic, sinRed: true };
    if (r.status === 200 && r.datos) return { licencia: desdeClave(r.datos, lic.clave, lic.activacion, ahora) };
    // 404: la clave ya no existe, ha caducado o esta activación se quitó desde el portal del cliente
    return { licencia: { ...lic, estado: "no_vale", comprobada: ahora.toISOString() } };
  }

  function esPro(lic, cfg, ahora = new Date()) {
    if (!cfg.activo || !lic || lic.estado !== "granted") return false;
    if (lic.caduca && new Date(lic.caduca) <= ahora) return false;
    return ahora - new Date(lic.comprobada) < GRACIA_DIAS * 864e5;
  }

  function tocaComprobar(lic, ahora = new Date()) {
    return !!lic && ahora - new Date(lic.comprobada) > COMPROBAR_CADA_H * 36e5;
  }

  // Libera el hueco de este dispositivo (para pasar la clave a otro). Lo que diga Polar da igual: aquí se olvida.
  async function quitar(lic, cfg, { fetch: f = globalThis.fetch } = {}) {
    if (lic && lic.activacion) {
      await llamar(cfg, "deactivate", { key: lic.clave, organization_id: cfg.organizacion, activation_id: lic.activacion }, f);
    }
  }

  const MENSAJES = {
    config: "El pago aún no está configurado.",
    clave: "Esa clave no existe. Cópiala tal cual del correo de Polar.",
    limite: "Esa clave ya está activada en el máximo de dispositivos. Quítala de alguno desde el enlace de tu correo.",
    red: "No hay conexión con Polar. Prueba en un momento.",
    revocada: "Esa clave ya no está activa (suscripción cancelada o reembolsada).",
  };

  return { API, COMPROBAR_CADA_H, GRACIA_DIAS, SIMULACRO_LARGO, MENSAJES, configurar, activar, comprobar, esPro, tocaComprobar, quitar };
});
