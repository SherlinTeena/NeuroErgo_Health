"""
NeuroErgo Health — Flask backend.
All predictions come from models trained in train.py (scikit-learn). No third-party AI/LLM API is called.
Run:  python app.py   ->  http://127.0.0.1:5000
"""
import json, os
from pathlib import Path
import joblib, numpy as np, pandas as pd
from flask import Flask, jsonify, request, send_from_directory, abort
from schema import MODELS

BASE = Path(__file__).parent
app = Flask(__name__, static_folder="static", template_folder="templates")
METRICS = json.loads((BASE / "models" / "metrics.json").read_text())
BUNDLES = {k: joblib.load(BASE / "models" / f"{k}.joblib") for k in MODELS}
LOW, HIGH = 0.35, 0.65


def band(p):
    return "low" if p < LOW else "moderate" if p < HIGH else "high"


# ------------------------------------------------------------------ validation & prediction
def parse_values(key, raw):
    errors, row = {}, {}
    for f in MODELS[key]["features"]:
        v = raw.get(f["key"])
        if f["type"] == "number":
            try:
                v = float(v)
                if not np.isfinite(v): raise ValueError
            except (TypeError, ValueError):
                errors[f["key"]] = "Enter a number"; continue
            if v < f["min"] or v > f["max"]:
                errors[f["key"]] = f"Must be between {f['min']} and {f['max']} {f['unit']}".strip(); continue
            row[f["key"]] = v
        else:
            allowed = [o["value"] for o in f["options"]]
            if v not in allowed:
                errors[f["key"]] = "Choose one of the listed options"; continue
            row[f["key"]] = v
    return row, errors


def explain(bundle, row, p):
    """Local explanation by occlusion: how much does each input move the risk vs. a typical person?"""
    feats, bg, model = bundle["features"], bundle["background"], bundle["model"]
    n = len(bg); frames = []
    for f in feats:
        d = pd.DataFrame([row] * n)[feats]
        d[f] = bg[f].values
        frames.append(d)
    pr = model.predict_proba(pd.concat(frames, ignore_index=True))[:, 1].reshape(len(feats), n).mean(1)
    out = [dict(feature=f, delta=round(float(p - b), 4)) for f, b in zip(feats, pr)]
    return sorted(out, key=lambda d: -abs(d["delta"]))


def label_of(key, feat):
    return next(f["label"] for f in MODELS[key]["features"] if f["key"] == feat)


def recommendations(key, v, p):
    r = []
    add = lambda pr, t, x: r.append(dict(priority=pr, title=t, text=x))
    if key in ("sleep", "stress"):
        if v["Sleep Duration"] < 7: add("high", "Extend your sleep window", f"You average {v['Sleep Duration']:.1f} h. Most adults do best with 7–9 h; move bedtime 15 minutes earlier every few days and keep a fixed wake time.")
        if v["Quality of Sleep"] <= 5: add("high", "Improve sleep quality", "Cut caffeine after midday, dim screens 60 minutes before bed, and keep the bedroom cool and dark.")
        if v["Physical Activity Level"] < 30: add("medium", "Move more", f"At {v['Physical Activity Level']:.0f} min/day you are under the WHO guide of about 150 min/week of moderate activity (≈ 22 min/day). Start with a daily 20–30 minute walk.")
        if v["Daily Steps"] < 6000: add("medium", "Break up sitting time", f"{v['Daily Steps']:.0f} steps/day is low. Stand and walk for 2–3 minutes every 30–45 minutes of desk work.")
        if v["Systolic"] >= 130 or v["Diastolic"] >= 80: add("high", "Check your blood pressure", f"{v['Systolic']:.0f}/{v['Diastolic']:.0f} mm Hg is above the usual 120/80 target. Re-measure at rest on different days and discuss repeated high readings with a clinician.")
        if v["BMI Category"] != "Normal": add("medium", "Weight and sleep apnoea", f"A BMI category of {v['BMI Category'].lower()} is linked with sleep-disordered breathing and blood pressure. Gradual weight change plus activity helps both.")
        if v["Heart Rate"] > 85: add("low", "Resting heart rate", f"{v['Heart Rate']:.0f} bpm is on the higher side; regular aerobic exercise and stress reduction usually lower it.")
        if key == "sleep" and p >= HIGH: add("high", "Consider a sleep assessment", "Loud snoring, gasping at night, long wake-ups or heavy daytime sleepiness are reasons to see a doctor or sleep clinic. This tool cannot diagnose a sleep disorder.")
        if key == "stress" and p >= HIGH: add("high", "Reduce stress load", "Try 5 minutes of slow breathing (inhale 4 s, exhale 6 s), schedule real breaks, and talk to someone you trust if stress stays high for weeks.")
    else:
        if v["benefits"] != "Yes": add("medium", "Find out what cover you have", "Ask HR about an Employee Assistance Programme (EAP) or health-insurance mental-health benefits — the first call is usually confidential.")
        if v["mental_health_consequence"] == "Yes": add("medium", "Use confidential channels", "You expect negative consequences at work. Prefer anonymous or external services (a GP, a counsellor, or a helpline) over informal disclosure.")
        if v["family_history"] == "Yes": add("medium", "Know your early signs", "A family history raises vulnerability, not certainty. Watch for changes in sleep, appetite, concentration or mood lasting more than two weeks.")
        if v["leave"] in ("Very difficult", "Somewhat difficult"): add("low", "Plan your recovery time", "Leave is hard to take; protect smaller recovery habits instead — full lunch breaks, a hard stop time, and one fully offline day each week.")
        if v["remote_work"] == "Yes": add("low", "Stay connected when remote", "Schedule regular video check-ins and a daily start/finish ritual so work does not blur into rest.")
        if p >= HIGH: add("high", "Talk to a professional", "Your answers resemble people who have sought treatment. A GP, counsellor or psychologist can assess how you are really doing. This is not a diagnosis.")
        add("info", "Help is available", "India: Tele-MANAS 14416 (24×7, free). Emergency: 112. Elsewhere: findahelpline.com lists free, confidential lines by country.")
    order = {"high": 0, "medium": 1, "low": 2, "info": 3}
    return sorted(r, key=lambda d: order[d["priority"]])[:6]


@app.post("/api/predict/<key>")
def predict(key):
    if key not in MODELS: abort(404)
    raw = (request.get_json(silent=True) or {}).get("values", {})
    row, errors = parse_values(key, raw)
    if errors: return jsonify(error="Please correct the highlighted fields.", fields=errors), 422
    b = BUNDLES[key]
    p = float(b["model"].predict_proba(pd.DataFrame([row])[b["features"]])[:, 1][0])
    ex = explain(b, row, p)
    m = METRICS["models"][key]
    return jsonify(key=key, name=MODELS[key]["name"], probability=round(p, 4), band=band(p),
                   label=MODELS[key]["positive"] if p >= 0.5 else MODELS[key]["negative"],
                   drivers=[dict(feature=d["feature"], label=label_of(key, d["feature"]), delta=d["delta"], value=row[d["feature"]]) for d in ex[:8]],
                   recommendations=recommendations(key, row, p),
                   model=dict(name=m["best_model"], test_auc=m["final"]["test"]["roc_auc"], test_accuracy=m["final"]["test"]["accuracy"], n=m["n"]))


# ------------------------------------------------------------------ environment comfort (rule-based, standards-based)
def environment_score(d):
    parts, actions = [], []
    def add(name, value, unit, status, penalty, msg=None):
        parts.append(dict(name=name, value=value, unit=unit, status=status, penalty=penalty))
        if msg: actions.append(dict(factor=name, text=msg, penalty=penalty))
    t = d.get("temp")
    if t is not None:
        dev = 0 if 20 <= t <= 25 else min(abs(t - 20) if t < 20 else abs(t - 25), 12)
        add("Temperature", t, "°C", "good" if dev == 0 else "fair" if dev <= 3 else "poor", dev * 3,
            None if dev == 0 else ("Raise the thermostat or add a layer — 20–25 °C is the comfort range for desk work." if t < 20 else "Cool the room, use a fan or shade — heat above 25 °C reduces concentration."))
    h = d.get("humidity")
    if h is not None:
        dev = 0 if 30 <= h <= 60 else min(abs(h - 30) if h < 30 else abs(h - 60), 30)
        add("Humidity", h, "%", "good" if dev == 0 else "fair" if dev <= 10 else "poor", dev * 0.8,
            None if dev == 0 else ("Air is dry — use a humidifier and drink water; dry air irritates eyes and airways." if h < 30 else "Air is humid — ventilate or dehumidify to limit mould and discomfort."))
    a = d.get("aqi")
    if a is not None:
        pen = 0 if a <= 50 else 8 if a <= 100 else 18 if a <= 150 else 28 if a <= 200 else 40
        add("Outdoor air quality (US AQI)", a, "", "good" if a <= 50 else "fair" if a <= 100 else "poor", pen,
            None if a <= 50 else "Outdoor air is unhealthy for sensitive groups — limit open windows at peak hours, use a HEPA purifier, and avoid outdoor exercise." if a > 100 else "Air quality is moderate — sensitive people should reduce prolonged outdoor exertion.")
    c = d.get("co2")
    if c is not None:
        pen = 0 if c <= 800 else min((c - 800) / 40, 30)
        add("Indoor CO₂", c, "ppm", "good" if c <= 800 else "fair" if c <= 1200 else "poor", pen, None if c <= 800 else "CO₂ is high — open a window or door for 5–10 minutes; stuffy air slows thinking.")
    l = d.get("lux")
    if l is not None:
        dev = 0 if 300 <= l <= 750 else (300 - l) / 15 if l < 300 else (l - 750) / 40
        pen = min(max(dev, 0), 20)
        add("Desk lighting", l, "lux", "good" if pen == 0 else "fair" if pen <= 8 else "poor", pen,
            None if pen == 0 else ("Lighting is dim — add a desk lamp; 300–500 lux is recommended for screen work." if l < 300 else "Lighting is very bright — reduce glare with blinds or an anti-glare screen."))
    uv = d.get("uv")
    if uv is not None and uv >= 6: actions.append(dict(factor="UV index", text=f"UV index {uv:.0f} is high — use sunscreen and shade if you step outside.", penalty=8))
    if not parts: return None
    score = max(0, round(100 - sum(p["penalty"] for p in parts)))
    return dict(score=score, band="good" if score >= 75 else "fair" if score >= 50 else "poor", factors=parts, actions=sorted(actions, key=lambda a: -a["penalty"]))


@app.post("/api/environment/score")
def env_score():
    d = request.get_json(silent=True) or {}
    clean = {}
    for k, lo, hi in [("temp", -30, 55), ("humidity", 0, 100), ("aqi", 0, 500), ("co2", 300, 5000), ("lux", 0, 10000), ("uv", 0, 15)]:
        if d.get(k) not in (None, ""):
            try: v = float(d[k])
            except (TypeError, ValueError): return jsonify(error=f"{k} must be a number"), 422
            if not lo <= v <= hi: return jsonify(error=f"{k} must be between {lo} and {hi}"), 422
            clean[k] = v
    res = environment_score(clean)
    return (jsonify(res) if res else (jsonify(error="Provide at least one reading"), 422))


# ------------------------------------------------------------------ workstation ergonomics (rule-based checklist)
ERGO_ITEMS = [
    ("monitor", "Top of the screen is at or slightly below eye level", "Raise the monitor with a stand or books so your neck stays neutral.", 14),
    ("distance", "Screen is an arm's length away (50–70 cm)", "Move the screen back; closer viewing increases eye strain.", 10),
    ("feet", "Feet rest flat on the floor or a footrest", "Lower the chair or add a footrest to take pressure off your thighs.", 12),
    ("knees", "Knees are at about 90° and hips slightly above knees", "Adjust seat height so the knees and hips are at comfortable angles.", 10),
    ("back", "Lower back is supported by the chair", "Add a lumbar cushion or adjust the backrest to hold the natural curve.", 14),
    ("elbows", "Elbows are at about 90°, wrists straight while typing", "Adjust desk or armrest height so shoulders stay relaxed.", 14),
    ("glare", "No glare or bright reflections on the screen", "Tilt the screen or close blinds; use a matte filter if needed.", 8),
    ("breaks", "I stand or stretch at least once every hour", "Set a recurring reminder — see the Break Timer in Wellness Coach.", 18),
]


@app.get("/api/ergonomics/items")
def ergo_items():
    return jsonify([dict(key=k, text=t) for k, t, _, _ in ERGO_ITEMS])


@app.post("/api/ergonomics/score")
def ergo_score():
    checked = set((request.get_json(silent=True) or {}).get("checked", []))
    total = sum(w for *_, w in ERGO_ITEMS)
    score = round(100 * sum(w for k, _, _, w in ERGO_ITEMS if k in checked) / total)
    fixes = [dict(item=t, fix=f, weight=w) for k, t, f, w in ERGO_ITEMS if k not in checked]
    return jsonify(score=score, band="good" if score >= 75 else "fair" if score >= 50 else "poor", fixes=sorted(fixes, key=lambda d: -d["weight"]))


# ------------------------------------------------------------------ fusion: Workplace Wellness Index
PILLAR_W = dict(physical=0.30, cognitive=0.30, environment=0.20, ergonomics=0.20)


@app.post("/api/wellness")
def wellness():
    d = request.get_json(silent=True) or {}
    pr = lambda k: d.get(k) if isinstance(d.get(k), (int, float)) and 0 <= d[k] <= 1 else None
    sc = lambda k: d.get(k) if isinstance(d.get(k), (int, float)) and 0 <= d[k] <= 100 else None
    cog = [x for x in (pr("mental"), pr("stress")) if x is not None]
    pillars = {
        "physical": None if pr("sleep") is None else round(100 * (1 - pr("sleep"))),
        "cognitive": None if not cog else round(100 * (1 - sum(cog) / len(cog))),
        "environment": sc("environment"), "ergonomics": sc("ergonomics"),
    }
    avail = {k: v for k, v in pillars.items() if v is not None}
    if not avail: return jsonify(error="Complete at least one check first."), 422
    wsum = sum(PILLAR_W[k] for k in avail)
    idx = round(sum(PILLAR_W[k] * v for k, v in avail.items()) / wsum)
    weakest = sorted(avail.items(), key=lambda kv: (100 - kv[1]) * PILLAR_W[kv[0]], reverse=True)
    acts = {"physical": "Prioritise sleep and daily movement — see your Lifestyle Risk plan.", "cognitive": "Protect mental energy: schedule micro-breaks and use confidential support if stress persists.",
            "environment": "Fix your environment first: ventilation, temperature and lighting are quick wins.", "ergonomics": "Adjust your workstation: monitor height, chair and elbow position."}
    return jsonify(index=idx, band="good" if idx >= 75 else "fair" if idx >= 55 else "poor", pillars=pillars,
                   coverage=round(100 * wsum / sum(PILLAR_W.values())), priorities=[dict(pillar=k, score=v, action=acts[k]) for k, v in weakest if v < 80][:3])


# ------------------------------------------------------------------ meta / static
@app.get("/api/schema")
def schema():
    out = {}
    for k, m in MODELS.items():
        b = BUNDLES[k]
        out[k] = {**{a: m[a] for a in ("key", "name", "pillar", "tagline", "dataset", "source_url", "target", "positive", "negative")},
                  "features": m["features"], "examples": b["examples"]}
    return jsonify(out)


@app.get("/api/metrics")
def metrics():
    return jsonify(METRICS)


@app.get("/api/health")
def health():
    return jsonify(status="ok", models=list(BUNDLES))


@app.get("/reports/<path:name>")
def reports(name):
    return send_from_directory(BASE / "reports", name)


@app.get("/models/metrics.json")
def metrics_file():
    return send_from_directory(BASE / "models", "metrics.json", as_attachment=True)


@app.get("/")
def index():
    return send_from_directory(BASE / "templates", "index.html")


@app.after_request
def headers(r):
    r.headers["X-Content-Type-Options"] = "nosniff"
    r.headers["Referrer-Policy"] = "no-referrer"
    if request.path.startswith("/api/"): r.headers["Cache-Control"] = "no-store"
    return r


if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", 5000)), debug=False)
