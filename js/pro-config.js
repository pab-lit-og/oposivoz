// OposiVoz Pro · configuración del cobro con Polar (merchant of record). La escribe herramientas/polar_sandbox.py.
// «activo: false» = la web de siempre, sin nada de pago. No se enciende hasta el alta de autónomo (feb–mar 2027) y,
// entonces, con «entorno: real» y los datos de la organización real de Polar (ver docs/cobro-polar.md).
self.OPOSIVOZ_PRO = /* config */ {
  "activo": false,
  "entorno": "sandbox",
  "organizacion": "",
  "pago": {"mensual": "", "examen": ""},
  "portal": ""
} /* fin */;
