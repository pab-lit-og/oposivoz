"use strict";
// Portada: los vídeos solo se reproducen mientras se ven, la tira marca el momento del día y cada orden se enciende cuando el vídeo la recibe.
(() => {
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const quieto = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------------ vídeos: se piden al acercarse, suenan solo si se ven
  for (const fig of $$(".movil")) {
    const v = fig.querySelector("video"), b = fig.querySelector(".pausar");
    let pausado = quieto;
    const pintar = () => { if (b) b.textContent = v.paused ? "Reproducir" : "Pausar"; };
    const cargar = () => { if (v.dataset.src) { v.src = v.dataset.src; delete v.dataset.src; } };
    const seguir = () => { if (!pausado) { cargar(); v.play().catch(() => { /* el navegador lo impide: queda el póster y el botón */ }); } };
    v.addEventListener("play", pintar);
    v.addEventListener("pause", pintar);
    b?.addEventListener("click", () => { pausado = !v.paused; cargar(); if (pausado) v.pause(); else v.play().catch(() => {}); });
    new IntersectionObserver(([e]) => { if (e.isIntersecting) seguir(); else v.pause(); }, { threshold: 0.35 }).observe(fig);
    new IntersectionObserver(([e]) => { if (e.isIntersecting) cargar(); }, { rootMargin: "60% 0px" }).observe(fig);
    pintar();
  }

  // ------------------------------------------------------------------ lo que suena en cada grabación, como un mensaje que sale del móvil
  const ICONO = {
    voz: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path class="trazo" d="M15 9a4 4 0 0 1 0 6M17.6 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
    tu: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path class="trazo" d="M6 11a6 6 0 0 0 12 0M12 17v4"/></svg>',
  };
  for (const fig of $$(".movil[data-voz]")) {
    const v = fig.querySelector("video"), frases = JSON.parse(fig.dataset.voz);
    const b = document.createElement("p");
    b.className = "voz-burbuja"; b.setAttribute("aria-hidden", "true");
    b.innerHTML = '<span class="voz-icono"></span><span class="voz-texto"></span><span class="voz-barras"><i></i><i></i><i></i></span>';
    fig.append(b);
    const icono = b.querySelector(".voz-icono"), texto = b.querySelector(".voz-texto");
    let actual = null;
    const poner = (f) => {
      if (f === actual) return;
      actual = f;
      b.classList.toggle("ver", !!f);
      if (!f) return;
      b.dataset.quien = f[2]; icono.innerHTML = ICONO[f[2]]; texto.textContent = f[3];
    };
    if (quieto) poner(frases.find((f) => f[2] === "tu") || frases[0]);
    else v.addEventListener("timeupdate", () => poner(frases.find((f) => v.currentTime >= f[0] && v.currentTime < f[1]) || null));
  }

  // ------------------------------------------------------------------ la tira del día
  const enlaces = $$(".tira li a");
  const marcar = new IntersectionObserver((vistas) => {
    for (const e of vistas) {
      if (!e.isIntersecting) continue;
      enlaces.forEach((a) => a.setAttribute("aria-current", String(a.getAttribute("href") === `#${e.target.id}`)));
    }
  }, { rootMargin: "-45% 0px -50% 0px" });
  $$(".momento").forEach((m) => marcar.observe(m));

  // ------------------------------------------------------------------ las órdenes se encienden cuando el vídeo las recibe (tiempos de grabar_portada)
  for (const lista of $$(".dichos")) {
    const v = lista.closest(".momento").querySelector("video");
    const con = $$("li[data-desde]", lista);
    v.addEventListener("timeupdate", () => { for (const li of con) li.classList.toggle("dicho", v.currentTime >= li.dataset.desde && v.currentTime < li.dataset.hasta); });
  }

  // ------------------------------------------------------------------ temario: barras y fecha del banco
  const lista = document.getElementById("leyes-portada");
  if (lista) {
    const leyes = $$("li", lista).map((li) => ({ li, n: parseInt((li.querySelector(".etiqueta") || li).textContent.replace(/\D/g, ""), 10) || 0 }));
    const max = Math.max(1, ...leyes.map((l) => l.n));
    leyes.forEach((l) => l.li.style.setProperty("--nivel", (l.n / max).toFixed(3)));
  }
  const total = document.getElementById("total-preguntas");   // en el HTML va «1050», que es lo que escribe herramientas/paginas.py
  if (total) total.textContent = total.textContent.replace(/^(\d)(\d{3}) /, "$1.$2 ");
  const fecha = document.getElementById("temario-fecha");
  if (fecha) fetch("bancos/indice.json").then((r) => r.json()).then((d) => {
    const dia = (d.leyes || []).map((l) => l.actualizado).filter(Boolean).sort().pop();
    if (!dia) return;
    const [a, me, di] = dia.split("-").map(Number);
    fecha.textContent = `Banco actualizado el ${di}/${me}/${a}.`;
    fecha.hidden = false;
  }).catch(() => { /* sin fecha si no carga */ });
})();
