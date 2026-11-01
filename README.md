# NeuroErgo Health — AI workplace health platform

Healthcare web app based on the paper *NeuroErgoML* (physical + cognitive + environmental workplace ergonomics).
**All predictions come from models we train ourselves** (scikit-learn) on real healthcare datasets — no ChatGPT/Gemini/OpenAI/Hugging Face API anywhere.

## Run
```
pip install -r requirements.txt
python train.py      # ~2 min: trains, evaluates, writes models/ and reports/
python app.py        # open http://127.0.0.1:5000
```
(Trained models and reports are already included, so `python app.py` works immediately.)

## Trained models (see reports/training_log.txt, models/metrics.json, Model Lab tab)
| Model | Dataset | Selected | Test acc | Test ROC-AUC | Repeated 5x3 CV AUC |
|---|---|---|---|---|---|
| Sleep-disorder risk | Sleep Health & Lifestyle (132 unique profiles) | Logistic Regression | 92.1% | 0.968 | 0.934 ± 0.036 |
| High-stress indicator | same dataset | SVM (RBF) | 100% (small, synthetic-style data: optimistic) | 1.000 | 0.999 ± 0.003 |
| Mental well-being support need | OSMI Mental Health in Tech survey (1,246 workers) | SVM (RBF) | 71.2% | 0.786 | 0.779 ± 0.016 |

Protocol: cleaning, duplicate/leakage control (group-aware folds), 5 model families + baseline tuned by 5-fold CV on the train split, selection by CV only, single hold-out test, bootstrap CIs, calibration, permutation importance, per-prediction explanations.
An EEG eye-state study (UCI) shows that near-perfect random-split scores collapse to chance with time-blocked splits, so no EEG model is deployed.

## Tabs
Dashboard (Wellness Index) · Sleep & Stress Risk · Mental Well-being · Live Environment (Open-Meteo weather/AQI, OpenStreetMap hospitals) · Wellness Coach (break timer, exercises, ergonomics check, coach) · Health Tools (BMI, BP) · Model Lab · My History (trend, CSV, print) · About.

## Honest limitations
Not a medical device. The Wellness Index, comfort score, ergonomics checklist and coach are transparent rule-based components. CNN-LSTM-Transformer, deep RL and federated learning from the paper are future work.

## Files
`train.py` training · `schema.py` features · `app.py` Flask API · `templates/`, `static/` UI · `data/` datasets · `models/` trained models + metrics · `reports/` figures + log
