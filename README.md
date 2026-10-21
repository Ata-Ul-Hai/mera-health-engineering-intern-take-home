# St. Vincent Hospital — Diabetic Follow-Up & Recall Engine

An operational patient recall dashboard and clinical data pipeline built for hospital operations and front-desk staff at St. Vincent Hospital. The system ingests electronic medical record (EMR) exports, identifies confirmed diabetic patients, determines follow-up timeliness, stratifies clinical priority, and provides an intuitive web interface and CSV exports for front-desk scheduling.

---

## Quick Start

Launch the entire application with a single command from the project root:

```bash
./run.sh
```

### What `./run.sh` Does:
1. **Python Environment**: Verifies or creates a local virtual environment (`.venv`) and installs `pandas`.
2. **Clinical Data Pipeline**: Executes `scripts/process_data.py` to parse raw EMR records, run diagnostic logic, and output fresh CSV exports and frontend data.
3. **Frontend Dashboard**: Verifies Node.js dependencies in `frontend/` and boots the React 19 application via Vite.
4. **Local Access**: Automatically opens or serves the dashboard at:
   ```
   http://localhost:3000
   ```

---

## Core Features & Workflow

### 1. Front-Desk Web Portal (`frontend/`)
- **Priority-Ordered Calling Queue**: Overdue patients are indexed `#1..N` with 🔴 High Priority patients listed first, sorted by days overdue descending.
- **Operational Call Logging**: Track call outcomes directly in the browser across 5 standardized states:
  - `To Call (Pending)`
  - `Booked / Rescheduled`
  - `Voicemail / Left Msg`
  - `Callback Requested`
  - `Wrong / Inactive Number`
  *(All dispositions persist locally in `localStorage`).*
- **Slide-Over Clinical Dossier Drawer**: Clicking any patient opens a comprehensive medical history drawer showing past visits, doctor notes, antidiabetic prescriptions, lab trends, and contact warning flags.
- **Fast Search & Department Filters**: Instant filtering by patient name, phone number, MRN, clinical priority, call status, and attending department.
- **Tabbed Worklists**: Clean separation across Overdue Call List, Due Soon Reminders, Flagged for Verification, On Track Patients, and Excluded Guardrails.

### 2. Structured CSV Exports (`export/`)
Front-desk staff and clinical coordinators can open dedicated spreadsheets directly in Microsoft Excel or Google Sheets:
- `export/overdue_diabetic_patients.csv` (43 patients): Confirmed diabetic patients requiring recall.
- `export/due_soon_diabetic_patients.csv` (5 patients): Upcoming appointments within 14 days for proactive reminder outreach.
- `export/flagged_verification_patients.csv` (24 patients): Ambiguities and unconfirmed findings isolated for clinical/administrative review.

---

## Clinical Logic & Decision Rules

### Diagnostic Criteria
Patients are classified as confirmed diabetic based on four criteria:
1. **Diabetology Specialty**: Any visit to the Diabetology department.
2. **Antidiabetic Medications**: Active prescriptions for insulin or oral hypoglycemic agents (Metformin, Glimepiride, Gliclazide, Sitagliptin, Vildagliptin, Dapagliflozin).
3. **Clinical Documentation (Negation-Filtered)**: Diagnoses of Type 1, Type 2, gestational, or juvenile diabetes (`T2DM`, `type 2 DM`, `k/c/o DM`, `known diabetic`) across all departments, filtered against negative and familial contexts (*"denies diabetes"*, *"non-diabetic"*, *"no h/o diabetes"*, *"father diabetic"*, *"family history of diabetes"*, *"pre-diabetic"*, *"urine sugar nil"*).
4. **Quantitative Lab Thresholds**: Diabetic laboratory results (HbA1c $\ge 6.5\%$ or $\ge 48$ mmol/mol; FBS $\ge 126$ mg/dL or $\ge 7.0$ mmol/L; PPBS $\ge 200$ mg/dL or $\ge 11.1$ mmol/L).

### Follow-Up Baseline & Overdue Rules
- **Diabetes-Specific Anchor**: Unrelated specialty visits (Dental, ENT, Orthopaedics, Dermatology) do **not** reset the diabetic follow-up clock. The baseline is anchored to the patient's latest Diabetology visit, antidiabetic prescription, or glycemic review note.
- **Tier 1 (Explicit Appointment)**: If a `next_appointment` was scheduled at a diabetes visit and the date passed without a subsequent diabetes visit, the patient is overdue.
- **Tier 2 (Review Interval in Notes)**: Extracted doctor instructions (e.g., *"review 6 wks"*, *"r/v 3/12"* = 90 days), strictly disambiguated from symptom durations (*"pain x 2 months"*).
- **Tier 3 (Clinical 4-Month Fallback)**: If no explicit date or interval exists, follow-up defaults to 120 days (4 months) per clinical standards.

### Clinical Priority Triage
- **🔴 High Priority (24 patients)**:
  - Prescribed **Insulin** (lapse risks rapid hyperglycemia or DKA).
  - Severe laboratory findings: **HbA1c $\ge 9.0\%$** (or $\ge 75$ mmol/mol) or blood sugar $\ge 250$ mg/dL (or $\ge 13.9$ mmol/L).
  - Documentation of acute symptoms (*"sugars running high"*, *"burning soles"*, *"DKA"*).
- **🟡 Medium Priority (19 patients)**: Overdue patients maintained on oral antidiabetic agents without acute glycemic crisis.

### Dedicated Verification Queue (`FLAGGED_VERIFICATION`)
To prevent uninformed or erroneous calls, ambiguous records are isolated from the call list:
- **Duplicate Registrations (8 MRNs / 4 pairs)**: Patients sharing phone, DOB, and sex (e.g., Joseph Dsouza / Joseph D'Souza) flagged for medical records merging.
- **Lab-Only Findings (9 patients)**: Diabetic-range lab results without attending doctor diagnosis or prescription, flagged for clinical confirmation before recall.
- **Borderline Prediabetes (4 patients)**: HbA1c 5.7–6.4% or prediabetic counselling held for lifestyle intervention rather than diabetic recall.
- **Resolved Postpartum GDM (3 patients)**: Gestational diabetes where medication was stopped post-delivery, held for annual postpartum screening.

---

## 300-Patient Mathematical Partition

Every patient in the 300-patient dataset belongs to exactly one mutually exclusive bucket:

| Bucket / Worklist | Patient Count | Description |
| :--- | :---: | :--- |
| **Overdue Call List** | **43** | Confirmed diabetic patients overdue for recall (24 High + 19 Medium Priority) |
| **Due Soon Reminder List** | **5** | Appointments due in next 14 days or approaching 4 months |
| **Flagged for Verification** | **24** | Duplicates (8), Lab-only (9), Prediabetes (4), Resolved GDM (3) |
| **On Track / Up to Date** | **32** | Diabetic patients seen recently or holding future appointments |
| **Excluded Guardrails** | **196** | Deceased (3), Transferred Care (3), Confirmed Non-Diabetic (190) |
| **Total** | **300** | **Exact mathematical reconciliation: $43 + 5 + 24 + 32 + 196 = 300$** |

---

## Project Structure

```
├── DECISIONS.md          # Complete documentation of terms, data issues, flags & limitations (<= 2 pages)
├── PLAN.md               # Technical specification committed prior to implementation
├── README.md             # Project documentation, architecture, and run instructions
├── brief.md              # Project brief (gitignored)
├── email.txt             # Original operations email from Meenakshi (gitignored)
├── reply.txt             # Non-technical, empathetic response to Meenakshi (< 200 words)
├── run.sh                # Executable single-command runner for pipeline + web dashboard
├── export/               # Raw EMR inputs & generated recall spreadsheets
│   ├── patients.csv      # Raw patient demographics (300 rows)
│   ├── visits.csv        # Raw outpatient encounters (815 rows)
│   ├── prescriptions.csv # Raw medication orders (540 rows)
│   ├── lab_results.csv   # Raw laboratory records (425 rows)
│   ├── overdue_diabetic_patients.csv       # Clean recall list (43 patients)
│   ├── due_soon_diabetic_patients.csv      # Reminder list (5 patients)
│   └── flagged_verification_patients.csv   # Human review queue (24 patients)
├── scripts/
│   └── process_data.py   # Clinical engine: parsing, diagnostic tiers, follow-up & exports
└── frontend/
    ├── package.json      # React 19, Vite, Tailwind CSS, Lucide Icons
    ├── vite.config.js    # Vite configuration (port 3000)
    └── src/
        ├── App.jsx       # Main dashboard: queues, call logging, drawer, search/filter
        └── data/
            └── processed_data.json # Pipeline JSON consumed by frontend
```

---

## Verification & Testing

1. **Re-run Data Pipeline**:
   ```bash
   ./run.sh
   ```
2. **Run Pipeline Directly**:
   ```bash
   source .venv/bin/activate
   python3 scripts/process_data.py
   ```
3. **Build Frontend**:
   ```bash
   cd frontend
   npm run build
   ```
