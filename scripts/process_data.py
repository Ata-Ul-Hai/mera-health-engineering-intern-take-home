#!/usr/bin/env python3
"""
scripts/process_data.py
Robust clinical data processing pipeline for mera.health diabetic follow-up system.
Ingests export/ CSVs, applies clinical classification, diabetes-anchored follow-up logic,
safety exclusions, duplicate registration isolation, and generates structured outputs.
"""

import os
import re
import json
import csv
from datetime import datetime, timedelta
from collections import defaultdict
import pandas as pd


# -------------------------------------------------------------------------
# Configurations & Constants
# -------------------------------------------------------------------------
DEFAULT_REFERENCE_DATE = "2026-10-01"

ANTIDIABETIC_DRUGS = [
    "metformin", "glimepiride", "gliclazide", "glipizide",
    "insulin", "sitagliptin", "vildagliptin", "teneligliptin",
    "dapagliflozin", "empagliflozin", "pioglitazone", "mixtard"
]
ANTIDIABETIC_REGEX = re.compile(r"(" + "|".join(ANTIDIABETIC_DRUGS) + r")", re.IGNORECASE)

# Negation and Family History phrases to prevent false positive diabetes matches
NEGATION_PATTERNS = [
    r"\b(?:denies|denied)\s+diabetes\b",
    r"\bno\s+h/o\s+diabetes\b",
    r"\bnon-diabetic\b",
    r"\bpre[-\s]?diabetic\b",                                          # Bug 1: "pre-diabetic" has hyphen as word boundary, matches \bdiabetic\b
    r"\bborderline\s+diabet\w*",                                       # Bug 1: "borderline diabetic" is prediabetes, not confirmed DM
    r"\bprediabetes\b",
    r"\bpre-diabetes\b",
    r"\bfamily\s+(?:history|h/o)?\s*(?:of\s+)?diabetes\b",           # Bug 2: "family history of diabetes" is NOT patient's own diagnosis
    r"\bf/h\s+.*?diabet",                                             # Bug 2: f/h shorthand for family history
    r"\b(?:father|mother|brother|sister|parents?|family|f/h:?\s*(?:father|mother)?)\s+(?:is\s+)?diabetic\b",
    r"\burine\s+sugar\s+nil\b",
    r"\bimpaired\s+fasting\s+glucose\b",
    r"\bno\s+history\s+of\s+diabetes\b",
    r"\br/o\s+diabetes\b",
]
NEGATION_REGEX = re.compile(r"(" + "|".join(NEGATION_PATTERNS) + r")", re.IGNORECASE)

# Positive diabetes diagnostic criteria (Type 1, Type 2, Gestational, Juvenile, DM, bare diabetes)
POSITIVE_DIABETES_PATTERNS = [
    r"\btype\s*(?:2|ii|1|i)?\s*(?:dm|diabetes)\b",
    r"\b(?:t2dm|t1dm|iddm|niddm|gdm|gestational\s+diabetes)\b",
    r"\bk/c/o\s+(?:t2dm|t1dm|dm|diabetes|juvenile\s+diabetes)\b",
    r"\bknown\s+diabetic\b",
    r"\bjuvenile\s+diabetes\b",
    r"\bdiabetes\s+mellitus\b",
    r"\bdiabetic\b(?!(\s+(?:father|mother|brother|sister|retinopathy\s+screen\s+negative|diet)))",
    r"\bdiabetes\b",
]
POSITIVE_DIABETES_REGEX = re.compile(r"(" + "|".join(POSITIVE_DIABETES_PATTERNS) + r")", re.IGNORECASE)

# Glycemic monitoring markers for established diabetes care visits
GLYCEMIC_FOLLOWUP_PATTERNS = [
    r"\bhba1c\b",
    r"\bfbs\b",
    r"\bppbs\b",
    r"\bgrbs\b",
    r"\bsmbg\b",
    r"\boha\b",
    r"\bsugars?\s+(?:running\s+high|not\s+under\s+control|under\s+control|acceptable|controlled)\b",
    r"\bpre-meal\s+sugars\b",
]
GLYCEMIC_FOLLOWUP_REGEX = re.compile(r"(" + "|".join(GLYCEMIC_FOLLOWUP_PATTERNS) + r")", re.IGNORECASE)

# Anchored regex for doctor review intervals (strictly ignores symptom durations like 'x 2 months')
REVIEW_REGEX = re.compile(
    r"\b(?:review|r/v)\s*(?:in|after)?\s*"
    r"(?:"
    r"(\d+)\s*/\s*12\b|"                                            # r/v 3/12 -> 3 months
    r"(\d+)\s*(days?|d|wks?|weeks?|w|months?|mths?|m|yrs?|years?|y)\b|" # review 6 wks
    r"(tomorrow|yearly|next\s+week)\b"                             # review tomorrow
    r")",
    re.IGNORECASE
)

DECEASED_REGEX = re.compile(r"\b(expired|deceased|died|death summary)\b", re.IGNORECASE)
TRANSFERRED_REGEX = re.compile(r"\b(relocated|transfer(?:red)?\s+care|native\s+place|to\s+f/u\s+with\s+local)\b", re.IGNORECASE)


def parse_date(date_str):
    """Parses various date formats present in the datasets."""
    if not date_str or pd.isna(date_str):
        return None
    date_str = str(date_str).strip()
    if not date_str:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d %b %y", "%d %B %Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(date_str, fmt).date()
        except ValueError:
            pass
    return None


def format_date(d):
    return d.strftime("%Y-%m-%d") if d else ""


def parse_review_interval(notes_text):
    """
    Extracts the doctor's review interval from clinical notes.
    Strictly anchored to 'review' or 'r/v' to avoid symptom durations (e.g. 'x 2 months').
    Returns (days, matched_text) or (None, None).
    """
    if not notes_text:
        return None, None

    m = REVIEW_REGEX.search(notes_text)
    if not m:
        return None, None

    matched_text = m.group(0).strip()

    # 1. Indian medical notation 'r/v X/12'
    if m.group(1):
        months = int(m.group(1))
        return months * 30, matched_text

    # 2. Number + unit
    if m.group(2) and m.group(3):
        num = int(m.group(2))
        unit = m.group(3).lower()
        if unit.startswith("d"):
            return num, matched_text
        elif unit.startswith("w"):
            return num * 7, matched_text
        elif unit.startswith("m"):
            return num * 30, matched_text
        elif unit.startswith("y"):
            return num * 365, matched_text

    # 3. Special keywords
    if m.group(4):
        kw = m.group(4).lower()
        if "tomorrow" in kw:
            return 1, matched_text
        elif "next week" in kw:
            return 7, matched_text
        elif "yearly" in kw:
            return 365, matched_text

    return None, None


def evaluate_lab_test(test_name, val_str, unit, ref_range):
    """
    Evaluates lab tests for diabetes:
    Returns (is_diabetic_range, is_borderline, is_normal, is_severe, display_str)
    """
    name_clean = test_name.lower().strip()
    try:
        val = float(re.findall(r"[-+]?\d*\.\d+|\d+", str(val_str))[0])
    except (IndexError, ValueError):
        return False, False, False, False, f"{test_name}: {val_str}"

    unit_clean = str(unit).strip().lower() if unit and pd.notna(unit) else ""

    # HbA1c / A1C / Glycated Hb
    if any(k in name_clean for k in ["hba1c", "a1c", "glycated"]):
        if "%" in unit_clean or val < 20: # Percentage scale
            is_severe = val >= 9.0
            if val >= 6.5:
                return True, False, False, is_severe, f"{test_name} {val}% (Diabetic ≥6.5%)"
            elif 5.7 <= val < 6.5:
                return False, True, False, False, f"{test_name} {val}% (Borderline 5.7-6.4%)"
            else:
                return False, False, True, False, f"{test_name} {val}% (Normal <5.7%)"
        else: # mmol/mol scale (IFCC)
            is_severe = val >= 75 # 75 mmol/mol corresponds to ~9.0%
            if val >= 48:
                return True, False, False, is_severe, f"{test_name} {val} mmol/mol (Diabetic ≥48)"
            elif 39 <= val < 48:
                return False, True, False, False, f"{test_name} {val} mmol/mol (Borderline 39-47)"
            else:
                return False, False, True, False, f"{test_name} {val} mmol/mol (Normal <39)"

    # Fasting Blood Sugar: FBS, Fasting Glucose, Glucose (F)
    if any(k in name_clean for k in ["fbs", "fasting", "glucose (f)"]):
        if "mmol" in unit_clean or val < 25:
            is_severe = val >= 13.9 # 250 mg/dL / 18 ~ 13.9 mmol/L
            if val >= 7.0:
                return True, False, False, is_severe, f"{test_name} {val} mmol/L (Diabetic ≥7.0)"
            elif 5.6 <= val < 7.0:
                return False, True, False, False, f"{test_name} {val} mmol/L (Impaired 5.6-6.9)"
            else:
                return False, False, True, False, f"{test_name} {val} mmol/L (Normal)"
        else:
            is_severe = val >= 250.0
            if val >= 126.0:
                return True, False, False, is_severe, f"{test_name} {val} mg/dL (Diabetic ≥126)"
            elif 100.0 <= val < 126.0:
                return False, True, False, False, f"{test_name} {val} mg/dL (Impaired 100-125)"
            else:
                return False, False, True, False, f"{test_name} {val} mg/dL (Normal <100)"

    # Post Prandial Blood Sugar: PPBS, Post Prandial Glucose, Glucose (PP)
    if any(k in name_clean for k in ["ppbs", "post prandial", "glucose (pp)"]):
        if "mmol" in unit_clean or val < 30:
            is_severe = val >= 13.9
            if val >= 11.1:
                return True, False, False, is_severe, f"{test_name} {val} mmol/L (Diabetic ≥11.1)"
            elif 7.8 <= val < 11.1:
                return False, True, False, False, f"{test_name} {val} mmol/L (Impaired 7.8-11.0)"
            else:
                return False, False, True, False, f"{test_name} {val} mmol/L (Normal <7.8)"
        else:
            is_severe = val >= 250.0
            if val >= 200.0:
                return True, False, False, is_severe, f"{test_name} {val} mg/dL (Diabetic ≥200)"
            elif 140.0 <= val < 200.0:
                return False, True, False, False, f"{test_name} {val} mg/dL (Impaired 140-199)"
            else:
                return False, False, True, False, f"{test_name} {val} mg/dL (Normal <140)"

    return False, False, False, False, f"{test_name}: {val_str}"


def run_pipeline(export_dir="export", reference_date_str=DEFAULT_REFERENCE_DATE):
    ref_date = parse_date(reference_date_str)
    print(f"[*] Running data pipeline with reference date: {ref_date}")

    # 1. Load data
    patients_df = pd.read_csv(os.path.join(export_dir, "patients.csv"))
    visits_df = pd.read_csv(os.path.join(export_dir, "visits.csv"))
    labs_df = pd.read_csv(os.path.join(export_dir, "lab_results.csv"))
    rx_df = pd.read_csv(os.path.join(export_dir, "prescriptions.csv"))

    # Parse dates
    visits_df["visit_date_parsed"] = visits_df["visit_date"].apply(parse_date)
    visits_df["next_appt_parsed"] = visits_df["next_appointment"].apply(parse_date)
    rx_df["prescribed_on_parsed"] = rx_df["prescribed_on"].apply(parse_date)
    labs_df["collected_on_parsed"] = labs_df["collected_on"].apply(parse_date)

    # Sort visits chronologically
    visits_df = visits_df.sort_values(by=["mrn", "visit_date_parsed", "visit_id"])

    # 2. Build maps
    patients = {}
    for row in patients_df.to_dict("records"):
        mrn = row["mrn"]
        phone = str(row["phone"]).strip() if pd.notna(row["phone"]) else ""
        if phone.endswith(".0"):
            phone = phone[:-2]
        patients[mrn] = {
            "mrn": mrn,
            "name": str(row["name"]).strip(),
            "dob": format_date(parse_date(row["dob"])),
            "sex": str(row["sex"]).strip(),
            "phone": phone,
            "registered_on": format_date(parse_date(row["registered_on"])),
        }

    visits_by_mrn = defaultdict(list)
    for row in visits_df.to_dict("records"):
        visits_by_mrn[row["mrn"]].append(row)

    rx_by_mrn = defaultdict(list)
    for row in rx_df.to_dict("records"):
        rx_by_mrn[row["mrn"]].append(row)

    labs_by_mrn = defaultdict(list)
    for row in labs_df.to_dict("records"):
        labs_by_mrn[row["mrn"]].append(row)

    # Set of visit_ids where antidiabetic medication was prescribed
    diab_rx_visit_ids = set()
    for row in rx_df.to_dict("records"):
        if ANTIDIABETIC_REGEX.search(str(row["drug"])):
            diab_rx_visit_ids.add(row["visit_id"])

    # 3. Detect duplicate registrations and shared phones
    phone_to_mrns = defaultdict(list)
    for mrn, p in patients.items():
        if p["phone"] and len(p["phone"]) == 10:
            phone_to_mrns[p["phone"]].append(mrn)

    duplicate_pairs = {}
    shared_family_phones = defaultdict(list)
    for phone, mrn_list in phone_to_mrns.items():
        if len(mrn_list) > 1:
            # Check if DOB and sex match (duplicate registration)
            dob_map = defaultdict(list)
            for m in mrn_list:
                key = (patients[m]["dob"], patients[m]["sex"])
                dob_map[key].append(m)
            for key, dup_m_list in dob_map.items():
                if len(dup_m_list) > 1:
                    for m in dup_m_list:
                        others = [f"{patients[x]['name']} ({x})" for x in dup_m_list if x != m]
                        duplicate_pairs[m] = others
                else:
                    for m in mrn_list:
                        others = [f"{patients[x]['name']} ({x})" for x in mrn_list if x != m]
                        shared_family_phones[m] = others

    # Helper: Identify diabetes-specific visits
    def is_diabetes_visit(v):
        dept = str(v["department"]).strip().lower()
        if dept == "diabetology":
            return True
        if v["visit_id"] in diab_rx_visit_ids:
            return True
        notes = str(v["notes"]).strip() if pd.notna(v["notes"]) else ""
        if NEGATION_REGEX.search(notes):
            return False
        if POSITIVE_DIABETES_REGEX.search(notes):
            return True
        # Glycemic monitoring in general medicine, obg, paediatrics
        if GLYCEMIC_FOLLOWUP_REGEX.search(notes) and dept in ["general medicine", "diabetology", "obg", "paediatrics"]:
            if not re.search(r"\b(?:adv|send|order|sent)\s+(?:fbs|hba1c|cbc)\b", notes, re.IGNORECASE):
                return True
        return False

    # 4. Classify each patient
    classified_patients = []

    for mrn, p in patients.items():
        p_visits = visits_by_mrn.get(mrn, [])
        p_rx = rx_by_mrn.get(mrn, [])
        p_labs = labs_by_mrn.get(mrn, [])

        # Evidence collectors
        has_diabetology_dept = False
        pos_notes_found = []
        neg_notes_found = []
        diab_rx_found = []
        abnormal_labs = []
        borderline_labs = []
        normal_labs = []
        has_severe_lab = False
        future_lab_messages = []

        is_deceased = False
        deceased_reason = ""
        is_transferred = False
        transferred_reason = ""

        # Check visits
        for v in p_visits:
            dept = str(v["department"]).strip()
            notes = str(v["notes"]).strip() if pd.notna(v["notes"]) else ""
            v_date_str = format_date(v["visit_date_parsed"])

            if dept.lower() == "diabetology":
                has_diabetology_dept = True

            # Deceased check
            if DECEASED_REGEX.search(notes):
                is_deceased = True
                deceased_reason = f"Deceased recorded on {v_date_str}: {notes}"

            # Transferred / Relocated check
            if TRANSFERRED_REGEX.search(notes):
                is_transferred = True
                transferred_reason = f"Transferred/Relocated on {v_date_str}: {notes}"

            # Notes analysis
            if NEGATION_REGEX.search(notes):
                neg_notes_found.append(f"{dept} ({v_date_str}): {notes}")
            elif POSITIVE_DIABETES_REGEX.search(notes):
                pos_notes_found.append(f"{dept} ({v_date_str}): {notes}")

        # Check Prescriptions
        for r in p_rx:
            drug = str(r["drug"]).strip()
            if ANTIDIABETIC_REGEX.search(drug):
                rx_date_str = format_date(r["prescribed_on_parsed"])
                diab_rx_found.append(f"{drug} ({rx_date_str})")

        # Check Labs (handle future-dated labs safely)
        for l in p_labs:
            t_name = str(l["test_name"]).strip()
            col_date = l["collected_on_parsed"]
            col_date_str = format_date(col_date)
            is_diab, is_border, is_norm, is_sev, disp = evaluate_lab_test(
                t_name, l["value"], l["unit"], l["reference_range"]
            )

            # Check if lab test is future-dated relative to system snapshot
            if col_date and col_date > ref_date:
                future_lab_messages.append(f"Future-dated lab record ({col_date_str}): Excluded from chronology and follow-up baseline")

            if is_sev:
                has_severe_lab = True
            if is_diab:
                abnormal_labs.append(f"{disp} [{col_date_str}]")
            elif is_border:
                borderline_labs.append(f"{disp} [{col_date_str}]")
            elif is_norm:
                normal_labs.append(f"{disp} [{col_date_str}]")

        # -----------------------------------------------------------------
        # Diabetes Diagnosis Category
        # -----------------------------------------------------------------
        diabetes_category = "NON_DIABETIC"
        clinical_evidence = []
        is_lab_only_diagnosis = False

        if has_diabetology_dept or pos_notes_found or diab_rx_found:
            diabetes_category = "CONFIRMED_DIABETIC"
            if has_diabetology_dept:
                clinical_evidence.append("Diabetology Department visits")
            if diab_rx_found:
                unique_drugs = sorted(set(d.split(" (")[0] for d in diab_rx_found))
                clinical_evidence.append(f"Rx: {', '.join(unique_drugs[:3])}")
            if pos_notes_found:
                clinical_evidence.append(f"Notes: {pos_notes_found[-1].split(': ')[-1][:50]}...")
            if abnormal_labs:
                clinical_evidence.append(f"Lab: {abnormal_labs[-1]}")
        elif abnormal_labs:
            # Abnormal lab findings only (elevated HbA1c/glucose without clinical documentation)
            diabetes_category = "CONFIRMED_DIABETIC"
            is_lab_only_diagnosis = True
            clinical_evidence.append(f"Lab Finding: {', '.join(abnormal_labs)}")
        elif borderline_labs and not normal_labs:
            diabetes_category = "BORDERLINE_PREDIABETES"
            clinical_evidence.append(f"Borderline: {', '.join(borderline_labs)}")
        elif neg_notes_found or normal_labs:
            diabetes_category = "NON_DIABETIC"
            if neg_notes_found:
                clinical_evidence.append(f"Negation: {neg_notes_found[-1].split(': ')[-1][:50]}...")
            if normal_labs:
                clinical_evidence.append(f"Normal Screening: {normal_labs[-1]}")

        # Check for postpartum resolved Gestational Diabetes (GDM)
        is_resolved_gdm = False
        for v in p_visits:
            n = str(v["notes"]).lower() if pd.notna(v["notes"]) else ""
            if ("metformin stopped" in n or "insulin stopped" in n or "sugars normal post delivery" in n) and ("pnc" in n or "post lscs" in n):
                is_resolved_gdm = True

        # High priority indicators (Insulin, HbA1c >= 9%, Blood Sugar >= 250 mg/dL, severe hyperglycemia notes)
        is_on_insulin = any("insulin" in r.lower() or "mixtard" in r.lower() for r in diab_rx_found)
        has_severe_sugar_note = any(any(k in n.lower() for k in ["sugars running high", "sugars not under control", "burning soles", "dka"]) for n in pos_notes_found)
        is_high_risk = is_on_insulin or has_severe_lab or has_severe_sugar_note

        # -----------------------------------------------------------------
        # Evaluate Follow-Up Status (Diabetes-Specific Baseline Resolution)
        # -----------------------------------------------------------------
        followup_status = "NOT_DUE"
        priority = "ROUTINE"
        reason_tokens = []
        target_date = None
        days_overdue = 0
        days_until = 0

        # Filter diabetes-specific visits
        diab_visits = [v for v in p_visits if is_diabetes_visit(v)]
        latest_visit = p_visits[-1] if len(p_visits) > 0 else None

        # Check for subsequent non-diabetic visit
        flag_non_diab_visit = None
        if len(diab_visits) > 0 and latest_visit and latest_visit["visit_id"] != diab_visits[-1]["visit_id"]:
            non_diab_dept = latest_visit["department"]
            non_diab_date = format_date(latest_visit["visit_date_parsed"])
            flag_non_diab_visit = f"Recent Non-Diabetic Visit: {non_diab_dept} on {non_diab_date} — Follow-up anchored to Diabetology/DM care"

        if len(diab_visits) > 0:
            latest_diab_v = diab_visits[-1]
            latest_diab_date = latest_diab_v["visit_date_parsed"]

            # Tier 1: Check active next appointment from diabetes visits
            # Only superseded if patient returned for a subsequent DIABETES visit on or after that date
            active_appt = None
            for v in reversed(diab_visits):
                if pd.notna(v["next_appt_parsed"]):
                    had_subsequent_diab = any(
                        sub["visit_date_parsed"] >= v["next_appt_parsed"]
                        for sub in diab_visits
                        if sub["visit_id"] != v["visit_id"]
                    )
                    if not had_subsequent_diab:
                        active_appt = v["next_appt_parsed"]
                        break

            if active_appt:
                target_date = active_appt
                if target_date < ref_date:
                    followup_status = "OVERDUE"
                    days_overdue = (ref_date - target_date).days
                    reason_tokens = [
                        "Missed Appt",
                        f"{days_overdue}d overdue",
                        f"Target: {format_date(target_date)}"
                    ]
                elif ref_date <= target_date <= ref_date + timedelta(days=14):
                    followup_status = "DUE_SOON"
                    days_until = (target_date - ref_date).days
                    reason_tokens = [
                        "Upcoming Appt",
                        f"{days_until}d remaining",
                        f"Target: {format_date(target_date)}"
                    ]
                else:
                    followup_status = "NOT_DUE"
                    reason_tokens = ["Appt Scheduled", f"Target: {format_date(target_date)}"]

            else:
                # Tier 2: Check review interval in notes of the latest diabetes visit
                interval_days, note_phrase = parse_review_interval(str(latest_diab_v["notes"]))
                if interval_days is not None:
                    target_date = latest_diab_date + timedelta(days=interval_days)
                    if target_date < ref_date:
                        followup_status = "OVERDUE"
                        days_overdue = (ref_date - target_date).days
                        reason_tokens = [
                            f"Note: {note_phrase}",
                            f"{days_overdue}d overdue",
                            f"Target: {format_date(target_date)}"
                        ]
                    elif ref_date <= target_date <= ref_date + timedelta(days=14):
                        followup_status = "DUE_SOON"
                        days_until = (target_date - ref_date).days
                        reason_tokens = [
                            f"Note: {note_phrase}",
                            f"{days_until}d remaining",
                            f"Target: {format_date(target_date)}"
                        ]
                    else:
                        followup_status = "NOT_DUE"
                        reason_tokens = [f"Note: {note_phrase}", f"Target: {format_date(target_date)}"]
                else:
                    # Tier 3: Fallback 4-month (120-day) rule from latest diabetes visit
                    days_since_diab = (ref_date - latest_diab_date).days
                    if days_since_diab > 120:
                        followup_status = "OVERDUE"
                        days_overdue = days_since_diab - 120
                        reason_tokens = [
                            "4-Month Gap",
                            f"{days_overdue}d overdue",
                            f"Last DM visit: {format_date(latest_diab_date)}"
                        ]
                    elif 105 <= days_since_diab <= 120:
                        followup_status = "DUE_SOON"
                        days_until = 120 - days_since_diab
                        reason_tokens = [
                            "Approaching 4 Months",
                            f"{days_until}d remaining",
                            f"Last DM visit: {format_date(latest_diab_date)}"
                        ]
                    else:
                        followup_status = "NOT_DUE"
                        reason_tokens = [f"Recent DM Visit ({days_since_diab}d ago)", "On Track"]

        # Assign Priority
        if followup_status == "OVERDUE":
            priority = "HIGH" if is_high_risk else "MEDIUM"
        elif followup_status == "DUE_SOON":
            priority = "DUE_SOON"
        else:
            priority = "ROUTINE"

        # -----------------------------------------------------------------
        # Safety & Worklist Bucket Allocation
        # -----------------------------------------------------------------
        worklist = "NON_DIABETIC"
        exclusion_reason = ""
        warning_flags = []
        flag_category = ""

        # Check duplicate registration
        is_duplicate = mrn in duplicate_pairs

        # Populate warning flags
        if is_duplicate:
            warning_flags.append(f"Duplicate Registration alert: Matches {', '.join(duplicate_pairs[mrn])}")
        if is_lab_only_diagnosis:
            warning_flags.append("Lab Diagnosis Only - Clinician verification recommended before outreach")
        if is_resolved_gdm:
            warning_flags.append("Resolved Postpartum GDM - Medication discontinued at delivery; annual screening advised")
        if flag_non_diab_visit:
            warning_flags.append(flag_non_diab_visit)
        if not p["phone"]:
            warning_flags.append("Missing Phone Number on file")
        if mrn in shared_family_phones:
            warning_flags.append(f"Shared Family Phone: Shared with {', '.join(shared_family_phones[mrn])}")
        for fmsg in future_lab_messages:
            warning_flags.append(fmsg)

        # Worklist Bucket Allocation
        if is_deceased:
            worklist = "EXCLUDED"
            exclusion_reason = deceased_reason
        elif is_transferred:
            worklist = "EXCLUDED"
            exclusion_reason = transferred_reason
        elif is_duplicate or is_lab_only_diagnosis or diabetes_category == "BORDERLINE_PREDIABETES" or is_resolved_gdm:
            # Dedicated Flagged List for serious ambiguities / false-positive risks
            worklist = "FLAGGED_VERIFICATION"
            if is_duplicate:
                flag_category = "Duplicate Registration"
            elif is_lab_only_diagnosis:
                flag_category = "Lab-Only Finding"
            elif diabetes_category == "BORDERLINE_PREDIABETES":
                flag_category = "Borderline Prediabetes"
            elif is_resolved_gdm:
                flag_category = "Resolved Postpartum GDM"
        elif diabetes_category == "NON_DIABETIC":
            worklist = "EXCLUDED"
            exclusion_reason = "Non-diabetic / Normal screening tests / Negated history"
        elif diabetes_category == "CONFIRMED_DIABETIC":
            if followup_status == "OVERDUE":
                worklist = "OVERDUE"
            elif followup_status == "DUE_SOON":
                worklist = "DUE_SOON"
            else:
                worklist = "ON_TRACK"

        # Baseline visit info
        display_visit = diab_visits[-1] if len(diab_visits) > 0 else latest_visit
        display_visit_date = format_date(display_visit["visit_date_parsed"]) if display_visit else ""
        display_dept = str(display_visit["department"]).strip() if display_visit else ""
        display_doctor = str(display_visit["doctor"]).strip() if display_visit else ""
        display_notes = str(display_visit["notes"]).strip() if display_visit and pd.notna(display_visit["notes"]) else ""

        # Assemble rich patient record
        record = {
            "mrn": mrn,
            "name": p["name"],
            "dob": p["dob"],
            "sex": p["sex"],
            "phone": p["phone"],
            "registered_on": p["registered_on"],
            "diabetes_category": diabetes_category,
            "is_lab_only_diagnosis": is_lab_only_diagnosis,
            "is_duplicate": is_duplicate,
            "flag_category": flag_category,
            "clinical_evidence": clinical_evidence,
            "followup_status": followup_status,
            "priority": priority,
            "worklist": worklist,
            "exclusion_reason": exclusion_reason,
            "warning_flags": warning_flags,
            "target_date": format_date(target_date),
            "days_overdue": days_overdue,
            "days_until": days_until,
            "reason_tokens": reason_tokens,
            "reason_summary": " | ".join(reason_tokens),
            "latest_visit": {
                "visit_date": display_visit_date,
                "department": display_dept,
                "doctor": display_doctor,
                "notes": display_notes
            } if display_visit else None,
            "history": {
                "total_visits": len(p_visits),
                "diabetology_visits": sum(1 for v in p_visits if str(v["department"]).lower() == "diabetology"),
                "prescriptions": [str(r["drug"]) for r in p_rx if ANTIDIABETIC_REGEX.search(str(r["drug"]))],
                "all_prescriptions": [f"{r['drug']} ({r['dose']})" for r in p_rx],
                "labs": [f"{l['test_name']}: {l['value']} {l['unit'] or ''}".strip() for l in p_labs]
            }
        }
        classified_patients.append(record)

    # 5. Export Datasets & Summaries
    print("\n=== PIPELINE EXECUTION SUMMARY ===")
    counts = defaultdict(int)
    for r in classified_patients:
        counts[r["worklist"]] += 1
    for k, v in sorted(counts.items()):
        print(f"  Worklist '{k}': {v} patients")

    # Filter distinct mutually exclusive lists (sum = 300)
    overdue_list = [r for r in classified_patients if r["worklist"] == "OVERDUE"]
    due_soon_list = [r for r in classified_patients if r["worklist"] == "DUE_SOON"]
    flagged_list = [r for r in classified_patients if r["worklist"] == "FLAGGED_VERIFICATION"]
    on_track_list = [r for r in classified_patients if r["worklist"] == "ON_TRACK"]
    excluded_list = [r for r in classified_patients if r["worklist"] == "EXCLUDED"]

    total_accounted = len(overdue_list) + len(due_soon_list) + len(flagged_list) + len(on_track_list) + len(excluded_list)
    print(f"\nMutually Exclusive Bucket Partition (Total: {total_accounted} / {len(classified_patients)}):")
    print(f"  1. Overdue Call List: {len(overdue_list)}")
    print(f"  2. Due Soon Reminder List: {len(due_soon_list)}")
    print(f"  3. Flagged for Verification: {len(flagged_list)}")
    print(f"  4. On Track / Up to Date: {len(on_track_list)}")
    print(f"  5. Excluded (Deceased/Transferred/Non-Diabetic): {len(excluded_list)}")
    print(f"  SUM = {len(overdue_list)} + {len(due_soon_list)} + {len(flagged_list)} + {len(on_track_list)} + {len(excluded_list)} = {total_accounted}")

    hp_cnt = sum(1 for r in overdue_list if r["priority"] == "HIGH")
    mp_cnt = sum(1 for r in overdue_list if r["priority"] == "MEDIUM")
    print(f"  -> Overdue Breakdown: {hp_cnt} High Priority + {mp_cnt} Medium Priority")

    # Generate Frontend JSON
    frontend_data_dir = os.path.join("frontend", "src", "data")
    os.makedirs(frontend_data_dir, exist_ok=True)
    json_path = os.path.join(frontend_data_dir, "processed_data.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({
            "reference_date": reference_date_str,
            "generated_at": datetime.now().isoformat(),
            "summary": {
                "total_patients": len(classified_patients),
                "overdue_count": len(overdue_list),
                "due_soon_count": len(due_soon_list),
                "flagged_verification_count": len(flagged_list),
                "on_track_count": len(on_track_list),
                "excluded_count": len(excluded_list)
            },
            "patients": classified_patients
        }, f, indent=2)
    print(f"[+] Saved frontend data to: {json_path}")

    # Generate CSV 1: overdue_diabetic_patients.csv
    overdue_csv_path = os.path.join(export_dir, "overdue_diabetic_patients.csv")
    with open(overdue_csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "MRN", "Name", "Phone", "Priority", "Days Overdue", "Target Follow-Up Date",
            "Reason For Call", "Clinical Evidence", "Action Flags", "Last DM Visit Date",
            "Department", "Doctor"
        ])
        sorted_overdue = sorted(overdue_list, key=lambda x: (0 if x["priority"] == "HIGH" else 1, -x["days_overdue"]))
        for r in sorted_overdue:
            writer.writerow([
                r["mrn"],
                r["name"],
                r["phone"] or "NO_PHONE",
                r["priority"],
                r["days_overdue"],
                r["target_date"],
                r["reason_summary"],
                "; ".join(r["clinical_evidence"]),
                "; ".join(r["warning_flags"]),
                r["latest_visit"]["visit_date"] if r["latest_visit"] else "",
                r["latest_visit"]["department"] if r["latest_visit"] else "",
                r["latest_visit"]["doctor"] if r["latest_visit"] else ""
            ])
    print(f"[+] Saved Overdue CSV to: {overdue_csv_path} ({len(overdue_list)} patients)")

    # Generate CSV 2: due_soon_diabetic_patients.csv
    due_soon_csv_path = os.path.join(export_dir, "due_soon_diabetic_patients.csv")
    with open(due_soon_csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "MRN", "Name", "Phone", "Days Remaining", "Target Follow-Up Date",
            "Reason For Reminder", "Clinical Evidence", "Action Flags", "Last DM Visit Date",
            "Department", "Doctor"
        ])
        sorted_due_soon = sorted(due_soon_list, key=lambda x: x["days_until"])
        for r in sorted_due_soon:
            writer.writerow([
                r["mrn"],
                r["name"],
                r["phone"] or "NO_PHONE",
                r["days_until"],
                r["target_date"],
                r["reason_summary"],
                "; ".join(r["clinical_evidence"]),
                "; ".join(r["warning_flags"]),
                r["latest_visit"]["visit_date"] if r["latest_visit"] else "",
                r["latest_visit"]["department"] if r["latest_visit"] else "",
                r["latest_visit"]["doctor"] if r["latest_visit"] else ""
            ])
    print(f"[+] Saved Due Soon CSV to: {due_soon_csv_path} ({len(due_soon_list)} patients)")

    # Generate CSV 3: flagged_verification_patients.csv
    flagged_csv_path = os.path.join(export_dir, "flagged_verification_patients.csv")
    with open(flagged_csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "MRN", "Name", "Phone", "Verification Category", "Detailed Reasons",
            "Clinical Evidence", "Action Flags", "Last Recorded Visit", "Department", "Doctor"
        ])
        # Sort flagged by category, then name
        sorted_flagged = sorted(flagged_list, key=lambda x: (x["flag_category"], x["name"]))
        for r in sorted_flagged:
            writer.writerow([
                r["mrn"],
                r["name"],
                r["phone"] or "NO_PHONE",
                r["flag_category"],
                "; ".join(r["warning_flags"]),
                "; ".join(r["clinical_evidence"]),
                r["exclusion_reason"] or r["reason_summary"],
                r["latest_visit"]["visit_date"] if r["latest_visit"] else "",
                r["latest_visit"]["department"] if r["latest_visit"] else "",
                r["latest_visit"]["doctor"] if r["latest_visit"] else ""
            ])
    print(f"[+] Saved Flagged Verification CSV to: {flagged_csv_path} ({len(flagged_list)} patients)")


if __name__ == "__main__":
    run_pipeline()
