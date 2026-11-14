from pathlib import Path

from core.ingest import load_corpus
from core.names import canonical_name, normalize_name


def test_normalizes_case_whitespace_and_punctuation():
    assert normalize_name("  fasting  blood-sugar! ") == "fastingbloodsugar"


def test_resolves_only_names_and_aliases_from_files():
    corpus = load_corpus(Path(__file__).resolve().parents[1] / "lab_reports")
    aliases = {
        "SGPT": "ALT",
        "SGOT": "AST",
        "FBS": "Fasting Blood Sugar",
        "Hb": "Hemoglobin",
        "PLT": "Platelet Count",
        "RBC": "Red Blood Cell Count",
        "WBC": "White Blood Cell Count",
    }
    for alias, expected in aliases.items():
        assert corpus.aliases[alias] == expected
        assert canonical_name(alias.lower(), corpus) == expected
    assert canonical_name(" hemoglobin!!! ", corpus) == "Hemoglobin"
    assert canonical_name("Hemoglobin A1c", corpus) is None
    assert canonical_name("pH Level", corpus) is None

