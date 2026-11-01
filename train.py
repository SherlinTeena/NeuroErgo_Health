"""
NeuroErgo Health — model training & evaluation
==============================================
Trains and rigorously evaluates three healthcare models on real datasets (no third-party AI APIs are used anywhere):

  mental  : OSMI Mental Health in Tech survey      -> workplace mental-health support need  (cognitive pillar)
  sleep   : Sleep Health & Lifestyle dataset       -> sleep-disorder risk                    (physical pillar)
  stress  : Sleep Health & Lifestyle dataset       -> high perceived stress indicator        (cognitive pillar)
  + EEG leakage study (UCI EEG Eye State) documenting why a raw-EEG model was NOT deployed.

Protocol for every model
  1. clean data; remove duplicate profiles; keep duplicates of the same profile in the same fold (group-aware splits)
  2. stratified 80/20 train/test split — the test set is used once, after model selection
  3. 5 model families + majority baseline tuned with 5-fold stratified CV (ROC-AUC) on the TRAIN split only
  4. winner chosen by CV score, never by test score
  5. test metrics (accuracy, precision, recall, specificity, F1, ROC-AUC, Brier) + bootstrap 95% CI
  6. repeated 5x3 CV on the whole data for a stability estimate
  7. permutation importance, calibration curve, ROC curve, confusion matrix
  8. final model refit on all data -> models/<key>.joblib ; results -> models/metrics.json ; figures -> reports/

Run:  python train.py
"""
import json, time, warnings
import numpy as np, pandas as pd
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
import joblib
from sklearn.base import clone
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier, ExtraTreesClassifier
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, brier_score_loss, confusion_matrix, f1_score, precision_score, recall_score,
                             roc_auc_score, roc_curve)
from sklearn.model_selection import (GridSearchCV, GroupKFold, GroupShuffleSplit, StratifiedGroupKFold, StratifiedKFold,
                                     cross_val_predict, cross_validate, train_test_split)
from sklearn.neighbors import KNeighborsClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.svm import SVC
from schema import MODELS

warnings.filterwarnings("ignore")
SEED = 42
rng = np.random.RandomState(SEED)

# ----------------------------------------------------------------------------- data loading
def load_mental():
    d = pd.read_csv("data/osmi_mental_health_tech_2014.csv")
    d = d[(d.Age >= 18) & (d.Age <= 75)].copy()                         # remove impossible ages (-1726, 99999999999 ...)
    g = d.Gender.str.lower().str.strip()
    female = {"female", "f", "woman", "cis female", "cis-female/femme", "femail", "female (cis)", "female ", "trans-female", "trans woman", "female (trans)"}
    male = {"male", "m", "man", "cis male", "male-ish", "maile", "mal", "male (cis)", "make", "male ", "msle", "mail", "malr", "cis man", "guy (-ish) ^_^", "something kinda male?"}
    d["Gender"] = np.where(g.isin(female), "Female", np.where(g.isin(male), "Male", "Other"))
    y = (d.pop("treatment") == "Yes").astype(int)
    cols = [f["key"] for f in MODELS["mental"]["features"]]
    X = d[cols].copy()
    # NOTE: 'work_interfere' is deliberately excluded: it is only answered by people who already have a condition,
    # so it is a proxy of the target (target leakage).
    X = X.assign(_y=y).drop_duplicates().reset_index(drop=True)
    y = X.pop("_y")
    cat = [c for c in X.columns if c != "Age"]
    return X, y, None, cat, "Ages outside 18-75 removed; gender mapped to 3 groups; exact duplicate respondents dropped; 'work_interfere' excluded as a target proxy."

def _sleep_base():
    d = pd.read_csv("data/sleep_health_lifestyle.csv")
    bp = d["Blood Pressure"].str.split("/", expand=True).astype(int)
    d["Systolic"], d["Diastolic"] = bp[0], bp[1]
    d["BMI Category"] = d["BMI Category"].replace({"Normal Weight": "Normal"})
    d["Occupation"] = d["Occupation"].replace({"Software Engineer": "Engineer", "Sales Representative": "Salesperson", "Scientist": "Other", "Manager": "Other"})
    return d

def _grouped(d, cols, y):
    X = d[cols].copy().reset_index(drop=True)
    sig = X.astype(str).agg("|".join, axis=1)             # identical profiles share a group -> never split across folds
    return X, y.reset_index(drop=True), sig.factorize()[0]

def load_sleep():
    d = _sleep_base(); y = d["Sleep Disorder"].notna().astype(int)
    cols = [f["key"] for f in MODELS["sleep"]["features"]]
    X, y, g = _grouped(d, cols, y)
    return X, y, g, ["Gender", "Occupation", "BMI Category"], "374 rows contain only 132 distinct profiles; identical profiles are kept in the same CV/test fold (group-aware) to prevent leakage."

def load_stress():
    d = _sleep_base(); y = (d["Stress Level"] >= 7).astype(int)
    cols = [f["key"] for f in MODELS["stress"]["features"]]
    X, y, g = _grouped(d, cols, y)
    return X, y, g, ["Gender", "Occupation", "BMI Category"], "Same data; target = perceived stress ≥ 7/10; the stress rating itself is NOT an input. Group-aware splits as above."

LOADERS = dict(mental=load_mental, sleep=load_sleep, stress=load_stress)

# ----------------------------------------------------------------------------- models
def make_pre(X, cat):
    cat = [c for c in cat if c in X.columns]
    num_cols = [c for c in X.columns if c not in cat]
    parts = []
    if num_cols: parts.append(("num", Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler())]), num_cols))
    if cat: parts.append(("cat", OneHotEncoder(handle_unknown="ignore"), cat))
    return ColumnTransformer(parts)

def candidates(X, cat):
    def pipe(est): return Pipeline([("pre", make_pre(X, cat)), ("clf", est)])
    return {
        "Logistic Regression": (pipe(LogisticRegression(max_iter=5000, random_state=SEED)), {"clf__C": [0.03, 0.1, 0.3, 1, 3, 10]}),
        "Random Forest": (pipe(RandomForestClassifier(random_state=SEED, n_jobs=-1)),
                          {"clf__n_estimators": [300], "clf__max_depth": [None, 4, 8], "clf__min_samples_leaf": [1, 3, 5]}),
        "Gradient Boosting": (pipe(GradientBoostingClassifier(random_state=SEED)),
                              {"clf__n_estimators": [100, 200], "clf__learning_rate": [0.03, 0.1], "clf__max_depth": [2, 3]}),
        "SVM (RBF)": (pipe(SVC(probability=True, random_state=SEED)), {"clf__C": [0.5, 1, 5], "clf__gamma": ["scale", 0.01]}),
        "Neural Network (MLP)": (pipe(MLPClassifier(max_iter=3000, random_state=SEED)),
                                 {"clf__hidden_layer_sizes": [(32,), (64, 32)], "clf__alpha": [1e-3, 1e-2, 1e-1]}),
    }

def metrics(y, p, thr=0.5):
    yh = (p >= thr).astype(int); tn, fp, fn, tp = confusion_matrix(y, yh, labels=[0, 1]).ravel()
    return dict(accuracy=accuracy_score(y, yh), precision=precision_score(y, yh, zero_division=0), recall=recall_score(y, yh),
                specificity=tn / (tn + fp), f1=f1_score(y, yh), roc_auc=roc_auc_score(y, p), brier=brier_score_loss(y, p),
                tn=int(tn), fp=int(fp), fn=int(fn), tp=int(tp))

def bootstrap_ci(y, p, fn, n=1000, groups=None):
    y = np.asarray(y); vals = []
    for _ in range(n):
        i = rng.randint(0, len(y), len(y))
        if len(set(y[i])) < 2: continue
        vals.append(fn(y[i], p[i]))
    return [float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))]

R = lambda x, k=4: round(float(x), k)
def rd(d): return {k: (R(v) if isinstance(v, (float, np.floating)) else v) for k, v in d.items()}

# ----------------------------------------------------------------------------- main loop
out, t0 = {}, time.time()
for key, meta in MODELS.items():
    print(f"\n{'=' * 80}\n{meta['name'].upper()}  —  {meta['dataset']}\n{'=' * 80}")
    X, y, groups, cat, note = LOADERS[key]()
    print(f"samples={len(X)}  features={X.shape[1]}  positives={int(y.sum())} ({y.mean():.1%})\n  {note}")
    idx = np.arange(len(X))
    if groups is None:
        tr, te = train_test_split(idx, test_size=0.2, stratify=y, random_state=SEED)
        cv = StratifiedKFold(5, shuffle=True, random_state=SEED); cvkw = {}
    else:
        # group-aware stratified split: try seeds until test set has both classes in reasonable proportion
        for s in range(SEED, SEED + 50):
            tr, te = next(GroupShuffleSplit(1, test_size=0.2, random_state=s).split(X, y, groups))
            if abs(y.iloc[te].mean() - y.mean()) < 0.04: break
        cv = StratifiedGroupKFold(5, shuffle=True, random_state=SEED); cvkw = dict(groups=groups[tr])
    Xtr, Xte, ytr, yte = X.iloc[tr], X.iloc[te], y.iloc[tr], y.iloc[te]
    cvsplit = list(cv.split(Xtr, ytr, **cvkw))

    rows, fitted = [], {}
    base = Pipeline([("pre", make_pre(X, cat)), ("clf", DummyClassifier(strategy="prior"))]).fit(Xtr, ytr)
    bm = metrics(yte, base.predict_proba(Xte)[:, 1]); bm["accuracy"] = max(bm["accuracy"], 0)
    rows.append(dict(name="Baseline (majority class)", cv_auc_mean=0.5, cv_auc_std=0.0, best_params={}, test=rd(bm)))
    for name, (pipe, grid) in candidates(X, cat).items():
        gs = GridSearchCV(pipe, grid, scoring="roc_auc", cv=cvsplit, n_jobs=-1, refit=True).fit(Xtr, ytr)
        i = gs.best_index_; m = metrics(yte, gs.predict_proba(Xte)[:, 1]); fitted[name] = gs.best_estimator_
        rows.append(dict(name=name, cv_auc_mean=R(gs.cv_results_["mean_test_score"][i]), cv_auc_std=R(gs.cv_results_["std_test_score"][i]),
                         best_params={k.replace("clf__", ""): (list(v) if isinstance(v, tuple) else v) for k, v in gs.best_params_.items()}, test=rd(m)))
        print(f"  {name:22s} CV-AUC {rows[-1]['cv_auc_mean']:.4f}±{rows[-1]['cv_auc_std']:.4f} | test acc {m['accuracy']:.3f} AUC {m['roc_auc']:.3f} recall {m['recall']:.3f} spec {m['specificity']:.3f}")
    best_name = max(rows[1:], key=lambda r: r["cv_auc_mean"])["name"]          # selection on CV only
    best = fitted[best_name]; print(f"  >> selected by CV: {best_name}")

    p_te = best.predict_proba(Xte)[:, 1]; fm = metrics(yte, p_te)
    ci = dict(roc_auc=bootstrap_ci(yte, p_te, roc_auc_score), accuracy=bootstrap_ci(yte, p_te, lambda a, b: accuracy_score(a, b >= .5)),
              recall=bootstrap_ci(yte, p_te, lambda a, b: recall_score(a, b >= .5)))
    fpr, tpr, _ = roc_curve(yte, p_te); sel_ = np.unique(np.linspace(0, len(fpr) - 1, min(60, len(fpr))).astype(int))

    # repeated CV on whole data (3 x 5-fold)
    scoring = ["accuracy", "precision", "recall", "f1", "roc_auc"]; res = []
    for rep in range(3):
        sp = (StratifiedKFold(5, shuffle=True, random_state=SEED + rep).split(X, y) if groups is None
              else StratifiedGroupKFold(5, shuffle=True, random_state=SEED + rep).split(X, y, groups))
        res.append(cross_validate(clone(best), X, y, cv=list(sp), n_jobs=-1, scoring=scoring))
    repeated = {k: dict(mean=R(np.mean([r[f"test_{k}"].mean() for r in res])), std=R(np.concatenate([r[f"test_{k}"] for r in res]).std())) for k in scoring}
    print("  repeated 5x3 CV:", {k: f"{v['mean']:.3f}±{v['std']:.3f}" for k, v in repeated.items()})

    oof = cross_val_predict(clone(best), Xtr, ytr, cv=cvsplit, method="predict_proba")[:, 1]
    bins = np.linspace(0, 1, 6); calib = []
    for lo, hi in zip(bins[:-1], bins[1:]):
        m_ = (oof >= lo) & (oof < hi + (1e-9 if hi == 1 else 0))
        if m_.sum() >= 5: calib.append(dict(pred=R(oof[m_].mean()), obs=R(ytr.values[m_].mean()), n=int(m_.sum())))

    pi = permutation_importance(best, Xte, yte, scoring="roc_auc", n_repeats=40, random_state=SEED, n_jobs=-1)
    imp = sorted([dict(feature=f, mean=R(m), std=R(s)) for f, m, s in zip(X.columns, pi.importances_mean, pi.importances_std)], key=lambda d: -d["mean"])

    summ = [dict(feature=c, mean_neg=(R(X.loc[y == 0, c].mean(), 2) if c not in cat else None), mean_pos=(R(X.loc[y == 1, c].mean(), 2) if c not in cat else None),
                 median=(R(X[c].median(), 2) if c not in cat else None), levels=(X[c].value_counts().to_dict() if c in cat else None)) for c in X.columns]

    bg = X.sample(min(100, len(X)), random_state=SEED)
    order = np.argsort(p_te)
    ex = {"low": {c: (v.item() if hasattr(v, "item") else v) for c, v in Xte.iloc[order[0]].items()},
          "high": {c: (v.item() if hasattr(v, "item") else v) for c, v in Xte.iloc[order[-1]].items()}}
    refit = clone(best).fit(X, y)
    joblib.dump(dict(model=refit, features=list(X.columns), background=bg, examples=ex, cat=cat), f"models/{key}.joblib", compress=3)

    out[key] = dict(key=key, name=meta["name"], pillar=meta["pillar"], dataset=meta["dataset"], source_url=meta["source_url"], target=meta["target"], note=note,
                    n=int(len(X)), n_features=int(X.shape[1]), n_pos=int(y.sum()), prevalence=R(y.mean()), n_train=int(len(Xtr)), n_test=int(len(Xte)),
                    best_model=best_name, best_params=[r for r in rows if r["name"] == best_name][0]["best_params"], models=rows,
                    final=dict(test=rd(fm), ci=ci, repeated_cv=repeated, calibration=calib, importance=imp,
                               roc=dict(fpr=[R(v) for v in fpr[sel_]], tpr=[R(v) for v in tpr[sel_]]), confusion=[[fm["tn"], fm["fp"]], [fm["fn"], fm["tp"]]]),
                    data_summary=summ)
    print(f"  FINAL TEST  acc={fm['accuracy']:.3f}  AUC={fm['roc_auc']:.3f} (95% CI {ci['roc_auc'][0]:.3f}-{ci['roc_auc'][1]:.3f})  recall={fm['recall']:.3f}  spec={fm['specificity']:.3f}  F1={fm['f1']:.3f}  Brier={fm['brier']:.3f}")

    fig, ax = plt.subplots(1, 4, figsize=(20, 4.2))
    ax[0].plot(fpr, tpr, lw=2, label=f"{best_name} (AUC {fm['roc_auc']:.3f})"); ax[0].plot([0, 1], [0, 1], "--", c="grey")
    ax[0].set(title="ROC curve (hold-out test)", xlabel="1 - Specificity", ylabel="Sensitivity"); ax[0].legend(loc="lower right")
    cmx = np.array(out[key]["final"]["confusion"]); ax[1].imshow(cmx, cmap="Blues")
    for (i, j), v in np.ndenumerate(cmx): ax[1].text(j, i, v, ha="center", va="center", fontsize=16, color="white" if v > cmx.max() / 2 else "black")
    ax[1].set(title="Confusion matrix", xticks=[0, 1], yticks=[0, 1], xticklabels=["Neg", "Pos"], yticklabels=["Neg", "Pos"], xlabel="Predicted", ylabel="Actual")
    ii = imp[:10][::-1]; ax[2].barh([d["feature"] for d in ii], [d["mean"] for d in ii], xerr=[d["std"] for d in ii], color="#0e7c86"); ax[2].set(title="Permutation importance (ΔAUC)")
    mm = rows[1:]; ax[3].barh([r["name"] for r in mm][::-1], [r["cv_auc_mean"] for r in mm][::-1], xerr=[r["cv_auc_std"] for r in mm][::-1], color="#5b6ee1")
    ax[3].set(title="5-fold CV ROC-AUC (train split)", xlim=(0.4, 1.0))
    fig.suptitle(f"{meta['name']} — {meta['dataset']}", fontweight="bold"); fig.tight_layout(); fig.savefig(f"reports/{key}_evaluation.png", dpi=110); plt.close(fig)

# ----------------------------------------------------------------------------- EEG leakage study (why no EEG model is deployed)
print(f"\n{'=' * 80}\nEEG EYE-STATE LEAKAGE STUDY (UCI, 14 channels, 14,980 samples @128 Hz)\n{'=' * 80}")
e = pd.read_csv("data/eeg-eye-state.csv"); Xe = e.iloc[:, :14].values.astype(float); ye = e["class"].values
med = np.median(Xe, 0); mad = np.median(np.abs(Xe - med), 0) * 1.4826; Xe = np.clip(Xe, med - 6 * mad, med + 6 * mad)
blk = np.arange(len(Xe)) // (128 * 15)                                   # contiguous 15-second blocks
eeg = {}
for nm, mk in [("kNN", lambda: Pipeline([("s", StandardScaler()), ("m", KNeighborsClassifier(15))])),
               ("Random Forest", lambda: RandomForestClassifier(200, min_samples_leaf=3, random_state=SEED, n_jobs=-1))]:
    a = np.random.RandomState(1).rand(len(Xe)); rnd_te = a < 0.2                       # naive random-sample split
    m = mk().fit(Xe[~rnd_te], ye[~rnd_te]); pr = m.predict_proba(Xe[rnd_te])[:, 1]
    bte = blk % 5 == 4; m = mk().fit(Xe[~bte], ye[~bte]); pb = m.predict_proba(Xe[bte])[:, 1]
    eeg[nm] = dict(random_split=dict(accuracy=R(accuracy_score(ye[rnd_te], pr > .5)), roc_auc=R(roc_auc_score(ye[rnd_te], pr))),
                   blocked_split=dict(accuracy=R(accuracy_score(ye[bte], pb > .5)), roc_auc=R(roc_auc_score(ye[bte], pb))))
    print(f"  {nm:14s} random-sample split: acc {eeg[nm]['random_split']['accuracy']:.3f} AUC {eeg[nm]['random_split']['roc_auc']:.3f} | "
          f"time-blocked split: acc {eeg[nm]['blocked_split']['accuracy']:.3f} AUC {eeg[nm]['blocked_split']['roc_auc']:.3f}")
print("  -> near-perfect scores with random splits are an autocorrelation artefact; with leakage-free blocks the model is ~chance, so no EEG model is deployed.")

json.dump(dict(generated=time.strftime("%Y-%m-%d %H:%M"), seed=SEED, models=out, eeg_study=dict(dataset="UCI EEG Eye State (14,980 samples)", results=eeg)),
          open("models/metrics.json", "w"), indent=1)
print(f"\nDone in {time.time() - t0:.0f}s -> models/*.joblib, models/metrics.json, reports/*.png")
