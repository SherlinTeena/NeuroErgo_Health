/* NeuroErgo Health — front end. No framework, no third-party AI calls. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
const COLOR = { low: 'var(--good)', good: 'var(--good)', moderate: 'var(--fair)', fair: 'var(--fair)', high: 'var(--poor)', poor: 'var(--poor)' };

/* ---------------------------------------------------------------- state */
const KEY = 'neuroergo.v1';
let S = { profile: { name: '' }, results: {}, env: null, ergo: null, history: [], indexLog: [], breaks: {}, loc: null };
try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* storage unavailable */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } };
let SCHEMA = {}, METRICS = {};

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data = {}; try { data = await res.json(); } catch (e) { /* non-json */ }
  if (!res.ok) { const err = new Error(data.error || `Request failed (${res.status})`); err.fields = data.fields; throw err; }
  return data;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 3200); }
const ago = ts => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(ts).toLocaleDateString(); };

/* ---------------------------------------------------------------- SVG helpers */
function gauge(value, band, label, w = 190) {
  const L = Math.PI * 70, off = L * (1 - Math.max(0, Math.min(100, value)) / 100), c = COLOR[band] || 'var(--primary)';
  return `<svg viewBox="0 0 180 112" width="${w}" role="img" aria-label="${esc(label)} ${Math.round(value)} percent"><path d="M20 98 A70 70 0 0 1 160 98" fill="none" style="stroke:var(--line)" stroke-width="14" stroke-linecap="round"/>
  <path d="M20 98 A70 70 0 0 1 160 98" fill="none" style="stroke:${c}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${L}" stroke-dashoffset="${off}"/>
  <text x="90" y="84" text-anchor="middle" font-size="32" font-weight="750" style="fill:var(--ink)">${Math.round(value)}${label.includes('%') ? '' : ''}</text><text x="90" y="104" text-anchor="middle" font-size="11" style="fill:var(--muted)">${esc(label)}</text></svg>`;
}
function ring(frac, text, sub, color = 'var(--primary)', size = 190) {
  const r = 78, C = 2 * Math.PI * r;
  return `<svg viewBox="0 0 190 190" width="${size}" role="img" aria-label="${esc(text)}"><circle cx="95" cy="95" r="${r}" fill="none" style="stroke:var(--line)" stroke-width="12"/>
  <circle cx="95" cy="95" r="${r}" fill="none" style="stroke:${color}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - Math.max(0, Math.min(1, frac)))}" transform="rotate(-90 95 95)"/>
  <text x="95" y="100" text-anchor="middle" font-size="36" font-weight="750" style="fill:var(--ink)">${esc(text)}</text><text x="95" y="124" text-anchor="middle" font-size="12" style="fill:var(--muted)">${esc(sub)}</text></svg>`;
}
function lineChart(series, { w = 560, h = 190, xlabels = [], unit = '', min, max, ref } = {}) {
  const P = { l: 40, r: 12, t: 12, b: 26 }, all = series.flatMap(s => s.data).filter(v => v != null);
  if (!all.length) return '<p class="muted">No data</p>';
  let lo = min ?? Math.floor(Math.min(...all)), hi = max ?? Math.ceil(Math.max(...all)); if (hi === lo) { hi += 1; lo -= 1; }
  const n = Math.max(...series.map(s => s.data.length)), X = i => P.l + (n === 1 ? (w - P.l - P.r) / 2 : i * (w - P.l - P.r) / (n - 1)), Y = v => P.t + (h - P.t - P.b) * (1 - (v - lo) / (hi - lo));
  let g = ''; for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4, y = Y(v); g += `<line x1="${P.l}" x2="${w - P.r}" y1="${y}" y2="${y}" style="stroke:var(--line)"/><text x="${P.l - 6}" y="${y + 4}" text-anchor="end" font-size="10" style="fill:var(--muted)">${fmt(v, hi - lo < 6 ? 1 : 0)}</text>`; }
  if (ref != null) g += `<line x1="${P.l}" x2="${w - P.r}" y1="${Y(ref)}" y2="${Y(ref)}" stroke-dasharray="4 4" style="stroke:var(--muted)"/>`;
  xlabels.forEach((l, i) => { if (l != null) g += `<text x="${X(i)}" y="${h - 8}" text-anchor="middle" font-size="10" style="fill:var(--muted)">${esc(l)}</text>`; });
  const paths = series.map(s => { const pts = s.data.map((v, i) => v == null ? null : [X(i), Y(v)]).filter(Boolean); if (!pts.length) return '';
    return `<path d="M${pts.map(p => p.join(',')).join(' L')}" fill="none" style="stroke:${s.color || 'var(--primary)'}" stroke-width="2.4" stroke-linejoin="round"/>` + (pts.length < 40 ? pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3" style="fill:${s.color || 'var(--primary)'}"/>`).join('') : ''); }).join('');
  return `<div class="chartwrap"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Line chart ${esc(unit)}">${g}${paths}</svg></div>`;
}
function rocChart(roc, auc) {
  const s = 220, p = 34, X = v => p + v * (s - p - 10), Y = v => 10 + (1 - v) * (s - p - 10);
  const pts = roc.fpr.map((f, i) => `${X(f)},${Y(roc.tpr[i])}`).join(' ');
  return `<svg viewBox="0 0 ${s} ${s}" role="img" aria-label="ROC curve, AUC ${auc}"><rect x="${X(0)}" y="${Y(1)}" width="${X(1) - X(0)}" height="${Y(0) - Y(1)}" fill="none" style="stroke:var(--line)"/>
  <line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" stroke-dasharray="4 4" style="stroke:var(--muted)"/><polyline points="${pts}" fill="none" style="stroke:var(--primary)" stroke-width="2.4"/>
  <text x="${s / 2}" y="${s - 6}" text-anchor="middle" font-size="10" style="fill:var(--muted)">1 − specificity</text><text transform="translate(10 ${s / 2}) rotate(-90)" text-anchor="middle" font-size="10" style="fill:var(--muted)">sensitivity</text>
  <text x="${X(0.97)}" y="${Y(0.08)}" text-anchor="end" font-size="12" font-weight="700" style="fill:var(--ink)">AUC ${auc.toFixed(3)}</text></svg>`;
}
function calibChart(cal) {
  const s = 220, p = 34, X = v => p + v * (s - p - 10), Y = v => 10 + (1 - v) * (s - p - 10);
  return `<svg viewBox="0 0 ${s} ${s}" role="img" aria-label="Calibration plot"><rect x="${X(0)}" y="${Y(1)}" width="${X(1) - X(0)}" height="${Y(0) - Y(1)}" fill="none" style="stroke:var(--line)"/>
  <line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" stroke-dasharray="4 4" style="stroke:var(--muted)"/>
  <polyline points="${cal.map(c => `${X(c.pred)},${Y(c.obs)}`).join(' ')}" fill="none" style="stroke:var(--primary)" stroke-width="2"/>${cal.map(c => `<circle cx="${X(c.pred)}" cy="${Y(c.obs)}" r="${3 + Math.min(c.n, 60) / 15}" style="fill:var(--primary)"><title>n=${c.n}</title></circle>`).join('')}
  <text x="${s / 2}" y="${s - 6}" text-anchor="middle" font-size="10" style="fill:var(--muted)">predicted probability</text><text transform="translate(10 ${s / 2}) rotate(-90)" text-anchor="middle" font-size="10" style="fill:var(--muted)">observed rate</text></svg>`;
}
function confMatrix(c) {
  const mx = Math.max(...c.flat());
  const cell = (v, ok) => `<div style="background:color-mix(in srgb,${ok ? 'var(--good)' : 'var(--poor)'} ${Math.round(18 + 62 * v / mx)}%,var(--surface));padding:16px 8px;border-radius:10px;text-align:center"><b style="font-size:1.5rem">${v}</b></div>`;
  return `<div style="display:grid;grid-template-columns:auto 1fr 1fr;gap:6px;align-items:center;max-width:320px;font-size:.78rem" role="img" aria-label="Confusion matrix">
  <span></span><span class="muted" style="text-align:center">Predicted negative</span><span class="muted" style="text-align:center">Predicted positive</span>
  <span class="muted">Actual negative</span>${cell(c[0][0], 1)}${cell(c[0][1], 0)}<span class="muted">Actual positive</span>${cell(c[1][0], 0)}${cell(c[1][1], 1)}</div>`;
}
function hbars(items, max) {
  max = max || Math.max(...items.map(i => Math.abs(i.v)), 1e-9);
  return `<div class="drivers">${items.map(i => `<div class="drv" style="grid-template-columns:minmax(110px,40%) 1fr 56px"><span>${esc(i.l)}</span><div class="bar"><i style="left:0;width:${Math.max(1, Math.abs(i.v) / max * 100)}%;background:var(--primary)"></i></div><b>${i.t}</b></div>`).join('')}</div>`;
}

/* ---------------------------------------------------------------- router */
const TABS = {
  dashboard: ['Dashboard', 'Your workplace wellness at a glance'], lifestyle: ['Sleep & Stress Risk', 'Physical pillar · trained on the Sleep Health & Lifestyle dataset'],
  mental: ['Mental Well-being', 'Cognitive pillar · trained on the OSMI workplace survey'], environment: ['Live Environment', 'Real-time weather & air quality, workspace comfort'],
  coach: ['Wellness Coach', 'Break timer, exercises, ergonomics check and coach'], tools: ['Health Tools', 'BMI and blood-pressure calculators'],
  lab: ['Model Lab', 'Training protocol, evaluation metrics and explainability'], history: ['My History', 'Your assessments, trend and data controls'], about: ['About & Methodology', 'How the project relates to the NeuroErgoML paper']
};
const onShow = {};
function route() {
  const t = (location.hash || '#dashboard').slice(1); const tab = TABS[t] ? t : 'dashboard';
  $$('.tab').forEach(s => s.classList.toggle('on', s.id === 'tab-' + tab));
  $$('#nav a').forEach(a => { const on = a.dataset.tab === tab; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $('#pageTitle').textContent = TABS[tab][0]; $('#pageSub').textContent = TABS[tab][1]; document.title = `${TABS[tab][0]} — NeuroErgo Health`;
  window.scrollTo(0, 0); if (onShow[tab]) onShow[tab]();
}

/* ---------------------------------------------------------------- forms */
const dec = f => (String(f.step).split('.')[1] || '').length;
function buildForm(form, key) {
  const m = SCHEMA[key], groups = [...new Set(m.features.map(f => f.group))], box = $('.fields', form);
  box.innerHTML = groups.map(g => `<fieldset><legend>${esc(g)}</legend>${m.features.filter(f => f.group === g).map(f => {
    const id = `${key}_${f.key.replace(/\W/g, '_')}`;
    if (f.type === 'select') return `<div class="field" data-key="${esc(f.key)}"><label for="${id}">${esc(f.label)}</label><select id="${id}" name="${esc(f.key)}">${f.options.map(o => `<option value="${esc(o.value)}"${o.value === f.default ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select><div class="help">${esc(f.help)}</div><div class="err" role="alert"></div></div>`;
    return `<div class="field" data-key="${esc(f.key)}"><label for="${id}">${esc(f.label)} <small>${esc(f.unit)}</small></label><div class="numrow"><input type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${f.default}" aria-hidden="true" tabindex="-1"><input type="number" id="${id}" name="${esc(f.key)}" min="${f.min}" max="${f.max}" step="${f.step}" value="${f.default}" inputmode="decimal"></div><div class="help">${esc(f.help)}</div><div class="err" role="alert"></div></div>`;
  }).join('')}</fieldset>`).join('');
  $$('.numrow', box).forEach(r => { const [rg, nb] = $$('input', r); rg.oninput = () => { nb.value = rg.value; }; nb.oninput = () => { rg.value = nb.value; }; });
  form.onreset = () => setTimeout(() => { setValues(form, key, Object.fromEntries(m.features.map(f => [f.key, f.default]))); clearErrors(form); }, 0);
  $$('[data-ex]', form).forEach(b => b.onclick = () => { setValues(form, key, m.examples[b.dataset.ex]); clearErrors(form); toast(`Loaded a real held-out ${b.dataset.ex === 'low' ? 'lower' : 'higher'}-risk case from the dataset`); });
}
function setValues(form, key, vals) {
  SCHEMA[key].features.forEach(f => { const el = $(`[name="${CSS.escape(f.key)}"]`, form); if (!el || vals[f.key] == null) return; el.value = f.type === 'number' ? (+vals[f.key]).toFixed(dec(f)) : vals[f.key]; if (f.type === 'number') el.previousElementSibling.value = el.value; });
}
function getValues(form, key) {
  const v = {}; SCHEMA[key].features.forEach(f => { const el = $(`[name="${CSS.escape(f.key)}"]`, form); v[f.key] = f.type === 'number' ? (el.value === '' ? null : +el.value) : el.value; }); return v;
}
function clearErrors(form) { $$('.field', form).forEach(d => { d.classList.remove('bad'); $('.err', d).textContent = ''; }); }
function showErrors(form, errs) { clearErrors(form); let first; Object.entries(errs).forEach(([k, msg]) => { const d = $(`.field[data-key="${CSS.escape(k)}"]`, form); if (d) { d.classList.add('bad'); $('.err', d).textContent = msg; first = first || d; } }); if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
function clientValidate(form, keys) {
  const errs = {}; keys.forEach(k => SCHEMA[k].features.forEach(f => { if (f.type !== 'number') return; const el = $(`[name="${CSS.escape(f.key)}"]`, form), v = el.value;
    if (v === '' || isNaN(+v)) errs[f.key] = 'Enter a number'; else if (+v < f.min || +v > f.max) errs[f.key] = `Must be between ${f.min} and ${f.max} ${f.unit}`.trim(); })); return errs;
}

/* ---------------------------------------------------------------- results */
const SHORT = { low: 'Lower risk', moderate: 'Moderate risk', high: 'Higher risk' };
function resultCard(r) {
  const mx = Math.max(...r.drivers.map(d => Math.abs(d.delta)), 0.001), top = r.drivers.slice(0, 6);
  const val = d => typeof d.value === 'number' ? fmt(d.value, d.value % 1 ? 1 : 0) : d.value;
  return `<div class="card"><div class="res-head">${gauge(r.probability * 100, r.band, 'risk probability %')}<div><span class="tag">${esc(SCHEMA[r.key].pillar)} pillar</span><h2 style="font-size:1.15rem;margin:2px 0 6px">${esc(r.name)}</h2>
    <span class="pill ${r.band}">${SHORT[r.band]}</span><p style="margin:.6em 0 0">${esc(r.label)}</p></div></div>
    <h3 style="margin-top:14px">What drives this result</h3><p class="muted small" style="margin:0">Change in estimated risk vs. a typical person in the training data (percentage points). Red raises risk, green lowers it.</p>
    <div class="drivers">${top.map(d => { const w = Math.abs(d.delta) / mx * 50; return `<div class="drv"><span>${esc(d.label)}<small>${esc(val(d))}</small></span><div class="bar"><i class="${d.delta > 0 ? 'up' : 'dn'}" style="${d.delta > 0 ? 'left:50%' : `right:50%`};width:${Math.max(w, 1)}%"></i></div><b>${d.delta > 0 ? '+' : ''}${(d.delta * 100).toFixed(1)}</b></div>`; }).join('')}</div>
    <div class="model-line">Model: ${esc(r.model.name)} · hold-out ROC-AUC ${r.model.test_auc.toFixed(3)} · accuracy ${pct(r.model.test_accuracy)} · trained on ${fmt(r.model.n)} records. <a href="#lab">See evaluation</a></div></div>`;
}
const recList = recs => `<ul class="recs">${recs.map(x => `<li class="${x.priority}"><b>${esc(x.title)}</b><span>${esc(x.text)}</span></li>`).join('')}</ul>`;
function logHistory(type, label, r) { S.history.push({ ts: Date.now(), type, label, value: Math.round(r.probability * 100), band: r.band }); S.history = S.history.slice(-200); }

async function submitLifestyle(e) {
  e.preventDefault(); const form = e.target, btn = $('button[type=submit]', form), out = $('#res-sleep');
  const errs = clientValidate(form, ['sleep']); if (Object.keys(errs).length) return showErrors(form, errs); clearErrors(form);
  const values = getValues(form, 'sleep'); btn.disabled = true; btn.textContent = 'Analysing…'; out.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const [a, b] = await Promise.all([api('/api/predict/sleep', { values }), api('/api/predict/stress', { values })]);
    S.results.sleep = { p: a.probability, band: a.band, ts: Date.now(), values }; S.results.stress = { p: b.probability, band: b.band, ts: Date.now() };
    logHistory('sleep', 'Sleep-disorder risk', a); logHistory('stress', 'High-stress indicator', b); save();
    const seen = new Set(), recs = [...a.recommendations, ...b.recommendations].filter(r => !seen.has(r.title) && seen.add(r.title));
    out.innerHTML = `<div class="two-res">${resultCard(a)}${resultCard(b)}</div><div class="card"><div class="card-h"><h2>Your action plan</h2></div>${recList(recs)}<p class="muted small">Wellness guidance only — not medical advice. Talk to a clinician about persistent symptoms.</p></div>`;
    refreshIndex(true); toast('Analysis complete — dashboard updated');
  } catch (err) { if (err.fields) showErrors(form, err.fields); out.innerHTML = `<div class="banner err">${esc(err.message)}</div>`; }
  finally { btn.disabled = false; btn.textContent = 'Analyse my health'; }
}
async function submitMental(e) {
  e.preventDefault(); const form = e.target, btn = $('button[type=submit]', form), out = $('#res-mental');
  const errs = clientValidate(form, ['mental']); if (Object.keys(errs).length) return showErrors(form, errs); clearErrors(form);
  btn.disabled = true; btn.textContent = 'Checking…'; out.innerHTML = '<div class="skeleton"></div>';
  try {
    const r = await api('/api/predict/mental', { values: getValues(form, 'mental') });
    S.results.mental = { p: r.probability, band: r.band, ts: Date.now() }; logHistory('mental', 'Mental well-being support need', r); save();
    out.innerHTML = `${resultCard(r)}<div class="card"><div class="card-h"><h2>Suggested next steps</h2></div>${recList(r.recommendations)}<p class="muted small">This indicator reflects how similar your workplace situation is to survey respondents who sought treatment. It cannot detect or diagnose any condition.</p></div>`;
    refreshIndex(true); toast('Check complete — dashboard updated');
  } catch (err) { if (err.fields) showErrors(form, err.fields); out.innerHTML = `<div class="banner err">${esc(err.message)}</div>`; }
  finally { btn.disabled = false; btn.textContent = 'Check my support need'; }
}

/* ---------------------------------------------------------------- dashboard / wellness index */
let INDEX = null;
async function refreshIndex(log) {
  const R = S.results, body = { sleep: R.sleep?.p, stress: R.stress?.p, mental: R.mental?.p, environment: S.env?.score, ergonomics: S.ergo?.score };
  Object.keys(body).forEach(k => body[k] == null && delete body[k]);
  if (!Object.keys(body).length) { INDEX = null; return renderDashboard(); }
  try {
    INDEX = await api('/api/wellness', body);
    if (log) { const last = S.indexLog[S.indexLog.length - 1]; if (!last || last.v !== INDEX.index || Date.now() - last.ts > 3600e3) { S.indexLog.push({ ts: Date.now(), v: INDEX.index }); S.indexLog = S.indexLog.slice(-100); save(); } }
  } catch (e) { INDEX = null; }
  renderDashboard();
}
const PILLARS = [
  ['physical', 'Physical', 'Sleep-disorder risk', 'lifestyle', () => S.results.sleep && 100 - S.results.sleep.p * 100],
  ['cognitive', 'Cognitive', 'Mental support need & stress', 'mental', () => { const a = [S.results.mental, S.results.stress].filter(Boolean); return a.length ? 100 - 100 * a.reduce((s, x) => s + x.p, 0) / a.length : null; }],
  ['environment', 'Environment', 'Workspace comfort', 'environment', () => S.env?.score],
  ['ergonomics', 'Ergonomics', 'Workstation set-up', 'coach', () => S.ergo?.score]
];
function renderDashboard() {
  const nm = S.profile.name ? `, ${esc(S.profile.name)}` : '';
  if (INDEX) {
    const b = INDEX.band, word = { good: 'Good', fair: 'Fair', poor: 'Needs attention' }[b];
    $('#indexGauge').innerHTML = gauge(INDEX.index, b, 'higher is better');
    $('#indexText').innerHTML = `<span class="pill ${b}">${word}</span><p style="margin:.6em 0 0">Hello${nm}. Based on <b>${INDEX.coverage}%</b> of the framework${INDEX.coverage < 100 ? ' — complete the remaining checks for a fuller picture' : ''}.</p><p class="muted small">Weights: physical 30%, cognitive 30%, environment 20%, ergonomics 20%. A transparent composite, not a clinical score.</p>`;
    $('#priorities').innerHTML = INDEX.priorities.length ? INDEX.priorities.map(p => `<li><b>${esc(p.pillar[0].toUpperCase() + p.pillar.slice(1))} · ${p.score}/100</b><br><span class="muted">${esc(p.action)}</span></li>`).join('') : '<li>All completed pillars look healthy. Keep your routine and re-check weekly.</li>';
  } else {
    $('#indexGauge').innerHTML = gauge(0, 'fair', 'no data yet'); $('#indexText').innerHTML = `<p>Hello${nm}! Complete any check to see your index.</p><div class="btn-row"><a class="btn primary" href="#lifestyle">Start with Sleep &amp; Stress</a><a class="btn ghost" href="#environment">Load live environment</a></div>`;
    $('#priorities').innerHTML = '<li>Run the Sleep &amp; Stress analysis.</li><li>Answer the Mental Well-being questionnaire.</li><li>Check your live workplace environment and workstation.</li>';
  }
  $('#pillars').innerHTML = PILLARS.map(([k, n, sub, tab, get]) => {
    const v = get(), has = v != null, b = !has ? '' : v >= 75 ? 'good' : v >= 55 ? 'fair' : 'poor';
    return `<a class="card pillar" href="#${tab}" style="text-decoration:none;color:inherit"><span class="tag">${n}</span><span class="v">${has ? Math.round(v) : '—'}<small class="muted" style="font-size:.8rem;font-weight:500"> /100</small></span><div class="bar"><i style="width:${has ? v : 0}%;background:${COLOR[b] || 'var(--line)'}"></i></div><span class="muted small">${sub}${has ? '' : ' · not checked yet'}</span></a>`;
  }).join('');
  $('#dashEnv').innerHTML = ENV.cur ? envSummary() : '<p class="muted">Open <a href="#environment">Live Environment</a> to load real-time weather and air quality for your location.</p>';
  const ms = METRICS.models; if (ms) $('#dashModels').innerHTML = Object.values(ms).map(m => `<div class="factor"><span><b>${esc(m.name)}</b><br><span class="muted small">${esc(m.best_model)} · ${fmt(m.n)} records</span></span><span style="text-align:right">AUC <b>${m.final.test.roc_auc.toFixed(3)}</b><br><span class="muted small">acc ${pct(m.final.test.accuracy, 1)} · test n=${m.n_test}</span></span></div>`).join('');
}

/* ---------------------------------------------------------------- live environment */
const PRESETS = [['Coimbatore, India', 11.0168, 76.9558], ['Chennai, India', 13.0827, 80.2707], ['Bengaluru, India', 12.9716, 77.5946], ['Delhi, India', 28.6139, 77.209], ['Mumbai, India', 19.076, 72.8777], ['London, UK', 51.5072, -0.1276], ['New York, USA', 40.7128, -74.006]];
const ENV = { cur: null, loc: null, timer: null };
const WX = { 0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers', 95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail' };
const aqiCat = a => a == null ? ['—', ''] : a <= 50 ? ['Good', 'good'] : a <= 100 ? ['Moderate', 'fair'] : a <= 150 ? ['Unhealthy for sensitive groups', 'poor'] : a <= 200 ? ['Unhealthy', 'poor'] : a <= 300 ? ['Very unhealthy', 'poor'] : ['Hazardous', 'poor'];
const uvCat = u => u == null ? '' : u < 3 ? 'Low' : u < 6 ? 'Moderate' : u < 8 ? 'High' : u < 11 ? 'Very high' : 'Extreme';
async function getJson(url, ms = 12000) { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(t); } }
function setBanner(kind, html) { $('#envBanner').innerHTML = html ? `<div class="banner ${kind}">${html}</div>` : ''; }
async function loadEnv() {
  const loc = ENV.loc || (ENV.loc = S.loc || { name: PRESETS[0][0], lat: PRESETS[0][1], lon: PRESETS[0][2] });
  $('#envCards').innerHTML = '<div class="skeleton"></div>'.repeat(4); setBanner('inf', `Loading live data for <b>${esc(loc.name)}</b>…`);
  try {
    const q = `latitude=${loc.lat}&longitude=${loc.lon}&timezone=auto`;
    const [w, a] = await Promise.all([
      getJson(`https://api.open-meteo.com/v1/forecast?${q}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code&hourly=temperature_2m,uv_index&forecast_days=2`),
      getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide&hourly=us_aqi&forecast_days=2`).catch(() => null)]);
    const hr = (w.current.time || '').slice(0, 13), i0 = Math.max(0, w.hourly.time.findIndex(t => t.startsWith(hr))), j0 = a ? Math.max(0, a.hourly.time.findIndex(t => t.startsWith(hr))) : 0;
    ENV.cur = { loc, t: w.current.temperature_2m, feels: w.current.apparent_temperature, rh: w.current.relative_humidity_2m, wind: w.current.wind_speed_10m, code: w.current.weather_code, uv: w.hourly.uv_index[i0],
      aqi: a?.current?.us_aqi ?? null, pm25: a?.current?.pm2_5 ?? null, pm10: a?.current?.pm10 ?? null, o3: a?.current?.ozone ?? null, no2: a?.current?.nitrogen_dioxide ?? null, ts: Date.now(),
      hours: w.hourly.time.slice(i0, i0 + 24), temps: w.hourly.temperature_2m.slice(i0, i0 + 24), aqis: a ? a.hourly.us_aqi.slice(j0, j0 + 24) : [] };
    renderEnv(); setBanner('', ''); computeEnvScore(true);
  } catch (err) {
    ENV.cur = null; $('#envCards').innerHTML = ''; $('#envChart').innerHTML = '<p class="muted">No live data.</p>';
    setBanner('err', `Could not load live data (${esc(err.message || 'network error')}). Check your internet connection and press <b>Refresh</b>. You can still enter indoor readings below to score your workspace.`);
  }
  renderDashboard();
}
function envSummary() { const c = ENV.cur, [cat, b] = aqiCat(c.aqi); return `<div class="factor"><span>${esc(c.loc.name)}</span><b>${fmt(c.t, 1)} °C · ${esc(WX[c.code] || '')}</b></div><div class="factor"><span>Humidity</span><b>${c.rh}%</b></div><div class="factor"><span>Air quality (US AQI)</span><b>${c.aqi == null ? '—' : c.aqi} <span class="pill ${b}">${esc(cat)}</span></b></div><div class="muted small" style="margin-top:6px">Updated ${ago(c.ts)}</div>`; }
function renderEnv() {
  const c = ENV.cur, [cat, b] = aqiCat(c.aqi); $('#envUpdated').textContent = `${c.loc.name} · updated ${new Date(c.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  const card = (l, v, s, pill) => `<div class="metric"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s || '&nbsp;'}${pill || ''}</div></div>`;
  $('#envCards').innerHTML = card('Temperature', `${fmt(c.t, 1)}°C`, `Feels like ${fmt(c.feels, 1)}°C · ${esc(WX[c.code] || '')}`) + card('Humidity', `${c.rh}%`, c.rh < 30 ? 'Dry air' : c.rh > 60 ? 'Humid' : 'Comfortable range')
    + card('Air quality (US AQI)', c.aqi ?? '—', '', `<span class="pill ${b}">${esc(cat)}</span>`) + card('UV index', fmt(c.uv, 1), uvCat(c.uv))
    + card('PM2.5', c.pm25 == null ? '—' : fmt(c.pm25, 1), 'µg/m³ · WHO 24h guide 15') + card('PM10', c.pm10 == null ? '—' : fmt(c.pm10, 1), 'µg/m³ · WHO 24h guide 45')
    + card('Ozone / NO₂', `${c.o3 == null ? '—' : fmt(c.o3, 0)} / ${c.no2 == null ? '—' : fmt(c.no2, 0)}`, 'µg/m³') + card('Wind', `${fmt(c.wind, 0)} km/h`, 'at 10 m');
  const lab = c.hours.map((t, i) => i % 4 === 0 ? t.slice(11, 16) : null);
  $('#envChart').innerHTML = `<h3>Temperature (°C)</h3>${lineChart([{ data: c.temps, color: 'var(--primary)' }], { xlabels: lab, h: 150, unit: '°C' })}${c.aqis.length ? `<h3 style="margin-top:8px">US AQI</h3>${lineChart([{ data: c.aqis, color: 'var(--fair)' }], { xlabels: lab, h: 150, min: 0, ref: 100, unit: 'AQI' })}<p class="muted small">Dashed line = AQI 100 (moderate/unhealthy boundary).</p>` : ''}`;
}
async function computeEnvScore(auto) {
  const c = ENV.cur, n = id => { const v = $(id).value; return v === '' ? undefined : +v; }, body = {};
  const it = n('#in_temp'), ih = n('#in_hum'); body.temp = it ?? c?.t; body.humidity = ih ?? c?.rh; if (c?.aqi != null) body.aqi = c.aqi; if (c?.uv != null) body.uv = c.uv; body.co2 = n('#in_co2'); body.lux = n('#in_lux');
  Object.keys(body).forEach(k => body[k] == null && delete body[k]);
  if (!Object.keys(body).length) return $('#envScore').innerHTML = '<div class="banner err">Enter at least one reading or load live data first.</div>';
  try {
    const r = await api('/api/environment/score', body);
    S.env = { score: r.score, band: r.band, ts: Date.now() }; if (!auto) { S.history.push({ ts: Date.now(), type: 'env', label: 'Workspace comfort', value: r.score, band: r.band === 'good' ? 'low' : r.band === 'fair' ? 'moderate' : 'high', invert: true }); toast('Comfort score saved'); } save();
    $('#envScore').innerHTML = `<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:12px">${gauge(r.score, r.band, 'comfort score')}<div><span class="pill ${r.band}">${{ good: 'Comfortable', fair: 'Acceptable', poor: 'Uncomfortable' }[r.band]}</span><p class="muted small">${it == null && ih == null && c ? 'Using outdoor temperature &amp; humidity as a proxy — add indoor readings for accuracy.' : 'Using your indoor readings where provided.'}</p></div></div>
      ${r.factors.map(f => `<div class="factor"><span>${esc(f.name)}</span><span><b>${fmt(f.value, 1)} ${esc(f.unit)}</b> <span class="pill ${f.status}">${f.status}</span></span></div>`).join('')}
      ${r.actions.length ? `<h3 style="margin-top:12px">Recommended adjustments</h3>${recList(r.actions.map(a => ({ priority: a.penalty > 15 ? 'high' : a.penalty > 6 ? 'medium' : 'low', title: a.factor, text: a.text })))}` : '<p class="muted">No adjustments needed — your environment looks good.</p>'}`;
    refreshIndex(false);
  } catch (err) { $('#envScore').innerHTML = `<div class="banner err">${esc(err.message)}</div>`; }
}
const hav = (a, b, c, d) => { const R = 6371, t = x => x * Math.PI / 180, dl = t(c - a), dn = t(d - b), h = Math.sin(dl / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
async function findHospitals() {
  const loc = ENV.loc || S.loc || { name: PRESETS[0][0], lat: PRESETS[0][1], lon: PRESETS[0][2] }, box = $('#hospList');
  const btn = $('#hospBtn'); btn.disabled = true; box.textContent = 'Searching nearby hospitals…';
  const show = list => {
    list = list.filter(h => h.name && h.lat != null).map(h => ({ ...h, km: hav(loc.lat, loc.lon, +h.lat, +h.lon) })).sort((a, b) => a.km - b.km).slice(0, 8);
    if (!list.length) return false;
    box.innerHTML = list.map(h => `<div class="hosp"><span><b>${esc(h.name)}</b>${h.phone ? `<br><span class="muted small">${esc(h.phone)}</span>` : ''}</span><span style="text-align:right">${h.km.toFixed(1)} km<br><a class="small" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${h.lat}&mlon=${h.lon}#map=17/${h.lat}/${h.lon}">Map ↗</a></span></div>`).join('') + '<p class="muted small">Map data © OpenStreetMap contributors. Verify details before travelling.</p>';
    return true;
  };
  const withTimeout = async (url, opts, ms) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); try { const r = await fetch(url, { ...opts, signal: c.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(t); } };
  try {
    // 1) Overpass mirrors (precise), tried one after another
    const q = `[out:json][timeout:15];(node["amenity"="hospital"](around:8000,${loc.lat},${loc.lon});way["amenity"="hospital"](around:8000,${loc.lat},${loc.lon}););out center 30;`;
    const mirrors = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
    for (const m of mirrors) {
      try {
        const d = await withTimeout(m, { method: 'POST', body: 'data=' + encodeURIComponent(q) }, 12000);
        if (show(d.elements.map(e => ({ name: e.tags?.name, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, phone: e.tags?.phone || e.tags?.['contact:phone'] })))) return;
        box.textContent = 'No hospitals found within 8 km in OpenStreetMap.'; return;
      } catch (e) { /* try next mirror */ }
    }
    // 2) Nominatim search (lighter fallback)
    const dx = 0.1, vb = `${loc.lon - dx},${loc.lat + dx},${loc.lon + dx},${loc.lat - dx}`;
    const n = await withTimeout(`https://nominatim.openstreetmap.org/search?q=hospital&format=jsonv2&limit=20&bounded=1&viewbox=${vb}`, {}, 12000);
    if (show(n.map(x => ({ name: (x.name || x.display_name || '').split(',')[0], lat: x.lat, lon: x.lon })))) return;
    box.textContent = 'No hospitals found nearby in OpenStreetMap.';
  } catch (e) {
    box.innerHTML = `The hospital search service is busy right now. <button class="btn ghost sm" id="hospRetry">Try again</button> or <a target="_blank" rel="noopener" href="https://www.openstreetmap.org/search?query=hospital#map=13/${loc.lat}/${loc.lon}">search hospitals on the map ↗</a>`;
    $('#hospRetry').onclick = findHospitals;
  } finally { btn.disabled = false; }
}
function initEnv() {
  $('#locForm').onsubmit = async e => {
    e.preventDefault(); const q = $('#locInput').value.trim(), box = $('#locResults'); if (!q) return; box.textContent = 'Searching…';
    try { const d = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en`);
      if (!d.results?.length) { box.textContent = 'No matching place found.'; return; }
      box.innerHTML = d.results.map((r, i) => `<button type="button" data-i="${i}">${esc(r.name)}${r.admin1 ? ', ' + esc(r.admin1) : ''}, ${esc(r.country || '')}</button>`).join('');
      $$('button', box).forEach(b => b.onclick = () => { const r = d.results[+b.dataset.i]; setLoc({ name: `${r.name}, ${r.country || ''}`.replace(/, $/, ''), lat: r.latitude, lon: r.longitude }); box.innerHTML = ''; });
    } catch (err) { box.textContent = 'Place search failed — are you online? Try a preset below.'; } };
  $('#locResults').innerHTML = PRESETS.map((p, i) => `<button type="button" data-p="${i}">${esc(p[0])}</button>`).join('');
  $('#locResults').onclick = e => { const b = e.target.closest('[data-p]'); if (b) { const p = PRESETS[+b.dataset.p]; setLoc({ name: p[0], lat: p[1], lon: p[2] }); } };
  $('#geoBtn').onclick = () => { if (!navigator.geolocation) return toast('Geolocation is not supported by this browser'); toast('Requesting your location…');
    navigator.geolocation.getCurrentPosition(p => setLoc({ name: 'My location', lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4) }), () => toast('Location permission denied — search a city instead'), { timeout: 10000 }); };
  $('#envRefresh').onclick = loadEnv; $('#envScoreBtn').onclick = () => computeEnvScore(false); $('#hospBtn').onclick = findHospitals;
  onShow.environment = () => { if (!ENV.cur) loadEnv(); };
  ENV.timer = setInterval(() => { if (location.hash === '#environment' || ENV.cur) loadEnv(); }, 10 * 60 * 1000);
}
function setLoc(l) { ENV.loc = l; S.loc = l; save(); loadEnv(); }

/* ---------------------------------------------------------------- coach: timer, exercises, ergonomics, chat */
const MODES = { eye: { name: '20-20-20 eye rest', work: 1200, rest: 20, tip: 'Every 20 minutes look at something 20 feet (6 m) away for 20 seconds.' }, pomo: { name: 'Pomodoro 25/5', work: 1500, rest: 300, tip: 'Focus for 25 minutes, then take a real 5-minute break away from the screen.' }, move: { name: 'Move break 30/2', work: 1800, rest: 120, tip: 'Every 30 minutes stand, walk and stretch for 2 minutes to offset prolonged sitting.' } };
const T = { mode: 'eye', phase: 'work', running: false, end: 0, left: MODES.eye.work, id: null };
const todayKey = () => new Date().toISOString().slice(0, 10);
function beep() { try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = 660; g.gain.setValueAtTime(.12, a.currentTime); g.gain.exponentialRampToValueAtTime(.001, a.currentTime + .6); o.start(); o.stop(a.currentTime + .6); } catch (e) { /* audio blocked */ } }
function notify(msg) { toast(msg); beep(); try { if ('Notification' in window && Notification.permission === 'granted') new Notification('NeuroErgo Health', { body: msg }); } catch (e) { /* ignore */ } }
function drawTimer() {
  const m = MODES[T.mode], tot = T.phase === 'work' ? m.work : m.rest, s = Math.max(0, Math.ceil(T.left));
  $('#timerRing').innerHTML = ring(1 - T.left / tot, `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`, T.phase === 'work' ? (T.running ? 'focus time' : 'ready') : 'break — rest now', T.phase === 'work' ? 'var(--primary)' : 'var(--good)');
  $('#timerStart').textContent = T.running ? 'Pause' : (T.left < tot ? 'Resume' : 'Start'); $('#timerHint').textContent = m.tip;
  $('#breakStats').textContent = `Breaks taken today: ${S.breaks[todayKey()] || 0}`;
}
function tick() {
  if (!T.running) return; T.left = (T.end - Date.now()) / 1000;
  if (T.left <= 0) { const m = MODES[T.mode]; if (T.phase === 'work') { T.phase = 'rest'; T.left = m.rest; notify(`Break time! ${T.mode === 'eye' ? 'Look 20 feet away for 20 seconds.' : 'Stand up, stretch and rest your eyes.'}`); } else { T.phase = 'work'; T.left = m.work; S.breaks[todayKey()] = (S.breaks[todayKey()] || 0) + 1; save(); notify('Break complete — nice work. Back to focus.'); }
    T.end = Date.now() + T.left * 1000; }
  drawTimer();
}
const EXERCISES = [['Neck release', 30, 'Tilt your ear toward your shoulder, hold 15 s each side. Keep shoulders down.'], ['Shoulder rolls', 30, 'Roll shoulders slowly up, back and down, 10 repetitions each way.'], ['Wrist & finger stretch', 30, 'Extend one arm palm up, gently pull fingers back 15 s; switch arms.'], ['Seated spinal twist', 40, 'Sit tall, rotate your torso to one side holding the chair back for 20 s; switch.'], ['Eye palming', 30, 'Rub palms warm, cup them over closed eyes in darkness and breathe slowly.']];
function initCoach() {
  $('#timerModes').innerHTML = Object.entries(MODES).map(([k, m]) => `<button data-m="${k}" class="${k === T.mode ? 'on' : ''}">${m.name}</button>`).join('');
  $('#timerModes').onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; T.mode = b.dataset.m; T.phase = 'work'; T.running = false; T.left = MODES[T.mode].work; $$('#timerModes button').forEach(x => x.classList.toggle('on', x === b)); drawTimer(); };
  $('#timerStart').onclick = () => { T.running = !T.running; if (T.running) T.end = Date.now() + T.left * 1000; drawTimer(); };
  $('#timerReset').onclick = () => { T.running = false; T.phase = 'work'; T.left = MODES[T.mode].work; drawTimer(); };
  $('#notifyBtn').onclick = async () => { if (!('Notification' in window)) return toast('Notifications are not supported here'); const p = await Notification.requestPermission(); toast(p === 'granted' ? 'Desktop alerts enabled' : 'Alerts blocked — in-page reminders and sound still work'); };
  setInterval(tick, 250); drawTimer();
  $('#exercises').innerHTML = EXERCISES.map(([n, s, d], i) => `<div class="ex"><div><b>${n}</b><span>${d}</span></div><button class="btn ghost sm" data-ex="${i}">Start ${s}s</button></div>`).join('');
  let active = null; $('#exercises').onclick = e => { const b = e.target.closest('[data-ex]'); if (!b) return; if (active) { clearInterval(active.t); active.b.textContent = active.label; if (active.b === b) { active = null; return; } }
    const i = +b.dataset.ex, label = `Start ${EXERCISES[i][1]}s`; let left = EXERCISES[i][1]; b.textContent = `${left}s — stop`; active = { b, label, t: setInterval(() => { left--; if (left <= 0) { clearInterval(active.t); b.textContent = '✓ Done'; toast(`${EXERCISES[i][0]} complete`); active = null; setTimeout(() => b.textContent = label, 2500); } else b.textContent = `${left}s — stop`; }, 1000) }; };
  api('/api/ergonomics/items').then(items => { $('#ergoList').innerHTML = items.map(i => `<label><input type="checkbox" value="${i.key}"${(S.ergo?.checked || []).includes(i.key) ? ' checked' : ''}><span>${esc(i.text)}</span></label>`).join(''); if (S.ergo) showErgo(S.ergo); });
  $('#ergoBtn').onclick = async () => { const checked = $$('#ergoList input:checked').map(x => x.value); try { const r = await api('/api/ergonomics/score', { checked }); S.ergo = { score: r.score, band: r.band, checked, fixes: r.fixes, ts: Date.now() };
    S.history.push({ ts: Date.now(), type: 'ergo', label: 'Workstation ergonomics', value: r.score, band: r.band === 'good' ? 'low' : r.band === 'fair' ? 'moderate' : 'high', invert: true }); save(); showErgo(S.ergo); refreshIndex(true); } catch (e) { toast(e.message); } };
  const log = $('#chatLog'), say = (t, me) => { const d = document.createElement('div'); d.className = 'msg ' + (me ? 'me' : 'bot'); d.textContent = t; log.appendChild(d); log.scrollTop = log.scrollHeight; };
  say('Hi! I am your rule-based wellness coach. I use your latest results (if any) to tailor tips. What would you like help with?');
  $('#chatChips').innerHTML = ['How is my sleep?', 'I feel stressed', 'Neck and back pain', 'Eye strain', 'Explain my results'].map(t => `<button type="button">${t}</button>`).join('');
  const ask = t => { say(t, true); setTimeout(() => say(coachReply(t)), 250); };
  $('#chatChips').onclick = e => { if (e.target.tagName === 'BUTTON') ask(e.target.textContent); };
  $('#chatForm').onsubmit = e => { e.preventDefault(); const v = $('#chatInput').value.trim(); if (v) { ask(v); $('#chatInput').value = ''; } };
}
function showErgo(e) { $('#ergoRes').innerHTML = `<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:12px">${gauge(e.score, e.band, 'workstation score')}<div><span class="pill ${e.band}">${{ good: 'Well set up', fair: 'Room to improve', poor: 'Needs work' }[e.band]}</span></div></div>${e.fixes.length ? recList(e.fixes.slice(0, 5).map(f => ({ priority: f.weight >= 14 ? 'high' : 'medium', title: f.item.replace(/^I /, 'You: '), text: f.fix }))) : '<p class="muted">Great set-up — keep it up!</p>'}`; }
function coachReply(t) {
  const q = t.toLowerCase(), R = S.results, has = k => R[k]; const lvl = k => has(k) ? `${SHORT[R[k].band].toLowerCase()} (${Math.round(R[k].p * 100)}%)` : null;
  if (/chest pain|can.?t breathe|suicid|self.?harm|kill myself|emergency|faint/.test(q)) return 'This could be urgent. Please call your local emergency number now (India: 112) or go to the nearest hospital. If you are thinking about harming yourself, call Tele-MANAS 14416 (India, 24×7) or find a helpline at findahelpline.com. You do not have to handle this alone.';
  if (/result|score|index|explain|summary/.test(q)) { const p = []; if (has('sleep')) p.push(`sleep-disorder risk: ${lvl('sleep')}`); if (has('stress')) p.push(`stress indicator: ${lvl('stress')}`); if (has('mental')) p.push(`mental well-being support need: ${lvl('mental')}`); if (S.env) p.push(`workspace comfort: ${S.env.score}/100`); if (S.ergo) p.push(`workstation: ${S.ergo.score}/100`);
    return p.length ? `Here is where you stand — ${p.join('; ')}.${INDEX ? ` Overall wellness index: ${INDEX.index}/100.` : ''} Open the Dashboard for priorities.` : 'You have no results yet. Start with Sleep & Stress Risk or Mental Well-being, then I can summarise them.'; }
  if (/sleep|insomnia|tired|snor/.test(q)) return (has('sleep') ? `Your sleep-disorder risk is ${lvl('sleep')}. ` : 'Run the Sleep & Stress check for a personal estimate. ') + 'General tips: keep a fixed wake time, get morning daylight, stop caffeine ~8 h before bed, keep screens dim an hour before sleep, and keep the room cool and dark. Loud snoring, gasping or heavy daytime sleepiness deserve a doctor’s review.';
  if (/stress|anxi|overwhelm|burn|pressure|worr/.test(q)) return (has('stress') ? `Your stress indicator is ${lvl('stress')}. ` : '') + 'Try box breathing (inhale 4 s, hold 4, exhale 6) for 2 minutes, take a real break every 60–90 minutes, and note which task triggers the pressure. If stress lasts more than a couple of weeks, talk to a counsellor or doctor — Tele-MANAS 14416 is free in India.';
  if (/neck|back|posture|shoulder|wrist|sit|desk|chair|monitor/.test(q)) return 'Set the screen top at eye level, an arm’s length away; keep feet flat, hips slightly above knees, elbows ~90°. Stand and stretch every 30–60 minutes — try the guided exercises on this page and use the workstation check to find the biggest fixes.' + (S.ergo ? ` Your last workstation score: ${S.ergo.score}/100.` : '');
  if (/eye|screen|head|vision|blur/.test(q)) return 'Use the 20-20-20 rule (the eye-rest timer here), reduce glare, keep text comfortably large, blink often and aim for 300–500 lux of room light. Persistent headaches or blurred vision should be checked by an eye doctor.';
  if (/break|timer|focus|pomodoro/.test(q)) return 'Use the break timer: 20-20-20 for eyes, Pomodoro 25/5 for focus, or Move break 30/2 against prolonged sitting. Even 2 minutes of walking helps circulation.';
  if (/air|pollut|aqi|weather|hot|cold|humid|co2|ventilat/.test(q)) return (ENV.cur ? `Right now in ${ENV.cur.loc.name}: ${fmt(ENV.cur.t, 1)} °C, AQI ${ENV.cur.aqi ?? 'n/a'}. ` : 'Open Live Environment to load real-time data. ') + 'Ideal desk conditions: 20–25 °C, 30–60% humidity, CO₂ under ~800 ppm and 300–500 lux. Ventilate when outdoor AQI is good; use a HEPA purifier when it is not.';
  if (/mental|depress|sad|mood|lonely/.test(q)) return (has('mental') ? `Your support-need indicator is ${lvl('mental')}. ` : '') + 'Low mood is common and treatable. Keep routines, move daily, stay in touch with people you trust and consider speaking to a GP or counsellor. India: Tele-MANAS 14416 (free, 24×7). Elsewhere: findahelpline.com.';
  if (/diet|food|water|eat|hydrat/.test(q)) return 'Aim for regular meals with vegetables, protein and whole grains, drink water through the day, and limit sugary drinks and late caffeine. For a personal plan see a registered dietitian.';
  return 'I can help with sleep, stress, posture, eye strain, breaks, air quality and understanding your results. Try one of the quick prompts below, or ask in your own words. I am rule-based and cannot diagnose conditions.';
}

/* ---------------------------------------------------------------- tools */
function initTools() {
  const bmi = () => { const w = +$('#bmi_w').value, h = +$('#bmi_h').value / 100, o = $('#bmiOut'); if (!(w >= 20 && h >= 1)) return o.innerHTML = '<p class="muted">Enter valid weight and height.</p>';
    const v = w / (h * h), cat = v < 18.5 ? ['Underweight', 'fair'] : v < 25 ? ['Healthy weight', 'good'] : v < 30 ? ['Overweight', 'fair'] : ['Obese', 'poor'], model = v < 25 ? 'Normal' : v < 30 ? 'Overweight' : 'Obese';
    o.innerHTML = `<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">${ring(Math.min(v, 40) / 40, v.toFixed(1), 'BMI kg/m²', COLOR[cat[1]], 140)}<div><span class="pill ${cat[1]}">${cat[0]}</span><p class="muted small">Healthy range for your height: ${(18.5 * h * h).toFixed(1)}–${(24.9 * h * h).toFixed(1)} kg.<br>South-Asian guidance uses lower cut-offs (overweight ≥ 23, obese ≥ 27.5).</p><button class="btn ghost sm" id="useBmi">Use in Sleep &amp; Stress form (${model})</button></div></div>`;
    $('#useBmi').onclick = () => { const f = $('#form-sleep'); if (f && SCHEMA.sleep) { setValues(f, 'sleep', { 'BMI Category': model }); toast(`BMI category set to ${model}`); } }; };
  const bp = () => { const s = +$('#bp_s').value, d = +$('#bp_d').value, o = $('#bpOut'); if (!(s > 60 && d > 30)) return o.innerHTML = '<p class="muted">Enter valid readings.</p>';
    const [n, b, t] = (s > 180 || d > 120) ? ['Hypertensive crisis', 'poor', 'If you have symptoms such as chest pain, breathlessness or severe headache, seek emergency care. Otherwise re-measure after 5 minutes and contact a doctor urgently.'] : (s >= 140 || d >= 90) ? ['Hypertension stage 2', 'poor', 'Consult a doctor; medication and lifestyle change are usually advised.'] : (s >= 130 || d >= 80) ? ['Hypertension stage 1', 'fair', 'Confirm with repeated readings and discuss with a doctor; reduce salt, exercise and manage weight.'] : s >= 120 ? ['Elevated', 'fair', 'Lifestyle changes (less salt, more activity, healthy weight) can bring this down.'] : ['Normal', 'good', 'Keep up healthy habits and check yearly.'];
    o.innerHTML = `<div class="factor"><span>Reading</span><b>${s}/${d} mm Hg</b></div><p><span class="pill ${b}">${n}</span></p><p class="muted small">${t}<br>Categories follow the 2017 AHA/ACC guideline. A single reading is not a diagnosis.</p>`; };
  ['bmi_w', 'bmi_h'].forEach(i => $('#' + i).oninput = bmi); ['bp_s', 'bp_d'].forEach(i => $('#' + i).oninput = bp); bmi(); bp();
}

/* ---------------------------------------------------------------- model lab */
let labSel = 'sleep';
function renderLab() {
  const ms = METRICS.models; if (!ms) return; const tabs = [...Object.keys(ms), 'eeg', 'method'], names = { eeg: 'EEG study', method: 'Protocol' };
  $('#labSeg').innerHTML = tabs.map(k => `<button data-k="${k}" class="${k === labSel ? 'on' : ''}">${esc(names[k] || ms[k].name)}</button>`).join('');
  $('#labSeg').onclick = e => { const b = e.target.closest('[data-k]'); if (b) { labSel = b.dataset.k; renderLab(); } };
  $('#labBody').innerHTML = labSel === 'eeg' ? labEEG() : labSel === 'method' ? labMethod() : labModel(ms[labSel]);
}
function labModel(m) {
  const f = m.final, t = f.test, ci = f.ci, rc = f.repeated_cv, M = (l, v, s) => `<div class="metric"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s || '&nbsp;'}</div></div>`;
  const caveat = m.key === 'mental' ? 'Behavioural survey data is noisy; ≈0.79 AUC is typical and honest. <b>work_interfere</b> was excluded because it is a proxy of the target.' : 'This public dataset is small (132 unique profiles) and synthetic-style; scores are optimistic and need validation on real clinical cohorts. Identical profiles were kept in the same fold to avoid leakage.';
  return `<div class="notice" style="margin-bottom:16px"><b>${esc(m.best_model)}</b> was selected by 5-fold cross-validated ROC-AUC on the training split only. Test set used once. ${caveat}</div>
  <div class="grid four">${M('Accuracy', pct(t.accuracy), `95% CI ${pct(ci.accuracy[0], 0)}–${pct(ci.accuracy[1], 0)}`)}${M('ROC-AUC', t.roc_auc.toFixed(3), `95% CI ${ci.roc_auc[0].toFixed(2)}–${ci.roc_auc[1].toFixed(2)}`)}${M('Sensitivity (recall)', pct(t.recall), `95% CI ${pct(ci.recall[0], 0)}–${pct(ci.recall[1], 0)}`)}${M('Specificity', pct(t.specificity), 'true negative rate')}
  ${M('Precision', pct(t.precision), '')}${M('F1-score', t.f1.toFixed(3), '')}${M('Brier score', t.brier.toFixed(3), 'lower is better')}${M('Repeated 5×3 CV AUC', `${rc.roc_auc.mean.toFixed(3)}`, `± ${rc.roc_auc.std.toFixed(3)} · acc ${pct(rc.accuracy.mean)}`)}</div>
  <div class="card" style="margin-bottom:16px"><div class="card-h"><h2>Model comparison</h2><span class="muted small">Test split: ${m.n_test} of ${fmt(m.n)} records · train ${m.n_train}</span></div><div class="tablewrap"><table><thead><tr><th>Model</th><th class="num">CV AUC (mean ± sd)</th><th class="num">Test acc.</th><th class="num">Test AUC</th><th class="num">Recall</th><th class="num">Specificity</th><th class="num">F1</th></tr></thead><tbody>
  ${m.models.map(r => `<tr class="${r.name === m.best_model ? 'best' : ''}"><td>${esc(r.name)}${r.name === m.best_model ? ' ✓ selected' : ''}</td><td class="num">${r.name.startsWith('Baseline') ? '—' : `${r.cv_auc_mean.toFixed(3)} ± ${r.cv_auc_std.toFixed(3)}`}</td><td class="num">${pct(r.test.accuracy)}</td><td class="num">${r.test.roc_auc.toFixed(3)}</td><td class="num">${pct(r.test.recall)}</td><td class="num">${pct(r.test.specificity)}</td><td class="num">${r.test.f1.toFixed(3)}</td></tr>`).join('')}</tbody></table></div>
  <p class="muted small">Best hyper-parameters (${esc(m.best_model)}): ${esc(JSON.stringify(m.best_params))}</p></div>
  <div class="grid three"><div class="card"><div class="card-h"><h2>ROC curve</h2></div><div class="chartwrap">${rocChart(f.roc, t.roc_auc)}</div></div>
  <div class="card"><div class="card-h"><h2>Confusion matrix</h2></div>${confMatrix(f.confusion)}<p class="muted small">Hold-out test set (n=${m.n_test}).</p></div>
  <div class="card"><div class="card-h"><h2>Calibration</h2></div><div class="chartwrap">${calibChart(f.calibration)}</div><p class="muted small">Out-of-fold predictions; dashed = perfect.</p></div></div>
  <div class="grid two"><div class="card"><div class="card-h"><h2>Global feature importance</h2></div><p class="muted small">Permutation importance: drop in test ROC-AUC when a feature is shuffled.</p>${hbars(f.importance.slice(0, 9).map(i => ({ l: i.feature, v: Math.max(i.mean, 0), t: i.mean.toFixed(3) })))}</div>
  <div class="card"><div class="card-h"><h2>Dataset</h2></div><div class="factor"><span>Source</span><a href="${esc(m.source_url)}" target="_blank" rel="noopener">${esc(m.dataset)}</a></div><div class="factor"><span>Records / features</span><b>${fmt(m.n)} / ${m.n_features}</b></div><div class="factor"><span>Target</span><b>${esc(m.target)}</b></div><div class="factor"><span>Positive rate</span><b>${pct(m.prevalence)}</b></div><p class="muted small">${esc(m.note)}</p>
  <img src="/reports/${m.key}_evaluation.png" alt="Training report figure for ${esc(m.name)}" style="width:100%;border:1px solid var(--line);border-radius:10px;margin-top:6px" loading="lazy"></div></div>
  <div class="card" style="margin-top:16px"><div class="card-h"><h2>Downloads</h2></div><div class="btn-row"><a class="btn ghost sm" href="/reports/training_log.txt" download>training_log.txt</a><a class="btn ghost sm" href="/models/metrics.json" download>metrics.json</a><a class="btn ghost sm" href="/reports/${m.key}_evaluation.png" download>${m.key}_evaluation.png</a></div></div>`;
}
function labEEG() {
  const e = METRICS.eeg_study, rows = Object.entries(e.results).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${pct(v.random_split.accuracy)}</td><td class="num">${v.random_split.roc_auc.toFixed(3)}</td><td class="num">${pct(v.blocked_split.accuracy)}</td><td class="num">${v.blocked_split.roc_auc.toFixed(3)}</td></tr>`).join('');
  return `<div class="card"><div class="card-h"><h2>Why no EEG model is deployed</h2></div><p>The NeuroErgoML paper uses EEG for cognitive fatigue. We tested the public <b>${esc(e.dataset)}</b> (14 channels, 128 Hz, eyes open vs closed) with two evaluation schemes:</p>
  <div class="tablewrap"><table><thead><tr><th>Model</th><th class="num">Random-split acc.</th><th class="num">AUC</th><th class="num">Time-blocked acc.</th><th class="num">AUC</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p>Random splits look excellent (≈91–94%) because neighbouring samples of a continuous recording are almost identical — the model memorises the signal. Holding out whole 15-second blocks, performance collapses to chance (AUC ≈ 0.6). A model that cannot generalise to unseen time periods would give users false confidence, so we <b>did not deploy it</b>. This negative result is reported on purpose: it is what rigorous, leakage-aware evaluation looks like, and it motivates collecting multi-subject EEG with subject-wise splits as future work.</p></div>`;
}
function labMethod() {
  return `<div class="card"><div class="card-h"><h2>Training &amp; evaluation protocol (train.py)</h2></div><ol class="plain">
  <li><b>Real data, cleaned.</b> OSMI survey (impossible ages removed, gender normalised, duplicates dropped, target-proxy feature excluded). Sleep dataset: blood pressure parsed, impossible categories merged, 242 duplicate rows grouped.</li>
  <li><b>Leakage control.</b> Stratified 80/20 split; for the sleep data identical profiles are always in the same fold (StratifiedGroupKFold / GroupShuffleSplit). All imputation, scaling and encoding live inside the pipeline so they are fitted on training folds only.</li>
  <li><b>Model families.</b> Majority-class baseline, Logistic Regression, Random Forest, Gradient Boosting, SVM (RBF) and a Neural Network (MLP), each tuned with grid search on 5-fold CV ROC-AUC (training split only).</li>
  <li><b>Selection without peeking.</b> The winner is chosen by CV score; the test set is evaluated once.</li>
  <li><b>Metrics.</b> Accuracy, precision, recall (sensitivity), specificity, F1, ROC-AUC, Brier score, bootstrap 95% confidence intervals, confusion matrix, ROC and calibration curves, repeated 5×3 CV for stability.</li>
  <li><b>Explainability.</b> Global permutation importance on the test set; per-prediction occlusion analysis shown after every assessment.</li>
  <li><b>Deployment.</b> Final pipeline refit on all labelled data and served by Flask (<code>models/*.joblib</code>). No external AI or LLM API is used.</li></ol>
  <p class="muted small">Reproduce: <code>pip install -r requirements.txt &amp;&amp; python train.py</code> (≈2 minutes). Seeds are fixed (42).</p></div>`;
}

/* ---------------------------------------------------------------- history */
function renderHistory() {
  $('#profName').value = S.profile.name || '';
  $('#histChart').innerHTML = S.indexLog.length ? lineChart([{ data: S.indexLog.map(x => x.v), color: 'var(--primary)' }], { min: 0, max: 100, ref: 75, xlabels: S.indexLog.map((x, i) => (i % Math.ceil(S.indexLog.length / 6) === 0 ? new Date(x.ts).toLocaleDateString([], { day: 'numeric', month: 'short' }) : null)), unit: 'index' }) + '<p class="muted small">Dashed line = 75 (good).</p>' : '<p class="muted">Your Wellness Index trend will appear after your first checks.</p>';
  const rows = [...S.history].reverse();
  $('#histTable').innerHTML = rows.length ? `<div class="tablewrap"><table><thead><tr><th>When</th><th>Check</th><th class="num">Result</th><th>Level</th></tr></thead><tbody>${rows.map(r => { const good = r.invert ? r.band === 'low' : null; const b = r.invert ? (r.band === 'low' ? 'good' : r.band === 'moderate' ? 'fair' : 'poor') : r.band; return `<tr><td>${new Date(r.ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td><td>${esc(r.label)}</td><td class="num">${r.value}${r.invert ? ' /100' : '% risk'}</td><td><span class="pill ${b}">${r.invert ? { good: 'good', fair: 'fair', poor: 'poor' }[b] : SHORT[r.band]}</span></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted">No assessments yet.</p>';
}
function initHistory() {
  onShow.history = renderHistory;
  $('#profName').oninput = e => { S.profile.name = e.target.value.slice(0, 40); save(); renderDashboard(); };
  $('#exportCsv').onclick = () => { const q = v => `"${String(v).replace(/"/g, '""')}"`, csv = ['timestamp,check,result,unit,level', ...S.history.map(r => [new Date(r.ts).toISOString(), q(r.label), r.value, r.invert ? 'score/100' : 'risk %', r.band].join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'neuroergo-history.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  $('#printBtn').onclick = () => window.print();
  $('#clearBtn').onclick = () => { if (!confirm('Delete all saved results, history and settings from this browser?')) return; S = { profile: { name: '' }, results: {}, env: null, ergo: null, history: [], indexLog: [], breaks: {}, loc: null }; try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } INDEX = null; renderHistory(); renderDashboard(); toast('All local data deleted'); };
}

/* ---------------------------------------------------------------- about */
function renderAbout() {
  $('#aboutBody').innerHTML = `<div class="card" style="margin-bottom:16px"><h2>NeuroErgo Health</h2><p>An evidence-based extension of <b>“NeuroErgoML: A Multimodal Deep Reinforcement Learning Framework for Cognitive-Aware and Adaptive Workplace Ergonomics”</b> (Division of AI &amp; ML, Karunya Institute of Technology and Sciences). The paper argues that workplace health must combine <b>physical</b>, <b>cognitive</b> and <b>environmental</b> ergonomics. This project turns that idea into a working healthcare application whose predictive models are <b>trained and validated by us on real datasets</b>.</p></div>
  <div class="card" style="margin-bottom:16px"><div class="card-h"><h2>Paper → application mapping</h2></div><div class="tablewrap"><table><thead><tr><th>Paper layer / objective</th><th>In this project</th><th>Status</th></tr></thead><tbody>
  <tr><td>Physical ergonomics (IMU, posture)</td><td>Sleep-disorder risk model (vitals, activity, BMI) + workstation ergonomics checklist</td><td><span class="pill good">Trained model + rules</span></td></tr>
  <tr><td>Cognitive ergonomics (EEG, fatigue, stress)</td><td>Mental-well-being support-need model (OSMI survey) + high-stress indicator model; EEG feasibility study documented</td><td><span class="pill good">Trained models</span></td></tr>
  <tr><td>Environmental ergonomics (IoT: temp, humidity, air)</td><td>Live Open-Meteo weather &amp; air-quality feed, indoor CO₂/lux entry, standards-based comfort score</td><td><span class="pill fair">Live data + rules</span></td></tr>
  <tr><td>Multimodal fusion → ergonomic risk score</td><td>Workplace Wellness Index: transparent weighted fusion of the four pillars (30/30/20/20)</td><td><span class="pill fair">Rule-based fusion</span></td></tr>
  <tr><td>Adaptive interventions (micro-breaks, adjustments)</td><td>Break timer, guided exercises, prioritised action plans and a coach that uses your results</td><td><span class="pill fair">Rule-based</span></td></tr>
  <tr><td>Explainable dashboards (future work in paper)</td><td>Per-prediction driver charts, global importance, calibration and ROC in Model Lab</td><td><span class="pill good">Implemented</span></td></tr>
  <tr><td>Privacy</td><td>Results stored only in your browser; no external AI services</td><td><span class="pill good">Implemented</span></td></tr>
  <tr><td>CNN–LSTM–Transformer, deep RL agent, federated learning</td><td>Not implemented: they need multimodal sensor data (EEG headband, IMU, cameras) that is not publicly available at scale. Listed as future work; the paper’s 92% accuracy claim is not reproduced here.</td><td><span class="pill poor">Future work</span></td></tr></tbody></table></div></div>
  <div class="grid two"><div class="card"><h2>Datasets &amp; real-time data</h2><ul><li><a href="https://www.kaggle.com/datasets/osmi/mental-health-in-tech-survey" target="_blank" rel="noopener">OSMI Mental Health in Tech Survey (2014)</a> — 1,259 respondents.</li><li><a href="https://www.kaggle.com/datasets/uom190346a/sleep-health-and-lifestyle-dataset" target="_blank" rel="noopener">Sleep Health &amp; Lifestyle Dataset</a> — 374 records.</li><li><a href="https://archive.ics.uci.edu/dataset/264/eeg+eye+state" target="_blank" rel="noopener">UCI EEG Eye State</a> — feasibility study only.</li><li><a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> weather &amp; air-quality (live, free, no key) and <a href="https://www.openstreetmap.org" target="_blank" rel="noopener">OpenStreetMap</a> for nearby hospitals.</li></ul></div>
  <div class="card"><h2>Limitations &amp; safety</h2><ul><li>Educational prototype — <b>not a medical device</b>; it cannot diagnose or replace a clinician.</li><li>The sleep dataset is small and synthetic-style; the OSMI survey covers mostly tech workers in 2014. Performance on other populations is unknown.</li><li>The Wellness Index and comfort score are transparent composites, not validated clinical scores.</li><li>Live data needs an internet connection and is subject to the providers’ availability.</li><li>In an emergency call your local emergency number (India: 112). Mental-health support in India: Tele-MANAS 14416.</li></ul></div></div>
  <div class="card" style="margin-top:16px"><h2>Run it yourself</h2><pre style="background:var(--bg);padding:12px;border-radius:10px;overflow:auto">pip install -r requirements.txt\npython train.py     # trains, evaluates, saves models + reports\npython app.py       # http://127.0.0.1:5000</pre></div>`;
}

/* ---------------------------------------------------------------- boot */
async function boot() {
  $('#clock').textContent = new Date().toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  setInterval(() => { $('#clock').textContent = new Date().toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }, 30000);
  const ping = async () => { try { await api('/api/health'); $('#apiStatus').textContent = '● models online'; $('#apiStatus').className = 'chip ok'; } catch (e) { $('#apiStatus').textContent = '● server offline'; $('#apiStatus').className = 'chip bad'; } };
  try { [SCHEMA, METRICS] = await Promise.all([api('/api/schema'), api('/api/metrics')]); }
  catch (e) { $('#main').insertAdjacentHTML('afterbegin', `<div class="banner err">Could not reach the model server (${esc(e.message)}). Start it with <code>python app.py</code> and reload.</div>`); }
  ping(); setInterval(ping, 60000);
  if (SCHEMA.sleep) { buildForm($('#form-sleep'), 'sleep'); buildForm($('#form-mental'), 'mental'); $('#form-sleep').onsubmit = submitLifestyle; $('#form-mental').onsubmit = submitMental; }
  initEnv(); initCoach(); initTools(); initHistory(); renderAbout(); renderLab(); onShow.lab = renderLab;
  $('#refreshIndex').onclick = () => refreshIndex(true);
  window.addEventListener('hashchange', route); route(); refreshIndex(false);
  if (S.loc) ENV.loc = S.loc;
}
document.addEventListener('DOMContentLoaded', boot);
})();
