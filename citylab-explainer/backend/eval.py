"""Print a hand-checkable per-test result table for all sample reports."""

from __future__ import annotations

from core.ingest import load_corpus
from core.service import analyze_patient


def _cell(value: object) -> str:
    return str(value if value is not None else "—").replace("|", "\\|").replace("\n", " ")


def verification_table() -> str:
    corpus = load_corpus()
    output = [
        "| Patient | Age | Sex | Test | Value | Unit | Status | Reason |",
        "|---|---:|---|---|---:|---|---|---|",
    ]
    for patient_id, patient in sorted(corpus.patients.items()):
        analysis = analyze_patient(patient_id, corpus)
        age = patient.age if patient.age is not None else (patient.age_raw or "missing")
        sex = patient.sex if patient.sex is not None else (patient.sex_raw or "missing")
        rows = analysis["tests"]
        if not rows:
            output.append("| " + " | ".join(map(_cell, [f"{patient_id} {patient.name}", age, sex, "—", "—", "—", "no_results", "No structured results were parsed."])) + " |")
        for row in rows:
            output.append("| " + " | ".join(map(_cell, [
                f"{patient_id} {patient.name}", age, sex, row["original_name"], row["value"],
                row["original_unit"] or "(none)", row["status"], row["reason"],
            ])) + " |")
    return "\n".join(output)


if __name__ == "__main__":
    print(verification_table())

