"""Lanza y vigila un conjunto de ejecuciones del agente de QA contra los demos y las puntea.

Uso:
  python mediciones/medir.py mediciones/<conjunto>.json             lanza o retoma y espera el final
  python mediciones/medir.py mediciones/<conjunto>.json --simular   orden y duración estimada, sin lanzar
  python mediciones/medir.py mediciones/<conjunto>.json --estado    una línea por ejecución

Variables de entorno:
  FITQA_BASE_URL   API de la plataforma, por ejemplo https://<plataforma>/api
  FITQA_TOKEN      token de API (o FITQA_TOKEN_FILE con la ruta al archivo que lo contiene)

Reglas que aplica:
- Nunca más de `max_simultaneas` ejecuciones a la vez.
- Nunca dos ejecuciones del mismo `grupo` a la vez: comparten la base en memoria de un demo.
- Enciende los servicios de Cloud Run de una ejecución antes de lanzarla (min-instances 1) y los
  apaga (min-instances 0) cuando ninguna ejecución pendiente o en curso los necesita.
- Aprueba la revisión del plan una sola vez por ejecución, y solo esa pausa.
- No cancela nada. Reintenta hasta `reintentos` veces solo si la ejecución falla por
  infraestructura (motivos en `motivos_de_infra`), nunca por el resultado de las pruebas.
- Guarda el estado después de cada cambio: si el proceso se corta, el mismo comando retoma sin
  duplicar ejecuciones. Una ejecución lanzada se reconoce además por su nombre (`sut_label`).
- Al terminar puntea cada demo con punteo/puntear.py y escribe resumen.md.

Códigos de salida: 0 terminó, 2 error de configuración o de verificación previa, 3 quedaron
ejecuciones en pausa esperando a una persona.
"""
import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
TERMINALES = {"finished", "failed", "cancelled", "interrupted"}


# --- utilidades ---------------------------------------------------------------------------

def ahora():
    return dt.datetime.now(dt.timezone.utc)


def iso(t=None):
    return (t or ahora()).strftime("%Y-%m-%dT%H:%M:%SZ")


class Registro:
    def __init__(self, ruta):
        self.ruta = ruta

    def __call__(self, *partes):
        linea = f"{iso()} " + " ".join(str(p) for p in partes)
        print(linea, flush=True)
        with open(self.ruta, "a", encoding="utf-8") as f:
            f.write(linea + "\n")


def guardar_json(ruta, datos):
    tmp = ruta + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=1)
    os.replace(tmp, ruta)


def leer_json(ruta):
    with open(ruta, encoding="utf-8") as f:
        return json.load(f)


def ruta_kb(rel):
    return rel if os.path.isabs(rel) else os.path.join(RAIZ, rel)


# --- plataforma ---------------------------------------------------------------------------

class Plataforma:
    def __init__(self):
        self.base = (os.environ.get("FITQA_BASE_URL") or "").rstrip("/")
        token = os.environ.get("FITQA_TOKEN")
        archivo = os.environ.get("FITQA_TOKEN_FILE")
        if not token and archivo:
            with open(os.path.expanduser(archivo), encoding="utf-8") as f:
                token = f.read().strip()
        self.token = token
        if not self.base or not self.token:
            raise SystemExit("faltan FITQA_BASE_URL y FITQA_TOKEN (o FITQA_TOKEN_FILE)")

    def llamar(self, metodo, ruta, cuerpo=None, intentos=3):
        datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
        for i in range(intentos):
            req = urllib.request.Request(self.base + ruta, method=metodo, data=datos, headers={
                "Authorization": "Bearer " + self.token, "Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    return r.status, json.loads(r.read() or b"null")
            except urllib.error.HTTPError as e:
                cuerpo_err = e.read().decode("utf-8", "replace")[:500]
                if e.code < 500 or i == intentos - 1:
                    return e.code, cuerpo_err
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                if i == intentos - 1:
                    return 0, str(e)
            time.sleep(10 * (i + 1))
        return 0, "sin respuesta"

    def run(self, run_id):
        st, d = self.llamar("GET", f"/runs/{run_id}")
        return (d.get("data") or {}) if st == 200 and isinstance(d, dict) else None

    def runs_recientes(self):
        st, d = self.llamar("GET", "/runs?limit=100")
        if st != 200 or not isinstance(d, dict):
            return []
        x = d.get("data")
        if isinstance(x, dict):
            x = x.get("runs") or x.get("items") or []
        return x or []


# --- Cloud Run ----------------------------------------------------------------------------

def gcloud(args, registrar=None):
    cmd = "gcloud " + " ".join(args)
    p = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if p.returncode != 0 and registrar:
        registrar("gcloud falló:", cmd, "|", (p.stderr or p.stdout).strip().splitlines()[-1:])
    return p.returncode == 0


def salud(url):
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return r.status == 200
    except Exception:
        return False


# --- conjunto de ejecuciones -------------------------------------------------------------

class Medicion:
    def __init__(self, ruta_config):
        self.cfg = leer_json(ruta_config)
        self.nombre = self.cfg["slug"]
        self.titulo = self.cfg["titulo"]
        self.salida = ruta_kb(self.cfg.get("salida", f"mediciones/salida/{self.nombre}"))
        os.makedirs(self.salida, exist_ok=True)
        self.ruta_estado = os.path.join(self.salida, "estado.json")
        self.log = Registro(os.path.join(self.salida, "registro.log"))
        self.items = {e["id"]: e for e in self.cfg["ejecuciones"]}
        self.orden = [e["id"] for e in self.cfg["ejecuciones"]]
        self.estado = leer_json(self.ruta_estado) if os.path.exists(self.ruta_estado) else {
            "nombre": self.nombre, "inicio": iso(), "ejecuciones": {}, "cloud_run_encendidos": []}
        for i in self.orden:
            self.estado["ejecuciones"].setdefault(i, {"intentos": [], "estado": "pendiente"})

    # -- estado

    def guardar(self):
        self.estado["actualizado"] = iso()
        guardar_json(self.ruta_estado, self.estado)

    def e(self, item_id):
        return self.estado["ejecuciones"][item_id]

    def actual(self, item_id):
        intentos = self.e(item_id)["intentos"]
        return intentos[-1] if intentos else None

    def en_curso(self):
        return [i for i in self.orden if self.e(i)["estado"] == "en_curso"]

    def pendientes(self):
        return [i for i in self.orden if self.e(i)["estado"] == "pendiente"]

    def etiqueta(self, item_id):
        """Nombre visible de la ejecución en la plataforma."""
        return self.items[item_id]["etiqueta"]

    # -- cuerpo de la petición

    def cuerpo(self, item_id):
        it = self.items[item_id]
        perfil = dict(self.cfg["perfiles"][it["perfil"]])
        cuerpo = {"project": self.cfg["proyecto"], "target": it["target"],
                  "agent_slug": self.cfg["agente"], "sut_label": self.etiqueta(item_id), **perfil}
        if it.get("dataset"):
            cuerpo["dataset"] = leer_json(ruta_kb(it["dataset"]))
        if it.get("documentos"):
            docs = []
            for rel in it["documentos"]:
                with open(ruta_kb(rel), encoding="utf-8") as f:
                    docs.append({"name": os.path.basename(rel), "content": f.read()})
            cuerpo["documents"] = docs
        if it.get("network_allowlist"):
            cuerpo["network_allowlist"] = it["network_allowlist"]
        for k in ("plan_gate", "env", "max_iterations", "min_test_cases", "max_test_cases"):
            if k in it:
                cuerpo[k] = it[k]
        return cuerpo

    # -- Cloud Run

    def servicios(self, item_id):
        return self.items[item_id].get("cloud_run", [])

    def encender(self, servicios):
        if not servicios:
            return True
        cr = self.cfg["cloud_run"]
        for s in servicios:
            if s in self.estado["cloud_run_encendidos"]:
                continue
            self.log("Cloud Run: enciendo", s)
            if not gcloud(["run", "services", "update", s, "--min-instances", "1", "--region",
                           cr["region"], "--project", cr["proyecto"], "--quiet"], self.log):
                return False
            self.estado["cloud_run_encendidos"].append(s)
            self.guardar()
            url = cr["salud"].format(servicio=s)
            for _ in range(30):
                if salud(url):
                    break
                time.sleep(10)
            else:
                self.log("Cloud Run:", s, "no responde", url)
                return False
        return True

    def apagar_lo_que_sobra(self):
        cr = self.cfg.get("cloud_run")
        if not cr:
            return
        # Solo lo que usan las ejecuciones en curso: lo que necesita una pendiente se enciende
        # justo antes de lanzarla, y una ejecución que releva a otra del mismo servicio se lanza
        # en la misma vuelta, antes de apagar.
        necesarios = {s for i in self.en_curso() for s in self.servicios(i)}
        for s in list(self.estado["cloud_run_encendidos"]):
            if s in necesarios:
                continue
            self.log("Cloud Run: apago", s)
            if gcloud(["run", "services", "update", s, "--min-instances", "0", "--region",
                       cr["region"], "--project", cr["proyecto"], "--quiet"], self.log):
                self.estado["cloud_run_encendidos"].remove(s)
                self.guardar()
            else:
                self.estado.setdefault("apagar_a_mano", [])
                if s not in self.estado["apagar_a_mano"]:
                    self.estado["apagar_a_mano"].append(s)
                self.guardar()

    # -- verificación previa

    def verificar(self, plataforma):
        problemas = []
        st, d = plataforma.llamar("GET", "/version")
        self.estado["plataforma"] = d if st == 200 else None
        if st != 200:
            problemas.append(f"la plataforma no responde: GET /version -> {st} {d}")
        ag = None
        # /agents/admin trae image_ref y pide permiso de administración; /agents basta para saber
        # que el agente existe.
        for ruta in ("/agents/admin", "/agents"):
            st, d = plataforma.llamar("GET", ruta)
            agentes = d.get("data") if st == 200 and isinstance(d, dict) else None
            if isinstance(agentes, dict):
                agentes = agentes.get("agents") or agentes.get("items") or []
            ag = next((a for a in agentes or [] if a.get("slug") == self.cfg["agente"]), None)
            if ag:
                break
        if not ag:
            problemas.append(f"el agente {self.cfg['agente']} no está en el catálogo")
        else:
            self.estado["agente"] = {"slug": ag.get("slug"), "image_ref": ag.get("image_ref")}
        st, d = plataforma.llamar("GET", "/llm-settings")
        if st == 200 and isinstance(d, dict):
            llm = d.get("data") or {}
            self.estado["modelos"] = llm.get("models") or llm.get("modelos")
        for it in self.cfg["ejecuciones"]:
            for rel in [it.get("dataset")] + list(it.get("documentos", [])):
                if rel and not os.path.exists(ruta_kb(rel)):
                    problemas.append(f"{it['id']}: no existe {rel}")
        if any(self.servicios(i) for i in self.orden):
            if not gcloud(["auth", "print-access-token", "--quiet"]):
                problemas.append("gcloud sin sesión: correr `gcloud auth login`")
        self.guardar()
        return problemas

    # -- ciclo

    def puede_lanzar(self, item_id):
        if len(self.en_curso()) >= self.cfg.get("max_simultaneas", 2):
            return False
        grupo = self.items[item_id].get("grupo")
        return not (grupo and any(self.items[i].get("grupo") == grupo for i in self.en_curso()))

    def adoptar_si_ya_existe(self, plataforma, item_id):
        """Si el proceso se cortó entre lanzar y guardar, la ejecución existe y lleva su nombre."""
        etiqueta = self.etiqueta(item_id)
        conocidos = {x["run_id"] for i in self.orden for x in self.e(i)["intentos"]}
        for r in plataforma.runs_recientes():
            if r.get("sut_label") == etiqueta and r.get("run_id") not in conocidos \
                    and (r.get("created_at") or "") >= self.estado["inicio"][:19]:
                return r["run_id"]
        return None

    def plataforma_llena(self, plataforma):
        """El límite de ejecuciones simultáneas de la plataforma es global: lo ocupan también
        ejecuciones ajenas a este conjunto."""
        activos = [r for r in plataforma.runs_recientes()
                   if r.get("status") in ("queued", "provisioning", "running", "paused")]
        tope = self.cfg.get("tope_plataforma", self.cfg.get("max_simultaneas", 2))
        return len(activos) >= tope

    def lanzar(self, plataforma, item_id):
        """Devuelve "ok", "lleno" (la plataforma no admite más por ahora) o "error"."""
        run_id = self.adoptar_si_ya_existe(plataforma, item_id)
        if run_id:
            self.log(item_id, "retomada la ejecución ya lanzada", run_id)
        else:
            if self.plataforma_llena(plataforma):
                return "lleno"
            if not self.encender(self.servicios(item_id)):
                self.log(item_id, "no se lanza: Cloud Run no quedó listo")
                return "error"
            st, d = plataforma.llamar("POST", "/runs", self.cuerpo(item_id))
            run_id = (d.get("data") or {}).get("run_id") if st == 200 and isinstance(d, dict) else None
            if st == 409 and "simultane" in str(d):
                return "lleno"
            if not run_id:
                self.log(item_id, "falló el lanzamiento:", st, str(d)[:300])
                return "error"
            self.log(item_id, "lanzada", run_id)
        self.e(item_id)["intentos"].append({"run_id": run_id, "lanzada": iso(), "plan_aprobado": False})
        self.e(item_id)["estado"] = "en_curso"
        self.guardar()
        return "ok"

    def revisar(self, plataforma, item_id):
        it_estado = self.e(item_id)
        intento = self.actual(item_id)
        r = plataforma.run(intento["run_id"])
        if r is None:
            return
        intento["status"] = r.get("status")
        q = r.get("question") or {}
        if r.get("status") == "paused":
            if q.get("reason") == "plan_review" and not intento["plan_aprobado"]:
                st, d = plataforma.llamar("POST", f"/runs/{intento['run_id']}/answer", {"answer": "aprobar"})
                self.log(item_id, "revisión del plan aprobada:", st, (q.get("details") or "").split("\n")[0][:160])
                if st == 200:
                    intento["plan_aprobado"] = True
            elif q.get("reason") != "plan_review":
                intento.setdefault("pausa_humana_desde", iso())
        else:
            intento.pop("pausa_humana_desde", None)
        if r.get("status") in TERMINALES:
            out = r.get("outcome") or {}
            intento.update({
                "terminada": iso(), "outcome": out.get("status"), "reason_code": out.get("reason_code"),
                "stopped_because": r.get("stopped_because"), "total": r.get("total_tests"),
                "passed": r.get("passed"), "failed": r.get("failed"),
                "not_executed": r.get("not_executed"), "real_bugs": r.get("real_bugs"),
                "created_at": r.get("created_at"), "ended_at": r.get("ended_at"),
                "image_reference": r.get("image_reference"),
                "no_ejecutados": (r.get("no_ejecutados") or {}).get("frase"),
            })
            infra = set(self.cfg.get("motivos_de_infra", []))
            por_infra = r.get("status") in ("failed", "interrupted") and bool(
                {r.get("status"), r.get("stopped_because"), out.get("reason_code")} & infra)
            if por_infra and len(it_estado["intentos"]) <= self.cfg.get("reintentos", 2):
                self.log(item_id, "falló por infraestructura, se reintenta:", r.get("stopped_because"),
                         out.get("reason_code"))
                it_estado["estado"] = "pendiente"
            else:
                it_estado["estado"] = "terminada"
                self.log(item_id, "terminada", intento["run_id"], r.get("status"), out.get("status"),
                         f"casos={r.get('total_tests')} ok={r.get('passed')} fallidas={r.get('failed')}",
                         f"no_ejecutadas={r.get('not_executed')} defectos={r.get('real_bugs')}")
        self.guardar()

    def esperando_persona(self):
        return [i for i in self.en_curso() if (self.actual(i) or {}).get("pausa_humana_desde")]

    def correr(self):
        plataforma = Plataforma()
        problemas = self.verificar(plataforma)
        if problemas:
            for p in problemas:
                self.log("VERIFICACIÓN:", p)
            return 2
        self.log("inicio", self.nombre, "| plataforma", (self.estado.get("plataforma") or {}).get("version"),
                 "| agente", (self.estado.get("agente") or {}).get("image_ref"))
        espera = self.cfg.get("intervalo_segundos", 120)
        while self.pendientes() or self.en_curso():
            for i in self.en_curso():
                self.revisar(plataforma, i)
            for i in self.pendientes():
                if self.puede_lanzar(i) and self.lanzar(plataforma, i) == "lleno":
                    if not self.estado.get("avisado_lleno"):
                        self.log("la plataforma está en su tope de ejecuciones simultáneas; se espera")
                        self.estado["avisado_lleno"] = True
                    break
            else:
                self.estado.pop("avisado_lleno", None)
            self.apagar_lo_que_sobra()
            bloqueadas = self.esperando_persona()
            if bloqueadas and len(bloqueadas) == len(self.en_curso()) and not self.pendientes():
                self.log("quedan en pausa esperando a una persona:", bloqueadas)
                self.cerrar()
                return 3
            if self.pendientes() or self.en_curso():
                time.sleep(espera)
        self.apagar_lo_que_sobra()
        self.cerrar()
        return 0

    # -- cierre

    def puntear(self):
        textos = []
        for demo, verdad in self.cfg.get("verdad", {}).items():
            ids = [self.actual(i)["run_id"] for i in self.orden
                   if self.items[i].get("demo") == demo and self.actual(i)
                   and self.actual(i).get("status") == "finished"]
            if not ids:
                continue
            salida_json = os.path.join(self.salida, f"punteo-{demo}.json")
            plataforma = Plataforma()
            env = dict(os.environ, FITQA_BASE_URL=plataforma.base, FITQA_TOKEN=plataforma.token,
                       PYTHONIOENCODING="utf-8")
            p = subprocess.run([sys.executable, os.path.join(RAIZ, "punteo", "puntear.py"), "--verdad",
                                ruta_kb(verdad), *ids, "--cache", os.path.join(self.salida, "cache"),
                                "--json", salida_json], capture_output=True, text=True, encoding="utf-8",
                               env=env)
            textos.append(p.stdout + (p.stderr or ""))
        return "\n".join(textos)

    def cerrar(self):
        punteo = self.puntear()
        filas = []
        for i in self.orden:
            it, x = self.items[i], self.actual(i) or {}
            dur = ""
            if x.get("created_at") and x.get("ended_at"):
                a = dt.datetime.fromisoformat(x["created_at"].replace("Z", "+00:00"))
                b = dt.datetime.fromisoformat(x["ended_at"].replace("Z", "+00:00"))
                dur = f"{int((b - a).total_seconds() // 60)} min"
            def n(clave):
                return "" if x.get(clave) is None else x[clave]
            filas.append(f"| {it['etiqueta']} | `{x.get('run_id', '')}` | {x.get('status', self.e(i)['estado'])} "
                         f"| {n('outcome')} | {n('total')} | {n('passed')} | {n('failed')} "
                         f"| {n('not_executed')} | {n('real_bugs')} | {dur} | {len(self.e(i)['intentos'])} |")
        dudosos = [l.strip() for l in punteo.splitlines() if "SIN DECIDIR" in l or l.strip().startswith("aviso")]
        partes = [
            f"# {self.titulo}", "",
            f"Plataforma: {(self.estado.get('plataforma') or {}).get('version')} "
            f"({(self.estado.get('plataforma') or {}).get('commit', '')[:8]}). "
            f"Agente: `{(self.estado.get('agente') or {}).get('image_ref')}`. "
            f"Modelos: {json.dumps(self.estado.get('modelos'), ensure_ascii=False)}.", "",
            "| Ejecución | Run | Estado | Desenlace | Casos | Correctas | Fallidas | No ejecutadas | Defectos | Duración | Intentos |",
            "|---|---|---|---|---:|---:|---:|---:|---:|---|---:|", *filas, "",
        ]
        if self.estado.get("apagar_a_mano"):
            partes += ["Servicios de Cloud Run que no se pudieron apagar: " + ", ".join(self.estado["apagar_a_mano"]), ""]
        partes += ["## Punteo", "", "```", punteo.strip(), "```", ""]
        if dudosos:
            partes += ["## Emparejamientos a decidir", "", *[f"- {d}" for d in dudosos], ""]
        with open(os.path.join(self.salida, "resumen.md"), "w", encoding="utf-8") as f:
            f.write("\n".join(partes))
        self.estado["fin"] = iso()
        self.guardar()
        self.log("fin; resumen en", os.path.join(self.salida, "resumen.md"))

    # -- consulta y simulación

    def imprimir_estado(self):
        for i in self.orden:
            x, s = self.actual(i) or {}, self.e(i)
            print(f"{i:<14} {s['estado']:<10} {x.get('run_id', ''):<22} {x.get('status', '') or '':<9} "
                  f"{x.get('outcome') or '':<10} casos={x.get('total') or '-'} defectos={x.get('real_bugs') or '-'} "
                  f"intentos={len(s['intentos'])}")
        if self.estado.get("cloud_run_encendidos"):
            print("Cloud Run encendido:", ", ".join(self.estado["cloud_run_encendidos"]))

    def simular(self):
        reloj, curso, hechos, pend = 0, [], [], list(self.orden)
        maxs = self.cfg.get("max_simultaneas", 2)
        while pend or curso:
            for i in list(pend):
                g = self.items[i].get("grupo")
                if len(curso) < maxs and not (g and any(self.items[c].get("grupo") == g for c, _ in curso)):
                    fin = reloj + self.items[i].get("minutos_estimados", 60)
                    print(f"+{reloj // 60:>2}h{reloj % 60:02d}  lanza {self.items[i]['etiqueta']:<48} "
                          f"termina ~+{fin // 60}h{fin % 60:02d}  Cloud Run: {', '.join(self.servicios(i)) or '-'}")
                    curso.append((i, fin))
                    pend.remove(i)
            curso.sort(key=lambda x: x[1])
            i, fin = curso.pop(0)
            reloj = fin
            hechos.append(i)
        print(f"total estimado: {reloj // 60}h{reloj % 60:02d}")


def main():
    ap = argparse.ArgumentParser(description="Lanza, vigila y puntea un conjunto de ejecuciones contra los demos")
    ap.add_argument("config")
    ap.add_argument("--simular", action="store_true")
    ap.add_argument("--estado", action="store_true")
    a = ap.parse_args()
    medicion = Medicion(a.config)
    if a.estado:
        medicion.imprimir_estado()
        return 0
    if a.simular:
        medicion.simular()
        return 0
    return medicion.correr()


if __name__ == "__main__":
    sys.exit(main())
