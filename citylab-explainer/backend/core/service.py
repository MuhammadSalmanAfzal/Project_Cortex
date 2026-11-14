"""Public patient analysis and files-only follow-up question functions."""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

from core.classify import classify_result
from core.ingest import DEFAULT_DATA_DIR, load_corpus
from core.models import Corpus, PatientReport
from core.names import canonical_name, normalize_name
from core.ranges import supported_age_bounds


@lru_cache(maxsize=1)
def _default_corpus() -> Corpus:
    return load_corpus(DEFAULT_DATA_DIR)


def _status_for_demographics(patient: PatientReport) -> tuple[bool, str | None]:
    missing: list[str] = []
    if patient.age is None:
        missing.append("age")
    if patient.sex is None:
        missing.append("biological sex at birth")
    if not missing:
        return False, None
    requested = " and ".join(missing)
    return True, f"Please provide the patient's {requested}. The safety rules say not to guess when demographics are missing or invalid."


def _clarification_result(original: str, value, unit: str, canonical: str | None, question: str) -> dict:
    return {
        "original_name": original,
        "canonical_name": canonical,
        "value": value,
        "original_unit": unit,
        "converted_value": value,
        "converted_unit": unit,
        "conversion_shown": None,
        "range_used": None,
        "status": "needs_clarification",
        "urgent_flag": False,
        "trace": ["Safety rule: 1_lab_safety_rules.md, Core Operational Directives, rule 3."],
        "explanation": question,
        "reason": question,
    }


def analyze_patient(patient_id: str, corpus: Corpus | None = None) -> dict:
    """Analyze only the requested active patient from the organizer corpus."""
    corpus = corpus or _default_corpus()
    key = patient_id.strip().upper()
    patient = corpus.patients.get(key)
    if patient is None:
        raise KeyError(f"Unknown patient ID: {patient_id}")

    needs_clarification, question = _status_for_demographics(patient)
    bounds = supported_age_bounds(corpus)
    age_outside = bool(bounds and patient.age is not None and not (bounds[0] <= patient.age <= bounds[1]))
    rows: list[dict] = []
    cannot: list[dict] = []

    for item in patient.results:
        if needs_clarification:
            row = _clarification_result(item.original_name, item.value, item.unit, canonical_name(item.original_name, corpus), question or "")
        elif age_outside:
            canonical = canonical_name(item.original_name, corpus)
            reason = f"Age {patient.age} is outside the age bands supported by the files ({bounds[0]}-{bounds[1]} years)."
            row = {
                "original_name": item.original_name,
                "canonical_name": canonical,
                "value": item.value,
                "original_unit": item.unit,
                "converted_value": item.value,
                "converted_unit": item.unit,
                "conversion_shown": None,
                "range_used": None,
                "status": "cannot_classify",
                "urgent_flag": False,
                "trace": ["Age-band validation: no source range covers this age."],
                "explanation": "This result cannot be classified from the files because the patient's age is outside every listed age band.",
                "reason": reason,
            }
        else:
            # The demographic gate above guarantees age and sex are present here.
            row = classify_result(item.original_name, item.value, item.unit, patient.age, patient.sex, corpus)  # type: ignore[arg-type]
        rows.append(row)
        if row["status"] == "cannot_classify":
            cannot.append({"test": row["original_name"], "reason": row["reason"]})

    urgent_warnings = [
        {"test": row["canonical_name"], "message": "A result crossed a critical limit listed in the files. Please see a doctor today."}
        for row in rows if row["urgent_flag"]
    ]
    non_normal = [row for row in rows if row["status"] in {"low", "high", "urgent", "cannot_classify"}]
    questions: list[str] = []
    if non_normal:
        for row in non_normal[:3]:
            questions.append(f"Could you explain how {row['original_name']} compares with the information in the report?")
        while len(questions) < 3:
            questions.append("What follow-up, if any, do you recommend for these results?")
    return {
        "patient_id": patient.patient_id,
        "patient_name": patient.name,
        "age": patient.age,
        "biological_sex": patient.sex,
        "source_file": patient.source_file,
        "needs_clarification": needs_clarification,
        "clarification_question": question,
        "tests": rows,
        "cannot_classify": cannot,
        "doctor_questions": questions,
        "urgent_warnings": urgent_warnings,
        "disclaimer": "This tool compares results with the supplied files and does not diagnose. Only a licensed doctor can diagnose.",
    }


def _other_patient_mentioned(patient_id: str, question: str, corpus: Corpus) -> str | None:
    active = patient_id.upper()
    for report in corpus.patients.values():
        if report.patient_id == active:
            continue
        if re.search(rf"(?<![A-Z0-9]){re.escape(report.patient_id)}(?![A-Z0-9])", question, re.I):
            return report.patient_id
        normalized_question = normalize_name(question)
        name_parts = [normalize_name(part) for part in report.name.split() if len(part) >= 4]
        if normalize_name(report.name) in normalized_question or any(part in normalized_question for part in name_parts):
            return report.patient_id
    return None


def answer_question(patient_id: str, question: str, corpus: Corpus | None = None) -> dict:
    """Answer from the active patient's parsed report, ranges, and glossary only."""
    corpus = corpus or _default_corpus()
    key = patient_id.strip().upper()
    if key not in corpus.patients:
        raise KeyError(f"Unknown patient ID: {patient_id}")
    other = _other_patient_mentioned(key, question, corpus)
    if other:
        return {
            "patient_id": key,
            "refused": True,
            "answer": "I can only discuss the active patient's report and cannot provide another patient's results.",
            "citations": [{"source_file": "1_lab_safety_rules.md", "rule": "Core Operational Directives, rule 1"}],
        }

    analysis = analyze_patient(key, corpus)
    normalized_question = normalize_name(question)
    matched = []
    for row in analysis["tests"]:
        candidates = [row["original_name"], row["canonical_name"]]
        if any(candidate and normalize_name(candidate) in normalized_question for candidate in candidates):
            matched.append(row)

    if matched:
        # The corpus has alias mappings but no plain-language descriptions of tests.
        if re.search(r"\b(?:meaning|definition|define|function of)\b|\bwhat does\b.*\bmeasure", question, re.I):
            answer = "The files do not explain what this test measures or what its result may mean."
            citations = [{"source_file": "2_medical_glossary.md", "detail": "The glossary lists aliases only."}]
        else:
            parts = [
                f"{row['original_name']}: {row['value']} {row['original_unit']} — {row['status']} ({row['reason']})"
                for row in matched
            ]
            answer = " ".join(parts)
            citations = [{"source_file": analysis["source_file"]}]
            citations.extend(
                {"source_file": row["range_used"]["source_file"], "range_row": row["trace"][1] if len(row["trace"]) > 1 else ""}
                for row in matched if row.get("range_used")
            )
        return {"patient_id": key, "refused": False, "answer": answer, "citations": citations}

    if re.search(r"\b(?:my results|my tests|my report|all results|all tests)\b", question, re.I):
        answer = "; ".join(
            f"{row['original_name']}: {row['value']} {row['original_unit']} ({row['status']})"
            for row in analysis["tests"]
        ) or "No test results were parsed from the active patient's report."
        return {"patient_id": key, "refused": False, "answer": answer, "citations": [{"source_file": analysis["source_file"]}]}

    return {
        "patient_id": key,
        "refused": False,
        "answer": "That information is not covered in the files.",
        "citations": [{"source_file": "2_medical_glossary.md", "detail": "No supporting explanation was found."}],
    }

