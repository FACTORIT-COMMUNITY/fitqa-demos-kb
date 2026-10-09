"""Puntea ejecuciones del agente de QA contra el verdad.json de un demo.

Uso:
  python punteo/puntear.py --verdad <demo>/verdad.json <ejecucion> [<ejecucion> ...]
                           [--emparejamientos punteo/emparejamientos.json] [--json salida.json]

Cada <ejecucion> es la ruta a un JSON descargado con GET /api/runs/{id}, o un id de ejecucion.
Con un id, el script baja la ejecucion si estan definidas FITQA_BASE_URL (por ejemplo
https://<plataforma>/api) y FITQA_TOKEN; con --cache <dir> guarda la descarga y la reutiliza.

Reglas:
- Un defecto reportado es una evaluacion con verdict real-bug.
- Cada reportado se empareja con una entrada del catalogo. El emparejamiento manual
  (emparejamientos.json) manda; sin entrada manual se propone uno automatico por evidencia
  (archivo, funcion, endpoint, palabras del sintoma) y se avisa.
- Clases de un reportado:
    sembrado          emparejado con un sembrado no-trampa: acierto
    trampa            emparejado con una trampa: falso positivo
    real_no_sembrado  defecto real fuera del catalogo que contradice una regla escrita del SUT: adicional
    real_sin_regla    defecto real fuera del catalogo, verificado, sin regla escrita: adicional
    fuera_sin_regla   expectativa del agente sin contrato del SUT: falso positivo
    falso_positivo    contradice comportamiento documentado o es error del agente: falso positivo
    sin_decidir       sin emparejamiento manual ni automatico: se informa aparte y no suma como acierto
- Metricas por ejecucion:
    recall     = sembrados no-trampa encontrados / total de sembrados no-trampa
    precision  = (aciertos + adicionales) / reportados
    severidad  = de los sembrados encontrados, cuantos coinciden con severidad_esperada. Si varios
                 reportes apuntan al mismo sembrado se usa el marcado "principal" o, si no hay, el de
                 mayor severidad (S1 > S4).
"""
import argparse
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
ADICIONALES = {"real_no_sembrado", "real_sin_regla"}
FALSOS_POSITIVOS = {"trampa", "fuera_sin_regla", "falso_positivo"}


def norm(s):
    return unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()


def desenvolver(d):
    return d.get("data", d) if isinstance(d, dict) and "evaluations" not in d else d


def bajar(run_id, cache):
    if cache:
        ruta = os.path.join(cache, run_id + ".json")
        if os.path.exists(ruta):
            with open(ruta, encoding="utf-8") as f:
                return desenvolver(json.load(f))
    base, token = os.environ.get("FITQA_BASE_URL"), os.environ.get("FITQA_TOKEN")
    if not base or not token:
        raise SystemExit(f"{run_id}: no es un archivo y faltan FITQA_BASE_URL / FITQA_TOKEN para bajarlo")
    req = urllib.request.Request(base.rstrip("/") + f"/runs/{run_id}",
                                 headers={"Authorization": "Bearer " + token})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = desenvolver(json.loads(r.read()))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"GET /runs/{run_id} -> {e.code}: {e.read().decode()[:200]}")
    if cache:
        os.makedirs(cache, exist_ok=True)
        with open(os.path.join(cache, run_id + ".json"), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
    return data


def cargar_ejecucion(arg, cache):
    if os.path.isfile(arg):
        with open(arg, encoding="utf-8") as f:
            return desenvolver(json.load(f))
    return bajar(arg, cache)


def cargar_catalogo(ruta):
    with open(ruta, encoding="utf-8") as f:
        v = json.load(f)
    items = [dict(s, trampa=bool(s.get("trampa"))) for s in v.get("sembrados", [])]
    items += [dict(s, trampa=False) for s in v.get("defectos", [])]
    items += [dict(s, trampa=True) for s in v.get("trampas", [])]
    return v, items


STOP = set("""que con los las del una uno para por sin pero como cuando esta este esto ese esa
sobre entre desde hasta donde aunque tambien solo mismo misma otro otra todos todas deberia
devuelve queda quedan puede pueden nunca siempre segun tiene tienen hace hacen""".split())
RE_ARCHIVO = re.compile(r"([\w./-]+\.(?:js|mjs|py|go|sql|html|ts|tsx))")
RE_FUNC = re.compile(r"([A-Za-z_]\w+)\(\)")
RE_EP = re.compile(r"\b(GET|POST|PUT|DELETE|PATCH)\s+(/[\w/{}:.\-]+)")


def norm_ruta(p):
    return re.sub(r"\{[^}]+\}|:\w+|\b\d+\b", "{}", p.split("?")[0]).rstrip("/")


def firma(item):
    texto = " ".join([item.get("ubicacion", ""), item.get("sintoma", ""), " ".join(item.get("repro", []))])
    archivos = {os.path.basename(a) for a in RE_ARCHIVO.findall(item.get("ubicacion", ""))}
    funcs = set(RE_FUNC.findall(item.get("ubicacion", "")))
    eps = {norm_ruta(p) for _, p in RE_EP.findall(texto)} - {"/admin/reset"}
    palabras = {w for w in re.findall(r"[a-z_]{5,}", norm(item.get("sintoma", ""))) if w not in STOP}
    return archivos, funcs, eps, palabras


def texto_eval(e, t):
    partes = [t.get("name"), e.get("rationale"), t.get("result"), t.get("error"),
              " ".join(e.get("suspected_files") or [])]
    return " ".join(str(p or "") for p in partes)


def puntaje(item, txt):
    archivos, funcs, eps, palabras = firma(item)
    n = norm(txt)
    rutas_txt = {norm_ruta(p) for _, p in RE_EP.findall(txt)} | {norm_ruta(m) for m in re.findall(r"(/[a-z][\w/{}:.\-]+)", txt)}
    s = 0.0
    if any(a.lower() in n for a in archivos):
        s += 1.5
    if any(f.lower() in n for f in funcs):
        s += 3
    s += 2 * min(2, len(eps & rutas_txt))
    if palabras:
        s += 4 * len([w for w in palabras if w in n]) / len(palabras)
    return round(s, 2)


def emparejar_auto(items, txt):
    ranking = sorted(((puntaje(i, txt), i["id"]) for i in items), reverse=True)
    (s1, id1), (s2, _) = ranking[0], ranking[1] if len(ranking) > 1 else (0, None)
    if s1 >= 5 and s1 - s2 >= 1.5:
        return id1, s1, "auto"
    return None, s1, f"dudoso (mejor {id1}={s1}, segundo={s2})"


def sev_num(s):
    m = re.match(r"S(\d)", str(s or ""))
    return int(m.group(1)) if m else 9


def puntear_run(data, items, manual):
    run_id = str(data.get("run_id"))
    tr = {str(t.get("case_id")): t for t in data.get("test_results") or []}
    por_id = {i["id"]: i for i in items}
    reales = [i for i in items if not i["trampa"]]
    man = manual.get("runs", {}).get(run_id, {})
    filas = []
    for e in data.get("evaluations") or []:
        if e.get("verdict") != "real-bug":
            continue
        tid = str(e.get("test_id"))
        t = tr.get(tid, {})
        auto_id, sc, modo = emparejar_auto(items, texto_eval(e, t))
        m = man.get(tid)
        if m is not None:
            final, clase, nota, fuente = m.get("defecto"), m.get("clase"), m.get("nota", ""), "manual"
            if final and clase is None:
                clase = "trampa" if por_id[final]["trampa"] else "sembrado"
        else:
            final, fuente, nota = auto_id, modo, ""
            clase = ("trampa" if por_id[auto_id]["trampa"] else "sembrado") if auto_id else "sin_decidir"
        filas.append(dict(test_id=tid, nombre=t.get("name"), severidad=e.get("severity"),
                          auto=auto_id, auto_puntaje=sc, auto_modo=modo, final=final, clase=clase,
                          fuente=fuente, nota=nota, grupo=(m or {}).get("grupo"),
                          principal=bool((m or {}).get("principal")),
                          discrepa=(m is not None and auto_id is not None and m.get("defecto") != auto_id)))
    encontrados = {}
    for f in filas:
        if f["clase"] == "sembrado":
            encontrados.setdefault(f["final"], []).append(f)
    acuerdo = []
    for did, fs in encontrados.items():
        elegida = next((f for f in fs if f["principal"]), None) or min(fs, key=lambda f: sev_num(f["severidad"]))
        esperada = por_id[did].get("severidad_esperada")
        acuerdo.append(dict(defecto=did, esperada=esperada, reportada=elegida["severidad"],
                            todas=[f["severidad"] for f in fs], coincide=elegida["severidad"] == esperada))
    aciertos = [f for f in filas if f["clase"] == "sembrado"]
    adicionales = [f for f in filas if f["clase"] in ADICIONALES]
    return dict(
        run_id=run_id, sut=data.get("sut_label") or data.get("target_name"),
        tests=len(tr), reportados=len(filas),
        recall=(len(encontrados), len(reales)),
        precision=(len(aciertos) + len(adicionales), len(filas)),
        severidad=(sum(a["coincide"] for a in acuerdo), len(acuerdo)),
        aciertos=len(aciertos),
        acuerdo=sorted(acuerdo, key=lambda a: a["defecto"]),
        no_encontrados=[i["id"] for i in reales if i["id"] not in encontrados],
        adicionales=adicionales,
        grupos_adicionales=sorted({f["grupo"] or f"#{f['test_id']}" for f in adicionales}),
        falsos_positivos=[f for f in filas if f["clase"] in FALSOS_POSITIVOS],
        trampas_reportadas=[f for f in filas if f["clase"] == "trampa"],
        sin_decidir=[f for f in filas if f["clase"] == "sin_decidir"],
        filas=filas,
    )


def pct(a, b):
    return f"{a}/{b} ({100 * a / b:.0f}%)" if b else "n/a"


def imprimir(r):
    print(f"\n### {r['run_id']} - {r['sut']}")
    print(f"tests={r['tests']} reportados(real-bug)={r['reportados']}")
    print("| Metrica | Valor |\n|---|---|")
    print(f"| Recall | {pct(*r['recall'])} |")
    print(f"| Precision (aciertos + adicionales) | {pct(*r['precision'])} |")
    print(f"| Aciertos (reportes) | {r['aciertos']} |")
    print(f"| Adicionales (reportes / defectos distintos) | {len(r['adicionales'])} / {len(r['grupos_adicionales'])} |")
    print(f"| Falsos positivos | {len(r['falsos_positivos'])} |")
    print(f"| Trampas reportadas | {len(r['trampas_reportadas'])} |")
    print(f"| Acuerdo de severidad | {pct(*r['severidad'])} |")
    print("Encontrados:", ", ".join(
        f"{a['defecto']}(esp {a['esperada']}, rep {a['reportada']}"
        f"{'' if len(a['todas']) == 1 else ' de ' + '/'.join(map(str, a['todas']))}){'=' if a['coincide'] else '!'}"
        for a in r["acuerdo"]) or "-")
    print("No encontrados:", ", ".join(r["no_encontrados"]) or "-")
    print("Trampas reportadas:", ", ".join(f"#{f['test_id']}->{f['final']}" for f in r["trampas_reportadas"]) or "ninguna")
    print("Adicionales:")
    for f in r["adicionales"]:
        print(f"  #{f['test_id']} [{f['clase']}/{f['grupo']}] {f['severidad']} {f['nombre']}")
    print("Falsos positivos:")
    for f in r["falsos_positivos"]:
        print(f"  #{f['test_id']} [{f['clase']}] {f['severidad']} {f['nombre']}")
    for f in r["sin_decidir"]:
        print(f"  SIN DECIDIR #{f['test_id']}: {f['nombre']} ({f['auto_modo']})")
    for f in r["filas"]:
        if f["discrepa"] or (f["fuente"] != "manual" and f["clase"] != "sin_decidir"):
            print(f"  aviso #{f['test_id']}: auto={f['auto']} ({f['auto_modo']}, {f['auto_puntaje']}) final={f['final']} fuente={f['fuente']}")


def main():
    ap = argparse.ArgumentParser(description="Puntea ejecuciones del agente contra verdad.json")
    ap.add_argument("ejecuciones", nargs="+", help="JSON de GET /api/runs/{id} o id de ejecucion")
    ap.add_argument("--verdad", required=True)
    ap.add_argument("--emparejamientos", default=os.path.join(AQUI, "emparejamientos.json"))
    ap.add_argument("--cache", help="carpeta donde guardar y reutilizar las ejecuciones bajadas por id")
    ap.add_argument("--json", help="escribe el resultado completo en este archivo")
    a = ap.parse_args()
    verdad, items = cargar_catalogo(a.verdad)
    manual = {}
    if os.path.exists(a.emparejamientos):
        with open(a.emparejamientos, encoding="utf-8") as f:
            manual = json.load(f)
    reales = [i for i in items if not i["trampa"]]
    print(f"Catalogo {verdad.get('demo')}: {len(reales)} sembrados, {len(items) - len(reales)} trampas")
    salida = [puntear_run(cargar_ejecucion(e, a.cache), items, manual) for e in a.ejecuciones]
    for r in salida:
        imprimir(r)
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(salida, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
