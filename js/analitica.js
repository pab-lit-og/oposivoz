// OposiVoz · estadística anónima y sin cookies (GoatCounter): cuántas visitas hay y cuatro eventos de uso, inicio_test,
// respuesta, fallo_micro y fin_sesion. No sale nada de lo que dices ni tu progreso, y no guarda nada en tu navegador.
// No carga scripts de fuera: manda cada visita al contador de GoatCounter con solo la ruta y, si los hay, los utm_*.
// Apagada mientras «codigo» esté vacío, y solo cuenta en la web publicada (en localhost no).
// Para encenderla: pega el código de la web en GoatCounter (el «xxx» de xxx.goatcounter.com) y publica.
// Para ver los eventos en la consola sin cuenta: localStorage.setItem("oposivoz.medir", "consola")
self.OPOSIVOZ_ANALITICA = {
  "codigo": "",
  "dominio": "pab-lit-og.github.io"
};

(function () {
  "use strict";
  const cfg = self.OPOSIVOZ_ANALITICA;
  let consola = false;
  try { consola = localStorage.getItem("oposivoz.medir") === "consola"; } catch { /* sin almacenamiento */ }
  // ni en local, ni robots, ni si el navegador pide que no le sigan (No rastrear / Global Privacy Control)
  const activa = !!cfg.codigo && location.hostname === cfg.dominio && !navigator.webdriver &&
    navigator.doNotTrack !== "1" && !navigator.globalPrivacyControl;

  function contar(hit) {
    const campana = new URLSearchParams();
    for (const [k, v] of new URLSearchParams(location.search)) if (/^(utm_\w+|ref)$/.test(k)) campana.set(k, v);
    const ref = document.referrer && !document.referrer.startsWith(location.origin) ? document.referrer : "";
    const qs = campana.toString();
    const datos = { p: hit.path, t: hit.title, e: hit.event ? "true" : "", r: hit.event ? "" : ref, s: String(screen.width),
      q: qs ? "?" + qs : "", rnd: Math.random().toString(36).slice(2, 7) };
    const url = `https://${cfg.codigo}.goatcounter.com/count?` + new URLSearchParams(Object.entries(datos).filter(([, v]) => v));
    if (!navigator.sendBeacon || !navigator.sendBeacon(url)) new Image().src = url;
  }

  // GoatCounter cuenta cada nombre de evento una vez por visita, así que el detalle que importa va en el nombre
  const tramo = (n) => (n <= 5 ? "1-5" : n <= 10 ? "6-10" : n <= 20 ? "11-20" : n <= 50 ? "21-50" : "mas_de_50");
  const NOMBRE = {
    inicio_test: (d) => `inicio_test-${d.modo}-${d.voz === "si" ? "con_voz" : "sin_voz"}`,
    respuesta: (d) => `respuesta-${d.via}`,
    fallo_micro: (d) => `fallo_micro-${d.motivo}`,
    fin_sesion: (d) => `fin_sesion-${d.como}-${tramo(d.preguntas)}`,
  };
  const enviados = new Set();   // lo repetido en la misma visita no cuenta más: ni se manda

  window.medir = function (evento, datos) {
    const d = datos || {};
    const nombre = (NOMBRE[evento] || (() => evento))(d);
    if (consola) console.info("[medir]", nombre, d);
    if (!activa || enviados.has(nombre)) return;
    enviados.add(nombre);
    contar({ path: nombre, title: Object.entries(d).map(([k, v]) => `${k} ${v}`).join(" · "), event: true });
  };

  if (!activa) return;
  const visita = () => contar({ path: location.pathname, title: document.title });
  if (document.visibilityState === "prerender") document.addEventListener("visibilitychange", visita, { once: true });
  else visita();
})();
