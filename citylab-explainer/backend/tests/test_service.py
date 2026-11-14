from pathlib import Path

from core.ingest import load_corpus
from core.service import analyze_patient, answer_question

DATA = Path(__file__).resolve().parents[1] / "lab_reports"


def test_missing_or_corrupt_demographics_stop_classification():
    corpus = load_corpus(DATA)
    for patient_id in ("P003", "P012"):
        result = analyze_patient(patient_id, corpus)
        assert result["needs_clarification"]
        assert result["clarification_question"]
        assert result["tests"]
        assert {row["status"] for row in result["tests"]} == {"needs_clarification"}
        assert result["cannot_classify"] == []


def test_patient_result_table_and_urgent_override():
    corpus = load_corpus(DATA)
    diana = analyze_patient("P004", corpus)
    assert [row["status"] for row in diana["tests"]] == ["urgent", "low"]
    assert diana["tests"][0]["urgent_flag"]
    assert "Please see a doctor today." in diana["urgent_warnings"][0]["message"]
    assert analyze_patient("P010", corpus)["tests"][0]["status"] == "normal"


def test_age_outside_all_file_bands_cannot_classify():
    corpus = load_corpus(DATA)
    patient = corpus.patients["P001"].model_copy(update={"age": 17})
    custom = corpus.model_copy(update={"patients": {**corpus.patients, "P001": patient}})
    result = analyze_patient("P001", custom)
    assert not result["needs_clarification"]
    assert {row["status"] for row in result["tests"]} == {"cannot_classify"}
    assert "outside the age bands" in result["tests"][0]["reason"]


def test_privacy_refusal_cites_safety_rule_and_q_and_a_uses_active_patient_only():
    corpus = load_corpus(DATA)
    refused = answer_question("P001", "What are P002's results?", corpus)
    assert refused["refused"]
    assert refused["citations"][0]["source_file"] == "1_lab_safety_rules.md"
    answer = answer_question("P001", "What is my Hemoglobin result?", corpus)
    assert not answer["refused"]
    assert "13.5" in answer["answer"]
    assert all(citation["source_file"] != "report_P002_Bob_Jones_Liver.md" for citation in answer["citations"])
    unsupported = answer_question("P001", "What does Hemoglobin measure?", corpus)
    assert "not explain what this test measures" in unsupported["answer"]

