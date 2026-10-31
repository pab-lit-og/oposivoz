// OposiVoz · la app: voz del navegador (speechSynthesis), oído del navegador (SpeechRecognition) y pantalla.
// Qué preguntar, qué ha querido decir y la nota están en motor.js. El progreso se guarda solo en este navegador.
"use strict";

const $ = (id) => document.getElementById(id);
const M = window.Motor;
const guardado = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};
const CLAVE = "oposivoz.progreso.v1";
const SIMULACRO = 20;
const CONF = {
  modo: guardado.get("oposivoz.modo", "mixto"), leyes: guardado.get("oposivoz.leyes", []),
  explicar: guardado.get("oposivoz.explicar", false), microfono: guardado.get("oposivoz.microfono", true),
  voz: guardado.get("oposivoz.voz", ""), vel: guardado.get("oposivoz.vel", 1),
};
const E = {
  activo: false, pausa: false, numero: 0, actual: null, anterior: null, respondida: false, ultimo: null, recientes: [],
  sesion: { aciertos: 0, fallos: 0, blancos: 0 }, racha: 0, consejo: false, avisoSilencio: false, nadas: 0,
  hablando: false, vozFin: 0, inicioHabla: 0, sonando: "", sonandoAntes: "", silencio: null, wake: null,
};
let BANCO = [], LEYES = [];
let P = cargarProgreso();

function cargarProgreso() {
  const p = guardado.get(CLAVE, null);
  return p && p.preguntas && Array.isArray(p.historial) ? p : M.nuevoProgreso();
}
function guardar() {
  if (!guardado.set(CLAVE, P)) aviso("Este navegador no deja guardar: el progreso se perderá al cerrar.");
}
function guardarConf() { for (const k of Object.keys(CONF)) guardado.set("oposivoz." + k, CONF[k]); }

function aviso(msg) {
  const t = $("toast");
  t.textContent = msg; t.classList.add("ver");
  clearTimeout(aviso.t); aviso.t = setTimeout(() => t.classList.remove("ver"), 2800);
}
function estado(e) {
  const t = { habla: "Hablando", escucha: "Te escucho", oye: "Te oigo…", pausa: "En pausa", listo: "Preparado", toca: "Toca para contestar" }[e] || e;
  $("estado").dataset.e = e;
  $("estado-txt").textContent = t;
}
const coma = (n) => String(n).replace(".", ",");
const ley = (id) => LEYES.find((l) => l.ley === id) || { corto: id };

// ------------------------------------------------------------------ voz (la del dispositivo)
const HAY_VOZ = "speechSynthesis" in window;
let VOCES = [];
function cargarVoces() {
  if (!HAY_VOZ) return;
  const puntos = (v) => (v.lang.toLowerCase().replace("_", "-") === "es-es" ? 4 : 0) +
    (/natural|online|neural|premium|enhanced|mejorad/i.test(v.name) ? 3 : 0) + (/google/i.test(v.name) ? 1 : 0);
  VOCES = speechSynthesis.getVoices().filter((v) => /^es\b|^es[-_]/i.test(v.lang)).sort((a, b) => puntos(b) - puntos(a));
  const sel = $("a-voz");
  sel.innerHTML = VOCES.length ? VOCES.map((v) => `<option value="${v.name.replace(/"/g, "&quot;")}">${v.name} (${v.lang})</option>`).join("")
    : `<option value="">Voz en español por defecto</option>`;
  if (CONF.voz && VOCES.some((v) => v.name === CONF.voz)) sel.value = CONF.voz;
}
const vozElegida = () => VOCES.find((v) => v.name === CONF.voz) || VOCES[0] || null;

let turno = 0, corte = null;
function cortarVoz() {
  if (corte) { const c = corte; corte = null; c("cortado"); }
  if (HAY_VOZ) speechSynthesis.cancel();
}
// Dice las frases en orden. Devuelve "fin", o "cortado" si otra frase o una orden lo interrumpe.
async function hablar(trozos) {
  cortarVoz();
  dejarDeEscuchar();
  const mio = ++turno;
  E.hablando = true; estado("habla");
  try {
    if (!HAY_VOZ) return "fin";
    for (const t of trozos || []) {
      if (turno !== mio) return "cortado";
      E.sonandoAntes = E.sonando; E.sonando = t;
      const fin = await new Promise((ok) => {
        corte = ok;
        const u = new SpeechSynthesisUtterance(t);
        const v = vozElegida();
        if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "es-ES";
        u.rate = CONF.vel;
        u.onend = () => ok("fin");
        u.onerror = (e) => ok(e.error === "interrupted" || e.error === "canceled" ? "cortado" : "fin");
        speechSynthesis.speak(u);
        // algunos navegadores se olvidan del onend: salvavidas por la duración esperable de la frase
        setTimeout(() => ok("fin"), Math.max(4000, (t.length * 110) / CONF.vel + 3000));
      });
      if (turno === mio) corte = null;
      if (fin === "cortado") return "cortado";
    }
    return "fin";
  } finally {
    if (turno === mio) {
      E.hablando = false; E.vozFin = Date.now();
      estado(E.pausa ? "pausa" : E.activo ? estadoEspera() : "listo");
      if (E.activo && !E.pausa) escuchar();
    }
  }
}

// ------------------------------------------------------------------ oído (el del navegador, por turnos: nunca mientras habla)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, escuchando = false, micDenegado = false;
function escuchar() {
  if (!SR || !CONF.microfono || micDenegado || !E.activo || E.pausa || E.hablando || escuchando) return;
  if (!rec) {
    rec = new SR();
    rec.lang = "es-ES"; rec.continuous = true; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onspeechstart = () => { E.inicioHabla = Date.now(); if (!E.hablando) estado("oye"); };
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) oir(e.results[i][0].transcript, E.inicioHabla);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        micDenegado = true;
        sinMicro("El navegador no deja usar el micrófono. Contesta tocando la opción o con las teclas A–D.");
      }
    };
    rec.onend = () => {
      escuchando = false;
      if (E.activo && !E.pausa && !E.hablando) setTimeout(escuchar, 300);   // se corta solo tras un silencio: se reanuda
    };
  }
  try { rec.start(); escuchando = true; if (!E.hablando) estado("escucha"); } catch { /* ya estaba en marcha */ }
}
const puedeOir = () => !!SR && CONF.microfono && !micDenegado;
const estadoEspera = () => (puedeOir() ? "escucha" : "toca");
const textoSinMicro = () => (!SR ? "Este navegador no reconoce la voz: toca la respuesta o usa las teclas A–D."
  : micDenegado ? "Sin permiso para el micrófono: toca la respuesta o usa las teclas A–D."
  : "Micrófono desactivado en Ajustes: toca la respuesta.");
function dejarDeEscuchar() {
  if (rec && escuchando) { try { rec.abort(); } catch { /* ya parado */ } }
  escuchando = false;
}
function sinMicro(msg) {
  $("sin-voz").textContent = msg; $("sin-voz").hidden = false;
  if (E.activo) $("oido").textContent = msg;
  estado("toca");
}

// ------------------------------------------------------------------ pantalla
function pintarMarcador() {
  const s = E.sesion;
  $("contador").textContent = `Pregunta ${E.numero}${CONF.modo === "simulacro" ? ` de ${SIMULACRO}` : ""}`;
  $("m-bien").textContent = `✓ ${s.aciertos}`; $("m-mal").textContent = `✗ ${s.fallos}`; $("m-blanco").textContent = `– ${s.blancos}`;
  const n = M.nota([...Array(s.aciertos).fill("acierto"), ...Array(s.fallos).fill("fallo"), ...Array(s.blancos).fill("blanco")]);
  $("m-nota").textContent = n === null || CONF.modo === "simulacro" ? "" : `nota ${coma(n)}`;
}

function pintarPregunta() {
  const x = E.actual;
  pintarMarcador();
  $("ley-actual").textContent = `${ley(x.ley).corto} · ${x.cita}`;
  $("enunciado").textContent = x.enunciado;
  $("opciones").innerHTML = "";
  for (const k of M.LETRAS) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.dataset.letra = k;
    b.innerHTML = `<span class="letra">${k}</span><span></span>`;
    b.lastChild.textContent = x.opciones[k];
    b.addEventListener("click", () => responder(k));
    li.appendChild(b); $("opciones").appendChild(li);
  }
  $("explicacion").hidden = true; $("b-sigue").hidden = true; $("b-nose").hidden = false;
  $("oido").textContent = puedeOir() ? "" : textoSinMicro();
}

function pintarCorreccion(letra, res) {
  const x = E.actual;
  for (const b of $("opciones").querySelectorAll("button")) {
    b.disabled = true;
    if (CONF.modo === "simulacro") { if (b.dataset.letra === letra) b.classList.add("marcada"); continue; }
    if (b.dataset.letra === x.correcta) b.classList.add("bien");
    else if (b.dataset.letra === letra) b.classList.add("mal");
  }
  if (CONF.modo !== "simulacro") {
    $("explicacion").innerHTML = "";
    $("explicacion").append(document.createTextNode(x.explicacion));
    const c = document.createElement("cite"); c.textContent = `${ley(x.ley).nombre || ley(x.ley).corto}, ${x.cita}`;
    $("explicacion").append(c);
    $("explicacion").hidden = false;
  }
  $("b-sigue").hidden = false; $("b-nose").hidden = true;
  pintarMarcador();
  if (res === "acierto" && CONF.modo !== "simulacro") $("oido").textContent = "";
}

function cifras(r) {
  const c = (v, t) => `<div class="cifra"><b>${v}</b><span>${t}</span></div>`;
  return c(`${r.vistas}<span style="font-size:18px">/${r.total}</span>`, "preguntas vistas") + c(r.dominadas, "dominadas") +
    c(r.repasos, "repasos que tocan") + c(r.nota === null ? "—" : coma(r.nota), r.nota === null ? "nota estimada" : `nota (últimas ${r.respondidas})`);
}

function pintarInicio() {
  $("cifras").innerHTML = cifras(M.resumen(P, BANCO, LEYES));
  for (const b of $("modos").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.modo === CONF.modo));
  $("leyes").hidden = CONF.modo !== "ley";
  $("leyes").innerHTML = LEYES.map((l) => `<button data-ley="${l.ley}" aria-pressed="${CONF.leyes.includes(l.ley)}">${l.corto}<small>${l.n}</small></button>`).join("");
}

// ------------------------------------------------------------------ el examen
function siguientePregunta() {
  return M.elegir(P, BANCO, {
    modo: CONF.modo === "ley" ? "mixto" : CONF.modo, leyes: CONF.modo === "ley" ? CONF.leyes : null, excluir: E.recientes,
  });
}

async function preguntar() {
  if (!E.activo || E.pausa) return;
  clearTimeout(E.silencio);
  if (CONF.modo === "simulacro" && E.numero >= SIMULACRO) return terminar();
  const x = siguientePregunta();
  if (!x) {
    E.respondida = true;
    await hablar([CONF.modo === "falladas" ? "No te queda ninguna fallada. Di «de todo» para seguir con todo mezclado."
      : "No me quedan preguntas así. Di «de todo» para mezclarlo todo."]);
    return;
  }
  E.anterior = E.ultimo ? { explicaVoz: [`Es la ${M.DICHO[E.actual.correcta]}.`, ...E.actual.voz_explicacion] } : null;
  E.actual = x; E.respondida = false; E.ultimo = null; E.numero++; E.avisoSilencio = false; E.nadas = 0;
  E.recientes.push(x.id);
  if (CONF.modo !== "simulacro") E.recientes = E.recientes.slice(-6);
  pintarPregunta();
  if ((await hablar([`Pregunta ${E.numero}, de ${ley(x.ley).corto}.`, ...x.voz])) === "fin" && E.actual === x && !E.respondida) esperar();
}

// tras leer la pregunta: si en 30 s no dices nada, un recordatorio (una vez)
function esperar() {
  if (!E.activo || E.pausa) return;
  clearTimeout(E.silencio);
  E.silencio = setTimeout(async () => {
    if (E.respondida || !E.activo || E.pausa || E.hablando || E.avisoSilencio) return;
    E.avisoSilencio = true;
    await hablar(["¿La tienes? Si no, di paso."]);
  }, 30000);
}

// después de hablar: si está contestada, a la siguiente; si no, a esperar la respuesta
function continuar(pausaMs = 800) {
  if (!E.activo || E.pausa || E.hablando) return;
  if (!E.respondida) return esperar();
  const x = E.actual;
  setTimeout(() => { if (E.actual === x && E.respondida && !E.hablando && !E.pausa) preguntar(); }, pausaMs);
}

async function responder(letra) {
  if (!E.activo || !E.actual || E.respondida) return;
  E.respondida = true; clearTimeout(E.silencio); cortarVoz();
  const x = E.actual;
  const sim = CONF.modo === "simulacro";
  const r = M.registrar(P, x.id, letra, x.correcta, { simulacro: sim });
  guardar();
  if (r.res === "acierto") { E.sesion.aciertos++; E.racha++; }
  else { E.sesion[r.res === "fallo" ? "fallos" : "blancos"]++; E.racha = 0; }
  const voz = sim ? ["Apuntada."] : M.vozCorreccion(x, r.res, { racha: E.racha, explicarAciertos: CONF.explicar });
  E.ultimo = { res: r.res, voz, explicaVoz: [`Es la ${M.DICHO[x.correcta]}.`, ...x.voz_explicacion] };
  pintarCorreccion(letra, r.res);
  // tras un acierto, un poco más de margen por si quieres preguntar «¿por qué?»
  if ((await hablar(voz)) === "fin") continuar(r.res === "acierto" && !CONF.explicar ? 1600 : 900);
}

async function decirYSeguir(trozos) { if ((await hablar(trozos)) === "fin") continuar(); }

function cambiarModo(modo, leyes) {
  CONF.modo = modo;
  if (leyes) CONF.leyes = leyes;
  guardarConf(); pintarMarcador();
}

async function saltarA(frase) {
  E.respondida = true; clearTimeout(E.silencio);   // la pregunta a medias no cuenta
  if ((await hablar([frase])) === "fin") preguntar();
}

async function oir(texto, tInicio) {
  if (!E.activo || !texto) return;
  if (M.esEco(texto, { sonando: E.sonando, anterior: E.sonandoAntes, hablando: E.hablando, msDesdeFin: Date.now() - E.vozFin,
    inicioTrasFin: tInicio > E.vozFin + 150 })) return;
  $("oido").textContent = `«${texto.trim()}»`;
  const it = M.interpretar(texto, { pregunta: E.actual, respondida: E.respondida, leyes: LEYES });
  if (E.pausa && !["seguir", "para", "siguiente", "repite"].includes(it.tipo)) return;
  switch (it.tipo) {
    case "para": return terminar();
    case "pausa": return pausar(true);
    case "seguir":
      if (E.pausa) return pausar(false);
      if (E.respondida) return preguntar();
      return;
    case "respuesta": return responder(it.letra);
    case "no_se":
      if (E.respondida) return;
      if (!E.consejo && CONF.modo !== "simulacro") { E.consejo = true; return decirYSeguir([M.CONSEJO_NO_SE]); }
      return responder(null);
    case "repite":
      if (E.pausa) pausar(false, false);
      return decirYSeguir(E.respondida && E.ultimo ? E.ultimo.voz : [`Pregunta ${E.numero}.`, ...E.actual.voz]);
    case "opciones": return E.actual && decirYSeguir(E.actual.voz_opciones);
    case "explica":
      if (E.respondida && E.ultimo) return decirYSeguir(E.ultimo.explicaVoz);
      if (E.anterior) {   // «¿por qué?» de la anterior cuando ya empezaba la siguiente
        const prev = E.anterior; E.anterior = null;
        if ((await hablar(["Sobre la anterior:", ...prev.explicaVoz])) === "fin") decirYSeguir(E.actual.voz);
      }
      return;
    case "siguiente":
      if (E.pausa) pausar(false, false);
      if (E.respondida) { cortarVoz(); return preguntar(); }
      return;
    case "como_voy": return decirYSeguir(M.vozComoVoy(E.sesion, M.resumen(P, BANCO, LEYES)));
    case "leyes": cambiarModo("ley", it.leyes); return saltarA(`Vale, de ${it.nombres.join(" y ")}.`);
    case "falladas": cambiarModo("falladas"); return saltarA("Vale, solo las que has fallado.");
    case "mixto": cambiarModo("mixto"); return saltarA("Vale, de todo mezclado.");
    case "simulacro":
      cerrarSesion();
      E.sesion = { aciertos: 0, fallos: 0, blancos: 0 }; E.numero = 0; E.recientes = [];
      cambiarModo("simulacro");
      return saltarA(`Simulacro de ${SIMULACRO}. No te corrijo hasta el final, como en el examen.`);
    default:
      // algo que no es una respuesta: a la segunda vez se lo dice
      if (!E.respondida && !E.hablando && M.normaliza(texto).length >= 2 && ++E.nadas >= 2) {
        E.nadas = 0;
        return decirYSeguir(["No te he entendido. Dime la letra: a, be, ce o de."]);
      }
  }
}

function pausar(si, hablarAlSeguir = true) {
  E.pausa = si;
  $("b-pausa").textContent = si ? "Seguir" : "Pausa";
  if (si) { cortarVoz(); dejarDeEscuchar(); clearTimeout(E.silencio); estado("pausa"); return; }
  estado(estadoEspera());
  if (!hablarAlSeguir) { escuchar(); return; }
  if (E.respondida || !E.actual) preguntar();
  else decirYSeguir([`Pregunta ${E.numero}.`, ...E.actual.voz]);
}

async function empezar() {
  guardarConf();
  if (CONF.modo === "ley" && !CONF.leyes.length) { aviso("Elige al menos una ley."); return; }
  if (!BANCO.length) { aviso("Aún no se han cargado las preguntas."); return; }
  E.activo = true; E.pausa = false; E.numero = 0; E.sesion = { aciertos: 0, fallos: 0, blancos: 0 }; E.racha = 0;
  E.recientes = []; E.consejo = false; E.actual = null; E.anterior = null; E.ultimo = null;
  $("inicio").hidden = true; $("final").hidden = true; $("examen").hidden = false;
  $("b-pausa").textContent = "Pausa";
  try { E.wake = await navigator.wakeLock?.request("screen"); } catch { /* sin bloqueo de pantalla */ }
  if (!puedeOir()) $("oido").textContent = textoSinMicro();
  const saludo = CONF.modo === "simulacro" ? `Simulacro de ${SIMULACRO}. No te corrijo hasta el final.`
    : CONF.modo === "falladas" ? "Vamos con las que has fallado." : "Vamos allá.";
  if ((await hablar([saludo])) === "fin") preguntar();
}

function cerrarSesion() {
  const s = E.sesion;
  if (s.aciertos + s.fallos + s.blancos) {
    P.sesiones.push({ fin: new Date().toISOString().slice(0, 19), modo: CONF.modo, ...s });
    P.sesiones = P.sesiones.slice(-300);
    guardar();
  }
}

async function terminar() {
  if (!E.activo) return;
  E.activo = false; clearTimeout(E.silencio); cortarVoz(); dejarDeEscuchar();
  try { E.wake?.release(); } catch { /* ya liberado */ }
  cerrarSesion();
  const s = E.sesion, n = s.aciertos + s.fallos + s.blancos;
  const voz = M.vozResumen(s);
  const r = M.resumen(P, BANCO, LEYES);
  $("examen").hidden = true; $("final").hidden = false;
  $("final-titulo").textContent = n ? `${s.aciertos} de ${n}` : "Sin preguntas";
  $("final-texto").textContent = voz.join(" ");
  $("final-cifras").innerHTML = cifras(r);
  const filas = r.leyes.filter((l) => l.vistas);
  $("tabla-leyes").innerHTML = filas.length ? `<tr><th>Ley</th><th>Vistas</th><th>Acierto</th><th>Dominadas</th></tr>` +
    filas.map((l) => `<tr><td>${l.corto}</td><td class="num">${l.vistas}/${l.n}</td><td class="num">${l.acierto ?? "—"} %</td><td class="num">${l.dominadas}</td></tr>`).join("") : "";
  estado("listo");
  await hablar(voz);
}

// ------------------------------------------------------------------ ajustes: voz, micro y llevar el progreso
function codigoDe(p) { return "OV1:" + btoa(unescape(encodeURIComponent(JSON.stringify(p)))); }
function progresoDe(c) {
  const t = c.trim();
  if (!t.startsWith("OV1:")) throw new Error("formato");
  const p = JSON.parse(decodeURIComponent(escape(atob(t.slice(4)))));
  if (!p || typeof p.preguntas !== "object" || !Array.isArray(p.historial)) throw new Error("contenido");
  return p;
}
function abrirAjustes(si) {
  $("ajustes").hidden = !si;
  $("b-ajustes").setAttribute("aria-expanded", String(si));
  if (si) { cargarVoces(); $("a-vel").value = CONF.vel; $("a-vel-txt").textContent = coma(Number(CONF.vel).toFixed(2)); }
}
$("b-ajustes").addEventListener("click", () => abrirAjustes($("ajustes").hidden));
$("a-cerrar").addEventListener("click", () => abrirAjustes(false));
$("a-voz").addEventListener("change", (e) => { CONF.voz = e.target.value; guardarConf(); hablar(["Así sueno yo."]); });
$("a-vel").addEventListener("input", (e) => { CONF.vel = Number(e.target.value); $("a-vel-txt").textContent = coma(CONF.vel.toFixed(2)); guardarConf(); });
$("a-vel").addEventListener("change", () => hablar(["Así de rápido leeré las preguntas."]));
$("a-microfono").checked = CONF.microfono;
$("a-microfono").addEventListener("change", (e) => { CONF.microfono = e.target.checked; guardarConf(); if (!CONF.microfono) dejarDeEscuchar(); });
$("a-explicar").checked = CONF.explicar;
$("a-explicar").addEventListener("change", (e) => { CONF.explicar = e.target.checked; guardarConf(); });
$("a-exportar").addEventListener("click", async () => {
  const c = codigoDe(P);
  try { await navigator.clipboard.writeText(c); aviso("Código copiado: pégalo en el otro dispositivo."); }
  catch { $("a-codigo").hidden = false; $("a-codigo").value = c; $("a-codigo").select(); aviso("Copia el código del recuadro."); }
});
$("a-importar").addEventListener("click", () => {
  const caja = $("a-codigo");
  if (caja.hidden || !caja.value.trim()) { caja.hidden = false; caja.value = ""; caja.focus(); aviso("Pega el código y vuelve a pulsar «Pegar código»."); return; }
  try { P = progresoDe(caja.value); guardar(); pintarInicio(); caja.value = ""; caja.hidden = true; aviso("Progreso cargado."); }
  catch { aviso("Ese código no es válido."); }
});
$("a-borrar").addEventListener("click", () => {
  if (!confirm("¿Borrar todo tu progreso en este navegador? No se puede deshacer.")) return;
  P = M.nuevoProgreso(); guardar(); pintarInicio(); aviso("Progreso borrado.");
});

// ------------------------------------------------------------------ eventos
$("modos").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-modo]");
  if (b) { CONF.modo = b.dataset.modo; guardarConf(); pintarInicio(); }
});
$("leyes").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-ley]");
  if (!b) return;
  const id = b.dataset.ley;
  CONF.leyes = CONF.leyes.includes(id) ? CONF.leyes.filter((x) => x !== id) : [...CONF.leyes, id];
  guardarConf(); pintarInicio();
});
$("empezar").addEventListener("click", empezar);
$("otra").addEventListener("click", () => { $("final").hidden = true; $("inicio").hidden = false; pintarInicio(); });
$("b-repite").addEventListener("click", () => decirYSeguir(E.respondida && E.ultimo ? E.ultimo.voz : [`Pregunta ${E.numero}.`, ...E.actual.voz]));
$("b-nose").addEventListener("click", () => responder(null));
$("b-sigue").addEventListener("click", () => { cortarVoz(); preguntar(); });
$("b-pausa").addEventListener("click", () => pausar(!E.pausa));
$("b-fin").addEventListener("click", terminar);
document.addEventListener("keydown", (e) => {
  if (!E.activo || (e.target instanceof Element && e.target.closest("input, textarea, select")) || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const letra = { a: "a", b: "b", c: "c", d: "d", 1: "a", 2: "b", 3: "c", 4: "d" }[k];
  if (letra) responder(letra);
  else if (k === "n") responder(null);
  else if (k === "r") $("b-repite").click();
  else if (k === "enter" && E.respondida) $("b-sigue").click();
  else if (k === " ") pausar(!E.pausa);
  else return;
  e.preventDefault();
});
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && E.activo) try { E.wake = await navigator.wakeLock?.request("screen"); } catch { /* sin bloqueo */ }
});

// ------------------------------------------------------------------ arranque
async function cargarBancos() {
  try {
    const ind = await fetch("bancos/indice.json", { cache: "no-cache" }).then((r) => r.json());
    LEYES = ind.leyes;
    const bancos = await Promise.all(LEYES.map((l) => fetch(`bancos/${l.ley}.json?v=${l.version}`).then((r) => r.json())));
    bancos.forEach((b, i) => { LEYES[i].nombre = b.nombre; });
    BANCO = bancos.flatMap((b) => b.preguntas);
    CONF.leyes = CONF.leyes.filter((id) => LEYES.some((l) => l.ley === id));
  } catch {
    aviso("No se han podido cargar las preguntas. Revisa la conexión.");
  }
  pintarInicio();
}

if (HAY_VOZ) { cargarVoces(); speechSynthesis.addEventListener?.("voiceschanged", cargarVoces); }
if (!HAY_VOZ) sinMicro("Este navegador no puede leer en voz alta: verás las preguntas en pantalla.");
else if (!SR) { $("sin-voz").textContent = "Este navegador no reconoce la voz: contestarás tocando la opción (Chrome, Edge y Safari sí la reconocen)."; $("sin-voz").hidden = false; }
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
estado("listo");
cargarBancos();
