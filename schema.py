"""Feature schemas shared by training (train.py) and the web app (app.py)."""

def num(key, label, unit, lo, hi, step, default, help, group):
    return dict(key=key, label=label, type="number", unit=unit, min=lo, max=hi, step=step, default=default, help=help, group=group)

def sel(key, label, options, default, help, group):
    opts = [dict(value=o, label=o) if isinstance(o, str) else dict(value=o[0], label=o[1]) for o in options]
    return dict(key=key, label=label, type="select", options=opts, default=default, help=help, group=group)

YN3 = ["Yes", "No", "Don't know"]

# ------------------------------------------------------------------ Cognitive / mental well-being (OSMI survey)
MENTAL = [
    num("Age", "Age", "years", 18, 75, 1, 30, "Your age in years.", "About you"),
    sel("Gender", "Gender", ["Male", "Female", "Other"], "Male", "Gender as reported in the survey (3 groups).", "About you"),
    sel("family_history", "Family history of mental illness", ["No", "Yes"], "No", "Has a close relative had a mental-health condition?", "About you"),
    sel("remote_work", "Work remotely ≥ 50% of the time", ["No", "Yes"], "No", "Remote / hybrid work pattern.", "Work setting"),
    sel("tech_company", "Employer is a tech company", ["Yes", "No"], "Yes", "Primary employer is a technology company.", "Work setting"),
    sel("no_employees", "Company size", ["1-5", "6-25", "26-100", "100-500", "500-1000", "More than 1000"], "26-100", "Number of employees in your organisation.", "Work setting"),
    sel("benefits", "Employer provides mental-health benefits", YN3, "Don't know", "Is mental-health cover part of your benefits?", "Workplace support"),
    sel("care_options", "Knows care options offered by employer", ["Yes", "No", "Not sure"], "Not sure", "Do you know what mental-health care options your employer offers?", "Workplace support"),
    sel("wellness_program", "Employer wellness programme", YN3, "No", "Has your employer discussed mental health in a wellness programme?", "Workplace support"),
    sel("seek_help", "Employer offers resources to seek help", YN3, "No", "Learning / help-seeking resources provided by employer.", "Workplace support"),
    sel("anonymity", "Anonymity protected when using resources", YN3, "Don't know", "Is anonymity protected if you use treatment resources?", "Workplace support"),
    sel("leave", "Ease of taking mental-health leave", ["Very easy", "Somewhat easy", "Somewhat difficult", "Very difficult", "Don't know"], "Don't know", "How easy is it to take medical leave for mental health?", "Workplace support"),
    sel("mental_health_consequence", "Discussing mental health would have negative consequences", ["No", "Maybe", "Yes"], "Maybe", "Expected consequences of raising a mental-health issue with your employer.", "Workplace culture"),
    sel("coworkers", "Willing to discuss with coworkers", ["Yes", "Some of them", "No"], "Some of them", "Would you discuss a mental-health issue with coworkers?", "Workplace culture"),
    sel("supervisor", "Willing to discuss with supervisor", ["Yes", "Some of them", "No"], "Some of them", "Would you discuss a mental-health issue with your supervisor?", "Workplace culture"),
]

# ------------------------------------------------------------------ Physical / lifestyle (Sleep Health & Lifestyle)
OCC = ["Accountant", "Doctor", "Engineer", "Lawyer", "Nurse", "Salesperson", "Teacher", "Other"]
LIFESTYLE_COMMON = [
    num("Age", "Age", "years", 18, 80, 1, 35, "Your age in years.", "About you"),
    sel("Gender", "Gender", ["Male", "Female"], "Male", "Biological sex used in the study.", "About you"),
    sel("Occupation", "Occupation", OCC, "Engineer", "Closest matching occupation.", "About you"),
    num("Sleep Duration", "Sleep duration", "hours/night", 4, 10, 0.1, 7, "Average nightly sleep.", "Sleep & activity"),
    num("Quality of Sleep", "Sleep quality", "1–10", 1, 10, 1, 7, "Self-rated quality of sleep (10 = excellent).", "Sleep & activity"),
    num("Physical Activity Level", "Physical activity", "min/day", 0, 120, 5, 45, "Minutes of physical activity per day.", "Sleep & activity"),
    num("Daily Steps", "Daily steps", "steps", 1000, 15000, 100, 6000, "Average steps per day (phone or watch).", "Sleep & activity"),
    sel("BMI Category", "BMI category", ["Normal", "Overweight", "Obese"], "Normal", "Use the BMI calculator in Health Tools if unsure.", "Body & vitals"),
    num("Systolic", "Systolic blood pressure", "mm Hg", 90, 180, 1, 125, "Top number of your blood pressure.", "Body & vitals"),
    num("Diastolic", "Diastolic blood pressure", "mm Hg", 55, 120, 1, 80, "Bottom number of your blood pressure.", "Body & vitals"),
    num("Heart Rate", "Resting heart rate", "bpm", 50, 100, 1, 72, "Resting pulse.", "Body & vitals"),
]
STRESS_FIELD = num("Stress Level", "Perceived stress", "1–10", 1, 10, 1, 5, "Self-rated daily stress (10 = extreme).", "Sleep & activity")
SLEEP = LIFESTYLE_COMMON[:7] + [STRESS_FIELD] + LIFESTYLE_COMMON[7:]
STRESS = LIFESTYLE_COMMON

MODELS = {
    "mental": dict(key="mental", name="Mental Well-being Support Need", pillar="Cognitive", features=MENTAL,
        tagline="Workplace mental-health support-need indicator",
        dataset="OSMI Mental Health in Tech Survey 2014 (1,259 workers, 15 features)",
        source_url="https://www.kaggle.com/datasets/osmi/mental-health-in-tech-survey",
        target="Has sought mental-health treatment", positive="Higher support need", negative="Lower support need"),
    "sleep": dict(key="sleep", name="Sleep-Disorder Risk", pillar="Physical", features=SLEEP,
        tagline="Insomnia / sleep-apnoea risk from habits and vitals",
        dataset="Sleep Health & Lifestyle Dataset (374 records, 132 unique profiles, 12 features)",
        source_url="https://www.kaggle.com/datasets/uom190346a/sleep-health-and-lifestyle-dataset",
        target="Sleep disorder (insomnia or apnoea) present", positive="Elevated risk", negative="Lower risk"),
    "stress": dict(key="stress", name="High-Stress Indicator", pillar="Cognitive", features=STRESS,
        tagline="High perceived stress predicted from habits and vitals (no self-rating needed)",
        dataset="Sleep Health & Lifestyle Dataset (374 records, 132 unique profiles, 11 features)",
        source_url="https://www.kaggle.com/datasets/uom190346a/sleep-health-and-lifestyle-dataset",
        target="Perceived stress ≥ 7 / 10", positive="High stress likely", negative="Stress manageable"),
}
