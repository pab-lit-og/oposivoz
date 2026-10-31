// OposiVoz · motor: repaso espaciado, qué pregunta toca, qué ha querido decir el opositor y la nota.
// Es la versión web del examinador de Álvaro (entrenador-personal/examinador.py). Sin dependencias; vale en el
// navegador (window.Motor) y en Node (require) para las pruebas.
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica();
  else raiz.Motor = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LETRAS = ["a", "b", "c", "d"];
  const DICHO = { a: "A", b: "Be", c: "Ce", d: "De" };
  const PENALIZACION = 0.25;                                 // cada fallo resta 1/4 de acierto
  const INTERVALO_DIAS = { 1: 1, 2: 1, 3: 3, 4: 7, 5: 16, 6: 35 };   // cajas de Leitner
  const REPESCA_MIN = 8;                                     // una fallada vuelve en la misma sesión
  const CONSEJO_NO_SE = "Mójate: con cuatro opciones y un cuarto de penalización, arriesgar siempre suma a la larga. " +
    "¿Cuál te suena más? Si de verdad no, di paso.";

  // ------------------------------------------------------------------ texto
  function normaliza(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ñ/g, "n")
      .replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  }
  const iso = (d) => d.toISOString().slice(0, 19);
  const sumar = (d, ms) => new Date(d.getTime() + ms);

  // ------------------------------------------------------------------ progreso
  function nuevoProgreso() { return { v: 1, preguntas: {}, historial: [], sesiones: [] }; }

  // Apunta la respuesta y mueve la pregunta de caja. letra = null es en blanco ("no sé").
  function registrar(p, id, letra, correcta, { simulacro = false, ahora = new Date() } = {}) {
    if (!p.preguntas[id]) p.preguntas[id] = { caja: 0, vistas: 0, aciertos: 0, fallos: 0, blancos: 0 };
    const e = p.preguntas[id];
    const nueva = e.vistas === 0;
    e.vistas++;
    e.ultima = iso(ahora);
    let res;
    if (letra == null) { e.blancos++; res = "blanco"; }
    else if (letra === correcta) { e.aciertos++; res = "acierto"; }
    else { e.fallos++; res = "fallo"; }
    if (res === "acierto") {
      e.caja = nueva ? 3 : Math.min(6, Math.max(e.caja, 1) + 1);   // acertada a la primera: ya se sabía
      e.proxima = iso(sumar(ahora, INTERVALO_DIAS[e.caja] * 864e5));
    } else {
      e.caja = 1;
      e.proxima = iso(sumar(ahora, REPESCA_MIN * 6e4));
    }
    p.historial.push({ id, r: res, t: iso(ahora), ...(simulacro ? { sim: true } : {}) });
    if (p.historial.length > 600) p.historial = p.historial.slice(-600);
    return { res, e, nueva };
  }

  // Nota sobre 10 como en el examen: aciertos − fallos/4, sobre el total (las en blanco cuentan 0).
  function nota(respuestas) {
    const a = respuestas.filter((r) => r === "acierto").length;
    const f = respuestas.filter((r) => r === "fallo").length;
    const n = respuestas.length;
    return n ? Math.round(Math.max(0, a - PENALIZACION * f) / n * 100) / 10 : null;
  }

  function resumen(p, preguntas, leyes = [], ahora = new Date()) {
    const q = p.preguntas;
    const t = iso(ahora);
    const ids = new Set(preguntas.map((x) => x.id));
    const vistas = Object.keys(q).filter((id) => ids.has(id) && q[id].vistas);
    const hist = p.historial.filter((h) => !h.sim).slice(-100).map((h) => h.r);
    const porLey = leyes.map((l) => {
      const suyas = preguntas.filter((x) => x.ley === l.ley).map((x) => x.id);
      const vis = suyas.filter((id) => q[id] && q[id].vistas);
      const ac = vis.reduce((s, id) => s + q[id].aciertos, 0);
      const tot = vis.reduce((s, id) => s + q[id].vistas, 0);
      return { ley: l.ley, corto: l.corto, n: suyas.length, vistas: vis.length,
        dominadas: vis.filter((id) => q[id].caja >= 4).length, acierto: tot ? Math.round(ac / tot * 100) : null };
    });
    return {
      total: preguntas.length, vistas: vistas.length, dominadas: vistas.filter((id) => q[id].caja >= 4).length,
      falladas: vistas.filter((id) => q[id].caja <= 2 && (q[id].fallos || q[id].blancos)).length,
      repasos: vistas.filter((id) => q[id].caja <= 2 && (q[id].proxima || "") <= t).length,
      nota: nota(hist), respondidas: hist.length, dias: new Set(p.historial.map((h) => h.t.slice(0, 10))).size, leyes: porLey,
    };
  }

  // ------------------------------------------------------------------ qué pregunta toca
  function elegirPeso(lista, rnd) {
    return lista[Math.min(lista.length - 1, Math.floor(rnd() * lista.length))];
  }

  // Primero los repasos que tocan (las falladas vuelven), luego nuevas; en simulacro, cualquiera.
  function elegir(p, preguntas, { modo = "mixto", leyes = null, excluir = [], rnd = Math.random, ahora = new Date() } = {}) {
    const fuera = new Set(excluir);
    const pool = preguntas.filter((x) => (!leyes || !leyes.length || leyes.includes(x.ley)) && !fuera.has(x.id));
    if (!pool.length) return null;
    const q = p.preguntas;
    const t = iso(ahora);
    if (modo === "falladas") {
      const fall = pool.filter((x) => q[x.id] && q[x.id].caja <= 2 && (q[x.id].fallos || q[x.id].blancos))
        .sort((a, b) => (q[a.id].proxima || "").localeCompare(q[b.id].proxima || ""));
      return fall[0] || null;
    }
    if (modo === "simulacro") return elegirPeso(pool, rnd);
    const vencidas = pool.filter((x) => q[x.id] && (q[x.id].proxima || "9") <= t)
      .sort((a, b) => q[a.id].caja - q[b.id].caja || (q[a.id].proxima || "").localeCompare(q[b.id].proxima || ""));
    const nuevas = pool.filter((x) => !q[x.id]);
    if (vencidas.length && (!nuevas.length || rnd() < 0.7)) return vencidas[0];
    if (nuevas.length) return elegirPeso(nuevas, rnd);
    return pool.slice().sort((a, b) => (q[a.id].proxima || "").localeCompare(q[b.id].proxima || ""))[0];
  }

  // ------------------------------------------------------------------ qué ha querido decir
  const LETRA = { a: "a", ah: "a", ha: "a", b: "b", be: "b", ve: "b", uve: "b", v: "b", bee: "b",
    c: "c", ce: "c", se: "c", ze: "c", d: "d", de: "d", dee: "d" };
  const ORDINAL = { uno: "a", una: "a", primera: "a", primero: "a", 1: "a", dos: "b", segunda: "b", segundo: "b", 2: "b",
    tres: "c", tercera: "c", tercero: "c", 3: "c", cuatro: "d", cuarta: "d", cuarto: "d", 4: "d", ultima: "d", ultimo: "d" };
  const RELLENO = new Set("eh em pues creo que es la el yo digo diria pongo vale venga mmm hmm opcion respuesta letra seria sera a ver bueno entonces y".split(" "));
  const ANTES = new Set("la opcion respuesta letra es digo pongo diria marco elijo seria".split(" "));
  const ORD_FUERTE = new Set(["primera", "segunda", "tercera", "cuarta", "ultima"]);
  const VACIAS = new Set("el la los las de del y o en a un una que se por con es al lo".split(" "));

  function letrasFuertes(pal) {
    const out = [];
    pal.forEach((w, i) => {
      const letra = LETRA[w] || ORDINAL[w];
      if (!letra) return;
      const prev = i ? pal[i - 1] : "";
      const sig = pal[i + 1] || "";
      // 'a', 'de' y 'se' son palabras corrientes: solo cuentan tras 'la', 'opción'… o como 'be de Barcelona'
      if (["a", "de", "se"].includes(w) && !ANTES.has(prev) && !(sig === "de" && i + 2 < pal.length)) return;
      // 'dos' o 'tres' sueltos pueden ser cifras de la pregunta
      if (ORDINAL[w] && !ANTES.has(prev) && !ORD_FUERTE.has(w)) return;
      out.push(letra);
    });
    return out;
  }

  // Si dice el contenido de una opción ('nacionalidad histórica') en vez de la letra.
  function porContenido(texto, pregunta) {
    const dicho = normaliza(texto).filter((w) => !VACIAS.has(w) && !RELLENO.has(w));
    if (!dicho.length || dicho.join("").length < 6) return null;
    const cubre = (op) => {
      const pal = new Set(normaliza(op).filter((w) => !VACIAS.has(w)));
      const casa = (w) => pal.has(w) || [...pal].some((c) => c.length > 4 && w.length > 4 && c.slice(0, 5) === w.slice(0, 5));
      return dicho.filter(casa).length / dicho.length;
    };
    const notas = LETRAS.map((k) => [cubre(pregunta.opciones[k]), k]).sort((x, y) => y[0] - x[0]);
    return notas[0][0] >= 0.75 && notas[0][0] - notas[1][0] >= 0.25 ? notas[0][1] : null;
  }

  const CMD = {
    pausa: /^(pausa|espera|espera un poco|un momento|un segundo|dame un segundo|para un momento|para un segundo)$/,
    seguir: /^(sigue|seguimos|continua|continuamos|vamos|venga vamos|reanuda|ya estoy|estoy listo)$/,
    para: /^(para|parar|paramos|basta|terminamos|termina|acabamos|lo dejamos|se acabo|fin|ya esta|vale ya|corta)( ya| aqui| por hoy| el examen| de preguntar)?$|\b(lo dejamos|terminamos por hoy|paramos aqui|deja de preguntar)\b/,
    opciones: /\b(las opciones|dime las opciones|repite las opciones|las respuestas posibles|lee las opciones)\b/,
    repite: /\b(repite|repitemela|repitela|otra vez|no te he oido|no te oi|no lo he oido|vuelve a leer)\b|^(como|que|perdon)$/,
    como_voy: /\b(como voy|cuantas llevo|que nota|mi nota|como lo llevo|como va)\b/,
    falladas: /\b(falladas|las que falle|lo que falle|mis fallos|repaso de fallos|los fallos)\b/,
    mixto: /\b(de todo|todas las leyes|mezcla|mezclado|aleatori\w*|cualquier ley)\b/,
    simulacro: /\b(simulacro|como en el examen|examen de verdad)\b/,
    explica: /\b(por que|explica\w*|no lo entiendo|como sale)\b/,
    siguiente: /^(siguiente|la siguiente|otra|venga otra|adelante|dale|pasa)( pregunta)?$/,
    no_se: /\b(no se|no lo se|ni idea|paso|en blanco|no me acuerdo|no tengo ni idea)\b/,
  };
  const CONTROL = ["pausa", "seguir", "para", "opciones", "repite", "como_voy", "falladas", "mixto", "simulacro"];
  const LEY_VOZ = /\b(preguntame|pregunta|ponme|quiero|vamos con|cambia a|cambiamos a|solo|ahora)\s+(de |del |sobre |el |la |los |las )*(ley )?(.+)$/;

  function leyesPorVoz(frase, leyes) {
    const dicho = " " + normaliza(frase).join(" ") + " ";
    let mejor = 0, ids = [];
    for (const l of leyes) {
      const puntos = (l.claves || []).filter((c) => dicho.includes(" " + normaliza(c).join(" ") + " ")).length;
      if (puntos > mejor) { mejor = puntos; ids = [l.ley]; } else if (puntos && puntos === mejor) ids.push(l.ley);
    }
    return ids.length ? ids : null;
  }

  // Devuelve {tipo, …}: respuesta, no_se, repite, opciones, explica, para, pausa, seguir, como_voy, siguiente,
  // leyes, falladas, mixto, simulacro o nada.
  function interpretar(texto, { pregunta = null, respondida = false, leyes = [] } = {}) {
    let pal = normaliza(texto);
    while (pal.length && ["vale", "venga", "bueno", "pues", "ok", "oye", "eh"].includes(pal[0])) pal = pal.slice(1);
    const frase = pal.join(" ");
    if (!pal.length) return { tipo: "nada" };
    const cmd = (t) => CMD[t].test(frase);
    for (const t of CONTROL) if (cmd(t)) return { tipo: t };
    const m = frase.match(LEY_VOZ);
    if (m && leyes.length) {
      const ids = leyesPorVoz(m[4], leyes);
      if (ids) return { tipo: "leyes", leyes: ids, nombres: leyes.filter((l) => ids.includes(l.ley)).map((l) => l.corto) };
    }
    if (respondida) {
      if (cmd("explica")) return { tipo: "explica" };
      if (cmd("siguiente") || cmd("no_se")) return { tipo: "siguiente" };
      return { tipo: "nada" };
    }
    let letras = letrasFuertes(pal);
    const solo = pal.filter((w) => !RELLENO.has(w));
    if (!letras.length && solo.length === 1 && (LETRA[solo[0]] || ORDINAL[solo[0]])) letras = [LETRA[solo[0]] || ORDINAL[solo[0]]];
    if (!letras.length && pal.length === 1 && ["a", "de", "se"].includes(pal[0])) letras = [LETRA[pal[0]]];
    if (letras.length) return { tipo: "respuesta", letra: letras[letras.length - 1] };   // "la be… no, la ce": vale la última
    if (cmd("no_se") || cmd("siguiente")) return { tipo: "no_se" };   // "siguiente" sin contestar: en blanco
    if (cmd("explica")) return { tipo: "explica" };
    if (pregunta) {
      const l = porContenido(texto, pregunta);
      if (l) return { tipo: "respuesta", letra: l, porContenido: true };
    }
    return { tipo: "nada" };
  }

  // Lo que oye mientras la voz lee (o justo después) y no trae ninguna palabra nueva es la propia voz.
  function esEco(texto, { sonando = "", anterior = "", hablando = false, msDesdeFin = Infinity, inicioTrasFin = false } = {}) {
    if (inicioTrasFin && !hablando) return false;    // empezó a hablar cuando la voz ya había callado
    if (!hablando && msDesdeFin > 2500) return false;
    const pal = normaliza(texto);
    if (!hablando && pal.length < 2) return false;  // con la voz callada, una palabra suelta ("paso", "be") es suya
    const s = new Set(normaliza(sonando + " " + anterior));
    return pal.length > 0 && pal.every((w) => s.has(w));
  }

  // ------------------------------------------------------------------ lo que dice la voz
  const BIEN = ["¡Eso es!", "Correcto.", "Bien.", "Exacto.", "Muy bien.", "Esa es."];
  const RACHA = ["Vas lanzado.", "Qué racha.", "Así se hace."];

  function vozCorreccion(x, res, { racha = 0, explicarAciertos = false, rnd = Math.random } = {}) {
    const L = DICHO[x.correcta];
    const expl = x.voz_explicacion || [];
    if (res === "acierto") {
      const base = BIEN[Math.floor(rnd() * BIEN.length)] + (racha && racha % 5 === 0 ? " " + RACHA[Math.floor(rnd() * RACHA.length)] : "");
      return explicarAciertos ? [base, ...expl] : [base];
    }
    return [res === "blanco" ? `Era la ${L}.` : `No, es la ${L}.`, ...expl];
  }

  const coma = (n) => String(n).replace(".", ",");

  function vozResumen(s) {
    const a = s.aciertos || 0, f = s.fallos || 0, b = s.blancos || 0, n = a + f + b;
    if (!n) return ["Vale, lo dejamos. Cuando quieras seguimos."];
    const nt = nota([...Array(a).fill("acierto"), ...Array(f).fill("fallo"), ...Array(b).fill("blanco")]);
    const out = [`Hoy: ${n} pregunta${n === 1 ? "" : "s"}, ${a} bien, ${f} mal${b ? ` y ${b} en blanco` : ""}.`,
      `Con la penalización del examen te saldría un ${coma(nt)}.`];
    if (f + b) out.push("Las que has fallado te las vuelvo a sacar en el repaso.");
    return out;
  }

  function vozComoVoy(s, r) {
    const a = s.aciertos || 0, n = a + (s.fallos || 0) + (s.blancos || 0);
    const out = [n ? `Hoy llevas ${a} de ${n}.` : "Hoy aún no has contestado ninguna."];
    if (r.nota !== null) out.push(`Tu nota estimada con las últimas ${r.respondidas} es un ${coma(r.nota)}.`);
    out.push(`Has visto ${r.vistas} de ${r.total} preguntas.`);
    return out;
  }

  return { LETRAS, DICHO, PENALIZACION, INTERVALO_DIAS, REPESCA_MIN, CONSEJO_NO_SE, normaliza, nuevoProgreso, registrar,
    nota, resumen, elegir, interpretar, esEco, vozCorreccion, vozResumen, vozComoVoy };
});
