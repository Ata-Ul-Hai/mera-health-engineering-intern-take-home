# DECISIONS.md

## 1. Terms Defined from the Request

### "System / Reference Date (2026-10-01)"
The hospital export does not specify an evaluation timestamp. We established **October 1, 2026 (`2026-10-01`)** as the system baseline based on chronological evidence:
- The latest recorded visit in `visits.csv` occurred on `2026-09-29`.
- The latest prescription in `prescriptions.csv` was dispensed on `2026-09-29`.
- The request email from Meenakshi was received in early October 2026.
Choosing `2026-10-01` accurately represents the hospital's snapshot date when the data was extracted.

### "Diabetic"
The email asks for "diabetic patients". We defined a diabetic patient through four clinical criteria:
1. **Diabetology Department**: Any patient who attended the Diabetology specialty.
2. **Antidiabetic Medications**: Any patient prescribed insulin (Glargine, Aspart, Degludec, Lispro, Mixtard) or oral hypoglycemic agents (Metformin, Glimepiride, Gliclazide, Sitagliptin, Vildagliptin, Dapagliflozin).
3. **Clinical Notes (Negation-Filtered)**: Documented diagnosis of Type 1, Type 2, or gestational diabetes (e.g., `T2DM`, `type 2 diabetes`, `k/c/o DM`, `known diabetic`) across any department.
4. **Lab Findings**: Patients with lab tests in the diabetic range (HbA1c ≥ 6.5%, FBS ≥ 126 mg/dL) who lack clinic notes or prescriptions are categorized as *Diabetic (Lab Findings)*, but flagged with a mandatory warning badge requiring clinician verification before calling.
*Why*: Excluding non-diabetology notes would miss 36 diabetic patients managed in General Medicine or other departments. Conversely, naive keyword searching falsely identifies patients whose notes state *"Denies diabetes"* or *"Father diabetic"*.

### "Overdue for Follow-Up"
Evaluated strictly against the patient's **active baseline** (superseding older missed dates if the patient returned on a later date):
* **Tier 1 (Explicit Appointment)**: If a `next_appointment` was scheduled and the date has passed with no subsequent visit, the patient is overdue.
* **Tier 2 (Doctor Review Interval in Notes)**: If no appointment date was booked, but the doctor wrote a review timeframe (e.g., *"review 6 wks"*, *"r/v 3/12"* = 90 days, *"review after 3 months"*), that calculated target date determines overdue status.
* **Tier 3 (Clinical Fallback)**: If neither an appointment nor a review timeframe was recorded, standard diabetes guidelines recommend evaluation every 3 to 6 months. We set a threshold of $> 4$ months (120 days) since the last visit without follow-up.

### "Priority Ordering"
To optimize front-desk calling queues, overdue patients are indexed in priority order:
- **🔴 High Priority (25 patients)**: Overdue patients with acute clinical vulnerability:
  1. Prescribed **Insulin** (Inj. Insulin Glargine, Aspart, Degludec, Lispro, Mixtard) — lapse in insulin therapy carries immediate risk of severe hyperglycemia or diabetic ketoacidosis (DKA).
  2. Laboratory **HbA1c ≥ 9.0%** or blood sugar ≥ 250 mg/dL.
  3. Physician notes documenting uncontrolled glycemic status (*"sugars running high"*, *"sugars not under control"*, *"c/o burning soles"*).
  *Indexed first, sorted by days overdue descending.*
- **🟡 Medium Priority (33 patients)**: Overdue patients on standard oral medications (Metformin, Glimepiride) without severe hyperglycemia or acute notes, sorted by days overdue descending.
- **🟢 Due Soon (5 patients)**: Scheduled appointment or note review target within the next 14 days, or approaching 4 months since last contact, sorted by days remaining ascending.

### "Dedicated Flagged Review List & Segmentation"
Putting flagged patients directly into an unsegmented calling queue risks front-desk staff calling unaware of critical clinical or administrative caveats. To eliminate this risk:
1. **Dedicated Tab (`Flagged for Review`)**: Surfaces all 55 diabetic patients who carry warning flags, filterable by specific flag types: Duplicate Registrations (8), Missing Phone Numbers (8), Shared Family Phones (9), Subsequent Non-Diabetic Visits (36), and Lab-Only Diagnoses (11).
2. **Overdue Sub-Filter (`Ready to Call` vs `Flagged`)**: In the Overdue tab, front desk staff can filter directly between **Ready to Call (25 clean patients)** and **Flagged for Review (33 patients)** with a single click.
3. **Dedicated CSV Export (`export/flagged_patients_review.csv`)**: Generated alongside `overdue_diabetic_patients.csv` and `due_soon_diabetic_patients.csv` to allow medical records and senior staff to audit and resolve flagged cases offline.

### "Front Desk Call Outcomes (Dispositions)"
To support front-desk workflow, every call is tracked with five mutually exclusive operational states:
1. `To Call (Pending)`: Default queue state; patient has not yet been dialed.
2. `Booked / Rescheduled`: Patient reached; follow-up appointment successfully agreed and scheduled.
3. `Voicemail / Left Msg`: Call attempted; voicemail left or message taken by an adult household member.
4. `Callback Requested`: Patient reached but requested a return call at a specific later time.
5. `Wrong / Inactive`: Number invalid, disconnected, or wrong person; automatically flags the chart for medical records to verify contact details.

### "Complete Bucket Partition (Exactly 300 Patients)"
Every patient belongs to exactly one mutually exclusive bucket whose sum equals the total 300 patients:
- 📞 **Overdue Call List**: **58** (Target date passed without follow-up; active call list)
- ⏳ **Due Soon Reminder List**: **5** (Target date in next 14 days; preventive reminder calls)
- 🩺 **On Track / Up to Date**: **37** (Diabetic patients seen recently or appointment scheduled in future)
- 🔍 **Clinical Review Queue**: **3** (Borderline prediabetes HbA1c 5.7–6.4% needing lifestyle counseling)
- ⛔ **Excluded Guardrails**: **197** (3 Deceased, 3 Transferred Care, 191 Confirmed Non-Diabetic Screenings)
**Total: $58 + 5 + 37 + 3 + 197 = 300$ patients.**

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

To prevent front-desk staff from making uninformed calls, five categories of patients are flagged for human review and isolated into both a dedicated UI list and a specialized export (`export/flagged_patients_review.csv`):

1. **Abnormal Lab-Only Diagnoses (11 patients)**: Patients with elevated diabetic lab results (e.g. HbA1c ≥ 6.5%, FBS ≥ 126 mg/dL) without an in-system diabetes clinic note or prescription. Classified as diabetic based on clinical test results, but flagged with `[Lab Diagnosis Only - Clinician verification recommended before call]` so staff confirm clinical diagnosis with an attending doctor prior to outreach.
2. **Borderline Prediabetes (3 patients)**: Patients with HbA1c between 5.7% and 6.4% are held in the separate Clinical Review queue for preventative lifestyle counseling rather than active diabetic recall.
3. **Subsequent Non-Diabetic Department Visits (36 patients)**: When a diabetic patient visited another specialty (e.g. Dental, ENT, Orthopaedics) after missing a diabetes milestone, we flagged: `[Recent Non-Diabetic Visit: {Dept} on {Date} — Verify if diabetes was reviewed]`. This alerts staff that the patient was physically seen on campus and may have had their diabetes addressed or medication refilled informally.
4. **Duplicate Registrations (8 patients / 4 pairs)**: Identified pairs with identical demographics (DOB, sex, phone) and matching names (e.g. Joseph Dsouza / Joseph D'Souza, Md. Rafiq / Mohammed Rafiq). Cross-linked with clear alerts to ensure the patient is not contacted twice under different MRNs and to prompt formal EMR chart merging.
5. **Missing & Shared Phone Numbers (17 patients)**: 8 patients lack any registered contact number (requiring postal address lookup), and 9 share phone numbers across family members (requiring staff to verify identity before discussing sensitive health matters).

---

## 4. What This Result Cannot Be Trusted For

1. **External Care**: Does not reflect diabetes care, lab tests, or prescriptions received at external clinics, private practitioners, or other hospitals.
2. **Informal Interactions**: Does not capture phone consultations, WhatsApp messages, or informal hallway conversations with doctors that were not entered into `visits.csv`.
3. **Atypical Doctor Shorthand**: If a doctor wrote a follow-up interval in an unstandardized format not caught by the parser, the patient falls back to the 4-month rule rather than their specific custom date.
4. **Diagnostic Authority**: Triage lists are administrative aids for front-desk scheduling and cannot substitute for an attending physician's clinical judgment.
