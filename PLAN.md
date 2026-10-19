# PLAN.md

## 1. Problem Breakdown & Goal
The objective is to provide an accurate, operationally safe tool for Meenakshi and the hospital front desk to identify diabetic patients who need follow-up. A wrong name on a call list represents an actual phone call to a patient or family; therefore, accuracy, clinical safety, and transparency take precedence over simplistic assumptions.

We decompose the request into two core definitions and two distinct workflows:
1. **Diabetic Identification**:
   - **Clinically confirmed**: Diabetology department visits, positive clinic notes across all departments (with strict negation and family-history handling), or active antidiabetic prescriptions (Metformin, Glimepiride, Insulins, etc.).
   - **Lab-only candidates**:
     - *Normal screening labs* (e.g., HbA1c < 5.7%, normal FBS): Excluded as Non-Diabetic.
     - *Abnormal / diabetic-range labs* (HbA1c $\ge$ 6.5%, FBS $\ge$ 126 mg/dL / 7.0 mmol/L): Classified as diabetic via lab findings, but flagged with a prominent warning: `[Lab Diagnosis Only - Clinician verification recommended before call]`.
     - *Borderline / Prediabetes* (HbA1c 5.7–6.4%): Placed under Clinical Review.
2. **Follow-Up Categorization (Completely Separate Lists & Exports)**:
   - **Overdue Call List**: Diabetic patients whose active follow-up target date has already passed without a subsequent visit. Has its own dedicated view and its own CSV export (`overdue_diabetic_patients.csv`).
   - **Due Soon Reminder List**: Diabetic patients whose upcoming appointment or review interval falls within the next 14 days, or who are approaching 4 months since last contact. Handled as a distinct preventive reminder list with its own dedicated CSV export (`due_soon_diabetic_patients.csv`).

## 2. What We Need to Investigate & Resolve in the Data
- **Negation & False Positives**: Clinic notes contain phrases like *"Denies diabetes"*, *"no h/o diabetes"*, *"Non-diabetic"*, and *"Father diabetic... Urine sugar nil"*. We must use negation-aware extraction rather than simple keyword matching.
- **Symptom Duration vs. Doctor Review Intervals**: Notes frequently contain durations for symptoms or history (*"x 2 months"*, *"x 3 wks"*, *"since 2012"*) alongside review instructions (*"review 3 wks"*, *"r/v 3/12"*). The parser must strictly anchor to `review` and `r/v` keywords to extract the doctor's follow-up instruction.
- **Superseded Follow-Ups (Late Returns)**: When an appointment was missed historically but the patient returned on a later date, that historical miss is superseded. Overdue status must be calculated solely from the patient's active/latest clinical interaction.
- **Flag Non-Diabetic Department Visits**: If a diabetic patient visited an unrelated department (e.g., ENT, Dental, Orthopaedics) after their diabetes check/target date, flag for human review: `[Recent Non-Diabetic Visit: {Dept} on {Date} — Verify if diabetes was reviewed]`.
- **Safety Exclusions (Do Not Call)**: Identify deceased patients (*"pt expired"*, *"file closed"*) and transferred-care/relocated patients to prevent traumatic or inappropriate calls.
- **Contact & Registration Integrity**: Highlight missing phone numbers, shared family phones, and duplicate patient registrations (e.g., Joseph Dsouza / Joseph D'Souza) with visible warning badges without destructive data merges.
- **Concise Reason Box**: Keep the trigger explanation punchy and compact using meaningful structured tokens (e.g., `Missed Appt (21d overdue) | Target: 2026-09-15` or `Note: Review 6 wks (45d overdue)` or `No Review Date (>4 mo gap) | Last visit: 145d ago`).

## 3. Implementation Pipeline & Technology Stack
- **Data Engine (Python + pandas)**:
  - Ingests `patients.csv`, `visits.csv`, `lab_results.csv`, `prescriptions.csv`.
  - Runs classification, tiered overdue evaluation, safety filtering, and reason generation.
  - Outputs enriched structured data for the application and standalone CSVs (`overdue_diabetic_patients.csv`, `due_soon_diabetic_patients.csv`).
- **Frontend UI (React + Vite)**:
  - Clean, front-desk-focused interface with tabbed separation:
    - 📞 **Overdue Call List** (with independent CSV export)
    - ⏳ **Due Soon Reminder List** (with independent CSV export)
    - 🔍 **Clinical Review Needed** (lab-only & ambiguous cases)
    - ⛔ **Excluded / Do Not Call** (deceased, transferred, non-diabetic)
  - Features: Priority filtering (High/Medium/Due Soon), instant search (Name/MRN/Phone), sortable columns, and expandable clinical timeline.
  - Single-command execution script (`./run.sh`).

## 4. What We Are Unsure About (Assumptions to Document)
- **Reference Baseline Date**: Data visits end on `2026-09-29`. We assume an evaluation date of `2026-10-01` (date of export) as default, but provide an interactive date selector.
- **Clinician Protocol for Lab-Only Diagnoses**: Whether hospital protocol permits front desk staff to initiate calls for patients diagnosed purely through automated lab triggers before an attending doctor formally documents the diagnosis in OPD notes.
