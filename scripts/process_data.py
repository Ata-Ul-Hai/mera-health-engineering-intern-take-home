#!/usr/bin/env python3
"""
scripts/process_data.py
Robust clinical data processing pipeline for mera.health diabetic follow-up system.
Ingests export/ CSVs, applies clinical classification, tiered overdue logic,
safety exclusions, duplicate registration detection, and generates structured outputs.
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
    r"\b(?:father|mother|brother|sister|parents?|family)\s+(?:is\s+)?diabetic\b",
    r"\burine\s+sugar\s+nil\b",
    r"\bimpaired\s+fasting\s+glucose\b",
    r"\bno\s+history\s+of\s+diabetes\b",
    r"\br/o\s+diabetes\b",
]
NEGATION_REGEX = re.compile(r"(" + "|".join(NEGATION_PATTERNS) + r")", re.IGNORECASE)

POSITIVE_DIABETES_PATTERNS = [
    r"\b(?:type\s*(?:2|ii|1|i)?\s*diabetes|t2dm|t1dm|iddm|niddm|gdm)\b",
    r"\bk/c/o\s+(?:t2dm|t1dm|dm)\b",
    r"\bknown\s+diabetic\b",
    r"\bdiabetes\s+mellitus\b",
    r"\bdiabetic\b(?!(\s+(?:father|mother|brother|sister|retinopathy\s+screen\s+negative|diet)))",
    r"\bjuvenile\s+diabetes\b"
]
POSITIVE_DIABETES_REGEX = re.compile(r"(" + "|".join(POSITIVE_DIABETES_PATTERNS) + r")", re.IGNORECASE)

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
    Returns (is_diabetic_range, is_borderline, is_normal, display_str)
    """
    name_clean = test_name.lower().strip()
    try:
        val = float(re.findall(r"[-+]?\d*\.\d+|\d+", str(val_str))[0])
    except (IndexError, ValueError):
        return False, False, False, f"{test_name}: {val_str}"

    unit_clean = str(unit).strip().lower() if unit else ""

    # HbA1c / A1C / Glycated Hb
    if any(k in name_clean for k in ["hba1c", "a1c", "glycated"]):
        if "%" in unit_clean or val < 20: # Percentage scale
            if val >= 6.5:
                return True, False, False, f"{test_name} {val}% (Diabetic ≥6.5%)"
            elif 5.7 <= val < 6.5:
                return False, True, False, f"{test_name} {val}% (Borderline 5.7-6.4%)"
            else:
                return False, False, True, f"{test_name} {val}% (Normal <5.7%)"
        else: # mmol/mol scale (IFCC)
            if val >= 48:
                return True, False, False, f"{test_name} {val} mmol/mol (Diabetic ≥48)"
            elif 39 <= val < 48:
                return False, True, False, f"{test_name} {val} mmol/mol (Borderline 39-47)"
            else:
                return False, False, True, f"{test_name} {val} mmol/mol (Normal <39)"

    # Fasting Blood Sugar
    if any(k in name_clean for k in ["fbs", "fasting"]):
        if "mmol" in unit_clean or val < 25:
            if val >= 7.0:
                return True, False, False, f"{test_name} {val} mmol/L (Diabetic ≥7.0)"
            elif 5.6 <= val < 7.0:
                return False, True, False, f"{test_name} {val} mmol/L (Impaired 5.6-6.9)"
            else:
                return False, False, True, f"{test_name} {val} mmol/L (Normal)"
        else:
            if val >= 126:
                return True, False, False, f"{test_name} {val} mg/dL (Diabetic ≥126)"
            elif 100 <= val < 126:
                return False, True, False, f"{test_name} {val} mg/dL (Impaired 100-125)"
            else:
                return False, False, True, f"{test_name} {val} mg/dL (Normal <100)"

    # Post Prandial Blood Sugar
    if any(k in name_clean for k in ["ppbs", "post prandial"]):
        if val >= 200:
            return True, False, False, f"{test_name} {val} mg/dL (Diabetic ≥200)"
        elif 140 <= val < 200:
            return False, True, False, f"{test_name} {val} mg/dL (Impaired 140-199)"
        else:
            return False, False, True, f"{test_name} {val} mg/dL (Normal <140)"

    return False, False, False, f"{test_name}: {val_str}"


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

        # Check Labs
        for l in p_labs:
            t_name = str(l["test_name"]).strip()
            is_diab, is_border, is_norm, disp = evaluate_lab_test(
                t_name, l["value"], l["unit"], l["reference_range"]
            )
            col_date_str = format_date(l["collected_on_parsed"])
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
                # Top distinct drugs
                unique_drugs = sorted(set(d.split(" (")[0] for d in diab_rx_found))
                clinical_evidence.append(f"Rx: {', '.join(unique_drugs[:3])}")
            if pos_notes_found:
                clinical_evidence.append(f"Notes: {pos_notes_found[-1].split(': ')[-1][:50]}...")
            if abnormal_labs:
                clinical_evidence.append(f"Lab: {abnormal_labs[-1]}")
        elif abnormal_labs:
            # Abnormal lab findings only
            diabetes_category = "CONFIRMED_DIABETIC" # Flagged as diabetic via lab findings
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

        # High priority indicators (Insulin, HbA1c >= 9%, severe hyperglycemia notes)
        is_on_insulin = any("insulin" in r.lower() or "mixtard" in r.lower() for r in diab_rx_found)
        has_severe_hba1c = any("HbA1c" in l and any(x in l for x in [" 9.", " 10.", " 11.", " 12.", " 13."]) for l in abnormal_labs)
        has_severe_sugar_note = any(any(k in n.lower() for k in ["sugars running high", "sugars not under control", "burning soles", "dka"]) for n in pos_notes_found)
        is_high_risk = is_on_insulin or has_severe_hba1c or has_severe_sugar_note

        # -----------------------------------------------------------------
        # Evaluate Follow-Up Status (Tiered Rules & Baseline Resolution)
        # -----------------------------------------------------------------
        followup_status = "NOT_DUE"
        priority = "ROUTINE"
        reason_tokens = []
        target_date = None
        days_overdue = 0
        days_until = 0

        # Latest visit baseline
        latest_visit = p_visits[-1] if len(p_visits) > 0 else None
        latest_visit_date = latest_visit["visit_date_parsed"] if latest_visit is not None else None
        latest_dept = str(latest_visit["department"]).strip() if latest_visit is not None else ""
        latest_doctor = str(latest_visit["doctor"]).strip() if latest_visit is not None else ""
        latest_notes = str(latest_visit["notes"]).strip() if latest_visit and pd.notna(latest_visit["notes"]) else ""

        # Check for subsequent non-diabetic visit
        # Find latest diabetes-relevant visit
        last_diab_visit = None
        for v in p_visits:
            if v["department"] == "Diabetology" or POSITIVE_DIABETES_REGEX.search(str(v["notes"])):
                last_diab_visit = v

        flag_non_diab_visit = None
        if last_diab_visit and latest_visit and latest_visit["visit_id"] != last_diab_visit["visit_id"]:
            if latest_visit["department"] != "Diabetology" and not POSITIVE_DIABETES_REGEX.search(latest_notes):
                flag_non_diab_visit = f"Recent Non-Diabetic Visit: {latest_dept} on {format_date(latest_visit_date)} — Verify if diabetes was reviewed"

        if latest_visit is not None:
            # Check Tier 1: Explicit appointment from active baseline
            # Note: If an earlier visit had an appointment that passed, but the patient came later, that earlier one was superseded.
            active_appt = None
            for v in reversed(p_visits):
                if pd.notna(v["next_appt_parsed"]):
                    # Check if there was any visit on or after this appointment
                    had_subsequent = any(sub["visit_date_parsed"] >= v["next_appt_parsed"] for sub in p_visits if sub["visit_id"] != v["visit_id"])
                    if not had_subsequent:
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
                # Tier 2: Check review interval in notes of the latest visit
                interval_days, note_phrase = parse_review_interval(latest_notes)
                if interval_days is not None:
                    target_date = latest_visit_date + timedelta(days=interval_days)
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
                    # Tier 3: Fallback 4-month (120-day) rule
                    days_since_visit = (ref_date - latest_visit_date).days
                    if days_since_visit > 120:
                        followup_status = "OVERDUE"
                        days_overdue = days_since_visit - 120
                        reason_tokens = [
                            "4-Month Gap",
                            f"{days_overdue}d overdue",
                            f"Last visit: {format_date(latest_visit_date)} ({days_since_visit}d ago)"
                        ]
                    elif 105 <= days_since_visit <= 120:
                        followup_status = "DUE_SOON"
                        days_until = 120 - days_since_visit
                        reason_tokens = [
                            "Approaching 4 Months",
                            f"{days_until}d remaining",
                            f"Last visit: {format_date(latest_visit_date)}"
                        ]
                    else:
                        followup_status = "NOT_DUE"
                        reason_tokens = [f"Recent Visit ({days_since_visit}d ago)", "On Track"]

        # Assign Priority
        if followup_status == "OVERDUE":
            if is_high_risk:
                priority = "HIGH"
            else:
                priority = "MEDIUM"
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

        if is_deceased:
            worklist = "EXCLUDED"
            exclusion_reason = deceased_reason
        elif is_transferred:
            worklist = "EXCLUDED"
            exclusion_reason = transferred_reason
        elif diabetes_category == "NON_DIABETIC":
            worklist = "EXCLUDED"
            exclusion_reason = "Non-diabetic / Normal screening tests / Negated history"
        elif diabetes_category == "BORDERLINE_PREDIABETES":
            worklist = "CLINICAL_REVIEW"
            warning_flags.append("Prediabetes / Borderline Lab Results (HbA1c 5.7-6.4%)")
        elif diabetes_category == "CONFIRMED_DIABETIC":
            if followup_status == "OVERDUE":
                worklist = "OVERDUE"
            elif followup_status == "DUE_SOON":
                worklist = "DUE_SOON"
            else:
                worklist = "ON_TRACK"

        # Add human review warning flags
        if is_lab_only_diagnosis:
            warning_flags.append("Lab Diagnosis Only - Clinician verification recommended before call")
        if flag_non_diab_visit:
            warning_flags.append(flag_non_diab_visit)
        if not p["phone"]:
            warning_flags.append("Missing Phone Number on file")
        if mrn in duplicate_pairs:
            warning_flags.append(f"Duplicate Registration alert: Matches {', '.join(duplicate_pairs[mrn])}")
        if mrn in shared_family_phones:
            warning_flags.append(f"Shared Family Phone: Shared with {', '.join(shared_family_phones[mrn])}")

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
                "visit_date": format_date(latest_visit_date),
                "department": latest_dept,
                "doctor": latest_doctor,
                "notes": latest_notes
            } if latest_visit is not None else None,
            "history": {
                "total_visits": len(p_visits),
                "diabetology_visits": sum(1 for v in p_visits if str(v["department"]).lower() == "diabetology"),
                "prescriptions": [str(r["drug"]) for r in p_rx if ANTIDIABETIC_REGEX.search(str(r["drug"]))],
                "all_prescriptions": [f"{r['drug']} ({r['dose']})" for r in p_rx],
                "labs": [f"{l['test_name']}: {l['value']} {l['unit'] or ''}".strip() for l in p_labs]
            }
        }
        classified_patients.append(record)

    # 5. Export Datasets
    print("\n=== PIPELINE EXECUTION SUMMARY ===")
    counts = defaultdict(int)
    for r in classified_patients:
        counts[r["worklist"]] += 1
    for k, v in sorted(counts.items()):
        print(f"  Worklist '{k}': {v} patients")

    # Filter distinct mutually exclusive lists (sum = 300)
    overdue_list = [r for r in classified_patients if r["worklist"] == "OVERDUE"]
    due_soon_list = [r for r in classified_patients if r["worklist"] == "DUE_SOON"]
    on_track_list = [r for r in classified_patients if r["worklist"] == "ON_TRACK"]
    review_list = [r for r in classified_patients if r["worklist"] == "CLINICAL_REVIEW"]
    excluded_list = [r for r in classified_patients if r["worklist"] == "EXCLUDED"]

    total_accounted = len(overdue_list) + len(due_soon_list) + len(on_track_list) + len(review_list) + len(excluded_list)
    print(f"\nMutually Exclusive Bucket Partition (Total: {total_accounted} / {len(classified_patients)}):")
    print(f"  1. Overdue Call List: {len(overdue_list)}")
    print(f"  2. Due Soon Reminder List: {len(due_soon_list)}")
    print(f"  3. On Track / Up to Date: {len(on_track_list)}")
    print(f"  4. Clinical Review Queue (Borderline): {len(review_list)}")
    print(f"  5. Excluded (Deceased/Transferred/Non-Diabetic): {len(excluded_list)}")
    print(f"  SUM = {len(overdue_list)} + {len(due_soon_list)} + {len(on_track_list)} + {len(review_list)} + {len(excluded_list)} = {total_accounted}")

    # High priority vs Medium priority in Overdue
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
                "on_track_count": len(on_track_list),
                "clinical_review_count": len(review_list),
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
            "Reason For Call", "Clinical Evidence", "Action Flags", "Last Visit Date",
            "Last Department", "Last Doctor"
        ])
        # Sort by Priority (HIGH first) then Days Overdue descending
        sorted_overdue = sorted(overdue_list, key=lambda x: (0 if x["priority"] == "HIGH" else 1, -x["days_overdue"]))
        for r in sorted_overdue:
            writer.writerow([
                r["mrn"],
                r["name"],
                r["phone"],
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
    print(f"[+] Saved Overdue CSV to: {overdue_csv_path}")

    # Generate CSV 2: due_soon_diabetic_patients.csv
    due_soon_csv_path = os.path.join(export_dir, "due_soon_diabetic_patients.csv")
    with open(due_soon_csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "MRN", "Name", "Phone", "Days Remaining", "Target Follow-Up Date",
            "Reason For Reminder", "Clinical Evidence", "Action Flags", "Last Visit Date",
            "Last Department", "Last Doctor"
        ])
        sorted_due_soon = sorted(due_soon_list, key=lambda x: x["days_until"])
        for r in sorted_due_soon:
            writer.writerow([
                r["mrn"],
                r["name"],
                r["phone"],
                r["days_until"],
                r["target_date"],
                r["reason_summary"],
                "; ".join(r["clinical_evidence"]),
                "; ".join(r["warning_flags"]),
                r["latest_visit"]["visit_date"] if r["latest_visit"] else "",
                r["latest_visit"]["department"] if r["latest_visit"] else "",
                r["latest_visit"]["doctor"] if r["latest_visit"] else ""
            ])
    print(f"[+] Saved Due Soon CSV to: {due_soon_csv_path}")


if __name__ == "__main__":
    run_pipeline()
