# DECISIONS.md

## 1. Terms Defined from the Request

### "Diabetic"
The email simply asks for "diabetic patients". In healthcare data, diabetes cannot be identified through naive keyword matching without causing significant errors. We defined a diabetic patient as anyone meeting at least one of these clinical criteria:
1. **Diabetology Department**: Any patient who attended the Diabetology specialty.
2. **Antidiabetic Medications**: Any patient prescribed insulin (Glargine, Aspart, Degludec, Lispro, Mixtard) or oral hypoglycemic agents (Metformin, Glimepiride, Gliclazide, Sitagliptin, Vildagliptin, Dapagliflozin).
3. **Clinical Notes (Negation-Filtered)**: Documented diagnosis of Type 1, Type 2, or gestational diabetes (e.g., `T2DM`, `type 2 diabetes`, `k/c/o DM`, `known diabetic`) across any department.
4. **Lab Findings**: Patients with lab tests in the diabetic range (HbA1c $\ge 6.5\%$, FBS $\ge 126$ mg/dL) who lack clinic notes or prescriptions are categorized as *Diabetic (Lab Findings)*, but flagged with a mandatory warning badge requiring clinician verification before calling.
*Why*: Excluding non-diabetology notes would miss 36 diabetic patients managed in General Medicine or other departments. Conversely, naive keyword searching falsely identifies patients whose notes state *"Denies diabetes"* or *"Father diabetic"*.

### "Overdue for Follow-Up"
The hospital export does not contain an explicit "overdue" column. We established a 3-tier hierarchy evaluated strictly against the patient's **active baseline** (superseding older missed dates if the patient returned on a later date):
* **Tier 1 (Explicit Appointment)**: If a `next_appointment` was scheduled and the date has passed with no subsequent visit, the patient is overdue.
* **Tier 2 (Doctor Review Interval in Notes)**: If no appointment date was booked, but the doctor wrote a review timeframe (e.g., *"review 6 wks"*, *"r/v 3/12"* = 90 days, *"review after 3 months"*), that calculated target date determines overdue status.
* **Tier 3 (Clinical Fallback)**: If neither an appointment nor a review timeframe was recorded, standard diabetes guidelines recommend evaluation every 3 to 6 months. We set a threshold of $> 4$ months (120 days) since the last visit without follow-up.

### "Due Soon" (Completely Separate Workflow)
Maintained as a separate list and distinct CSV export (`due_soon_diabetic_patients.csv`). It captures patients whose appointment or review target is approaching within the next 14 days, or who are between 3.5 and 4 months since last contact. Calling them acts as a preventive reminder rather than an overdue recall.

---

## 2. Problems Found in the Data & Actions Taken

1. **Negation & False Positives in Notes**:
   - *Problem*: 5 patients had diabetes words in negative contexts (e.g., `SVH028557` *"Denies diabetes"*, `SVH026328` *"Non-diabetic"*, `SVH030471` *"no h/o diabetes"*, `SVH025407` *"No h/o diabetes"*, `SVH030117` *"Father diabetic... Urine sugar nil"*). Naive search would falsely label them diabetic.
   - *Action*: Built a negation-aware regex filter. All 5 are correctly classified as non-diabetic and excluded.
2. **Symptom Duration Confused with Review Intervals**:
   - *Problem*: 65 notes contained symptom durations (e.g., *"redness both eyes x 2 months"*, *"x 3 wks"*, *"since 2012"*) alongside doctor review instructions (*"review 3 wks"*). Naive time extractors extract the symptom duration instead of the follow-up.
   - *Action*: Anchored the regex parser strictly to `\b(?:review|r/v)\s*(?:in|after)?`, ignoring symptom and disease history durations.
3. **Deceased Patients**:
   - *Problem*: 3 patients died (`SVH025339` expired at home; `SVH026086` expired in ICU; `SVH025698` expired in Emergency). Calling their families would cause severe trauma.
   - *Action*: Built an automated safety filter that routes all deceased patients to an audited "Do Not Call" list with full event summaries.
4. **Transferred Care / Relocated Patients**:
   - *Problem*: 3 patients officially transferred care to other facilities (`SVH024860` moved to Hyderabad; `SVH025512` transferred near native place; `SVH028346` relocated to Pune).
   - *Action*: Excluded from call lists with documented destination notes.
5. **Duplicate Registrations**:
   - *Problem*: 4 duplicate pairs were identified with identical DOB, sex, phone, and slight name variations (`Joseph Dsouza` / `Joseph D'Souza`, `Md. Rafiq` / `Mohammed Rafiq`, `Padmavathi Reddy` / `Padma Reddy`, `Shivakumar` / `Shivakumar H M`).
   - *Action*: Maintained both records without destructive merging, but added visible cross-linking badges alerting staff to avoid calling the patient twice.
6. **Missing & Shared Phone Numbers**:
   - *Problem*: 8 patients had no phone numbers; 3 phone numbers were shared across family members.
   - *Action*: Flagged with prominent badges (`[Missing Phone]`, `[Shared Family Phone]`) to prompt staff to verify identity before speaking.
7. **Superseded Follow-Ups (Late Returns)**:
   - *Problem*: 145 instances existed where a historical appointment was missed, but the patient visited on a subsequent date.
   - *Action*: Follow-up obligations are evaluated only from the latest active baseline, preventing false alarms.

---

## 3. Where We Flagged for Human / Clinical Review

1. **Abnormal Lab-Only Diagnoses**: 5 patients had elevated diabetic lab results (e.g. HbA1c $\ge 6.5\%$) without a prior clinic note or prescription. We classified them as diabetic via lab findings, but flagged them with: `[Lab Diagnosis Only - Clinician verification recommended before call]` so the front desk does not call cold without physician confirmation.
2. **Borderline Prediabetes**: Patients with HbA1c between 5.7% and 6.4% were placed into the Clinical Review queue for lifestyle counseling rather than active diabetic recall.
3. **Subsequent Non-Diabetic Department Visits**: When a diabetic patient visited another specialty (e.g. Dental, ENT, Orthopaedics) after missing a diabetes milestone, we flagged: `[Recent Non-Diabetic Visit: {Dept} on {Date} — Verify if diabetes was reviewed]`.
4. **Duplicate Records**: Flagged for medical records staff to verify and merge formally in the hospital EMR.

---

## 4. What This Result Cannot Be Trusted For

1. **External Care**: Does not reflect diabetes care, lab tests, or prescriptions received at external clinics, private practitioners, or other hospitals.
2. **Informal Interactions**: Does not capture phone consultations, WhatsApp messages, or informal hallway conversations with doctors that were not entered into `visits.csv`.
3. **Atypical Doctor Shorthand**: If a doctor wrote a follow-up interval in an unstandardized format not caught by the parser, the patient falls back to the 4-month rule rather than their specific custom date.
4. **Diagnostic Authority**: Triage lists are administrative aids for front-desk scheduling and cannot substitute for an attending physician's clinical judgment.
