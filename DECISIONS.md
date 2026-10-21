# DECISIONS.md

## 1. Terms Defined from the Request

### "System / Reference Date (2026-10-01)"
Established as **October 1, 2026 (`2026-10-01`)** based on data chronology:
- Latest visit in `visits.csv`: `2026-09-29`.
- Latest prescription in `prescriptions.csv`: `2026-09-29`.
- Meenakshi's operations request: early October 2026.
All follow-up metrics (days overdue/remaining) are evaluated relative to this static snapshot.

### "Diabetic Patient"
Defined using four clinical criteria:
1. **Diabetology Specialty**: Any attendance in Diabetology.
2. **Antidiabetic Medications**: Prescriptions for insulin (Glargine, Aspart, Degludec, Lispro, Mixtard) or oral agents (Metformin, Glimepiride, Gliclazide, Sitagliptin, Vildagliptin, Dapagliflozin).
3. **Clinical Notes (Negation-Filtered)**: Documented Type 1, Type 2, gestational, or juvenile diabetes (`T2DM`, `type 2 DM`, `Type 2 diabetes`, `k/c/o DM`, `known diabetic`) across all departments, filtered against negations (*"denies diabetes"*, *"non-diabetic"*, *"no h/o diabetes"*, *"father diabetic"*, *"family history of diabetes"*, *"pre-diabetic"*, *"urine sugar nil"*).
4. **Laboratory Findings**: Diabetic-range tests (HbA1c $\ge 6.5\%$ or $\ge 48$ mmol/mol; FBS $\ge 126$ mg/dL or $\ge 7.0$ mmol/L; PPBS $\ge 200$ mg/dL or $\ge 11.1$ mmol/L). Abnormal labs without clinical documentation or prescriptions are routed to verification.

### "Overdue for Follow-Up"
Evaluated strictly from the patient's **latest diabetes-specific activity** (Diabetology visit, antidiabetic prescription, or glycemic review notes). Unrelated specialty visits (Dental, ENT, Orthopaedics) do not reset diabetic follow-up:
* **Tier 1 (Explicit Appointment)**: If `next_appointment` at a diabetes visit passed without subsequent diabetes care, the patient is overdue.
* **Tier 2 (Review Interval in Notes)**: If no appointment was booked, but the doctor specified a review interval (e.g., *"review 6 wks"*, *"r/v 3/12"* = 90 days), that target date determines overdue status.
* **Tier 3 (Clinical 4-Month Fallback)**: If neither was recorded, clinical guidelines recommend follow-up within 4 months (120 days). Overdue if $> 120$ days elapse without follow-up.

### "Priority Ordering"
Overdue patients are indexed in priority order for front-desk calling:
- **🔴 High Priority (24 patients)**: Acute clinical vulnerability:
  1. Prescribed **Insulin** (lapse risks rapid hyperglycemia or DKA).
  2. Laboratory **HbA1c $\ge 9.0\%$** (or $\ge 75$ mmol/mol) or blood sugar $\ge 250$ mg/dL (or $\ge 13.9$ mmol/L).
  3. Notes documenting acute glycemic instability (*"sugars running high"*, *"burning soles"*, *"DKA"*).
  *Indexed first, sorted by days overdue descending.*
- **🟡 Medium Priority (19 patients)**: Overdue patients on oral therapies without acute hyperglycemia, sorted by days overdue descending.
- **🟢 Due Soon (5 patients)**: Target date within the next 14 days or approaching 4 months, sorted by days remaining ascending.

### "Front Desk Call Outcomes (Dispositions)"
Calls are tracked across five operational states:
1. `To Call (Pending)`: Uncontacted in queue.
2. `Booked / Rescheduled`: Patient reached; appointment confirmed.
3. `Voicemail / Left Msg`: Reached voicemail or message left with family.
4. `Callback Requested`: Patient requested a callback later.
5. `Wrong / Inactive`: Number unreachable or invalid; flagged for EMR audit.

### "Mutually Exclusive 300-Patient Partition"
Every patient belongs to exactly one partition:
- 📞 **Overdue Call List**: **43** (Clean, confirmed diabetic patients: 24 High + 19 Medium Priority)
- ⏳ **Due Soon Reminder List**: **5** (Upcoming appointments within 14 days; preventive outreach)
- ⚠️ **Flagged for Verification**: **24** (8 duplicate profiles, 9 lab-only findings, 4 borderline prediabetes, 3 resolved postpartum GDM)
- 🩺 **On Track / Up to Date**: **32** (Diabetic patients seen recently or scheduled in future)
- ⛔ **Excluded Guardrails**: **196** (3 Deceased, 3 Transferred Care, 190 Confirmed Non-Diabetic)
**Total: $43 + 5 + 24 + 32 + 196 = 300$ patients.**

---

## 2. Problems Found in the Data & Actions Taken

1. **Negation & Family History**: Patients had diabetes keywords in negative or familial contexts (`SVH028557` *"Denies diabetes"*, `SVH026328` *"Non-diabetic"*, `SVH030117` *"Father diabetic... Urine sugar nil"*, `SVH026131` *"family history of diabetes (both parents)"*). Excluded via expanded negation regex before positive matching.
2. **"Pre-diabetic" Word-Boundary Match**: `\bdiabetic\b` previously matched `pre-diabetic` due to the hyphen word boundary (`SVH025926` Shaheen Sait). Added `pre[-\s]?diabetic` and `borderline diabetic` to `NEGATION_PATTERNS`. Prediabetic counseling with borderline HbA1c (6.1%) was rerouted from Overdue to Flagged for Verification under Borderline Prediabetes.
3. **Symptom Durations vs Review Intervals**: 65 notes contained symptom durations (*"pain x 2 months"*) alongside review instructions (*"review 3 wks"*). Regex was anchored to `\b(?:review|r/v)\s*(?:in|after)?` to extract true review intervals.
4. **Multi-Unit Lab Values**: Handled dual units for glucose (mg/dL vs mmol/L) and HbA1c (% vs mmol/mol). Recognized variations including `Glucose (F)`, `Glucose (PP)`, and `Post Prandial Glucose` (mmol/L threshold $\ge 11.1$).
5. **Future-Dated Lab Records**: Identified two future collection dates (`SVH027355` FBS on `19/12/2026`, `SVH030138` HbA1c on `27/02/2027`). Flagged with data integrity alerts and excluded from chronology baselines.
6. **Unrelated Specialty Visits**: Patients visited Dental, ENT, or Dermatology after missing diabetes follow-ups. Follow-up baselines are anchored strictly to diabetes care; non-diabetic visits do not reset diabetic recall.
7. **Duplicate Registrations**: Identified 4 duplicate pairs (8 MRNs: `SVH027863`/`SVH029322`, `SVH025473`/`SVH029873`, `SVH027082`/`SVH030772`, `SVH027925`/`SVH029107`) sharing phone, DOB, and sex. Isolated into the verification queue to prevent double-calling.
8. **Shared Family Phones**: 9 MRNs share phone numbers across family members. Retained in active calling lists with visible badges (`[Shared Family Phone]`).
9. **Deceased & Transferred Patients**: 3 patients expired (`SVH025339`, `SVH026086`, `SVH025698`) and 3 transferred care (`SVH024860`, `SVH025512`, `SVH028346`). Safely routed to Excluded guardrails.

---

## 3. Where We Flagged for Human / Clinical Review

To prevent uninformed front-desk outreach, 24 patients are isolated in **Flagged for Verification** (`export/flagged_verification_patients.csv`):
1. **Duplicate Registrations (8 patients)**: Flagged for medical records to merge profiles before outreach.
2. **Unconfirmed Lab-Only Findings (9 patients)**: Elevated labs without clinic diagnosis or medication. Flagged for clinician review before outreach.
3. **Borderline Prediabetes (4 patients)**: HbA1c 5.7–6.4% or lifestyle counseling notes held for preventive diet advice rather than diabetic recall.
4. **Resolved Postpartum GDM (3 patients)**: Gestational diabetes with medications stopped post-delivery; held for annual OGTT screening.

---

## 4. What This Result Cannot Be Trusted For

1. **External Care**: Does not reflect diabetes care, lab tests, or prescriptions received outside St. Vincent Hospital.
2. **Informal Communications**: Does not capture phone consultations, WhatsApp messages, or unrecorded interactions.
3. **Unstandardized Shorthand**: Review intervals in non-standard free text default to the 4-month rule.
4. **Diagnostic Authority**: Administrative prioritization tool for front-desk scheduling; cannot substitute for clinician judgment.
