// OposiVoz beta · cómo opinar o avisar de un fallo. Por defecto, una incidencia en GitHub (no pasa nada por nuestras
// manos). Para cambiar a un correo o a un formulario (Tally, Google Forms…), pon aquí «via» y la dirección y publica.
// Los enlaces con data-opinar (y data-pregunta, data-ley, data-articulo) se rellenan solos con lo que toque.
self.OPOSIVOZ_OPINION = /* config */ {
  "via": "github",
  "correo": "",
  "formulario": ""
} /* fin */;

(function () {
  "use strict";
  const cfg = self.OPOSIVOZ_OPINION;
  const GITHUB = "https://github.com/pab-lit-og/oposivoz/issues/new";

  function enlaceOpinion({ pregunta = "", ley = "", articulo = "", enunciado = "" } = {}) {
    const asunto = pregunta ? `Fallo en la pregunta ${pregunta}` : "Opinión sobre OposiVoz (beta)";
    const cuerpo = pregunta
      ? `Pregunta: ${pregunta}${ley ? ` (${ley}, artículo ${articulo})` : ""}\n${enunciado ? `«${enunciado}»\n` : ""}\nQué está mal:\n`
      : "Qué te ha parecido, qué falta o qué falla (navegador y móvil, si es un fallo):\n";
    if (cfg.via === "correo" && cfg.correo) {
      return `mailto:${cfg.correo}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
    }
    if (cfg.via === "formulario" && cfg.formulario) {
      return cfg.formulario + (cfg.formulario.includes("?") ? "&" : "?") + new URLSearchParams({ asunto, pregunta });
    }
    return `${GITHUB}?${new URLSearchParams({ title: asunto, body: cuerpo })}`;
  }
  self.enlaceOpinion = enlaceOpinion;

  function pintar() {
    for (const a of document.querySelectorAll("a[data-opinar]")) {
      a.href = enlaceOpinion(a.dataset);
      a.target = "_blank"; a.rel = "noopener";
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", pintar);
  else pintar();
})();
