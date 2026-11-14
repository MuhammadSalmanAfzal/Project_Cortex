from decimal import Decimal
from pathlib import Path

from core.classify import BOUNDARY_ASSUMPTION, classify_result
from core.ingest import load_corpus
from core.ranges import select_range

DATA = Path(__file__).resolve().parents[1] / "lab_reports"


def test_range_endpoints_are_normal_including_biochemistry():
    corpus = load_corpus(DATA)
    alt = classify_result("SGPT", Decimal("45"), "U/L", 35, "female", corpus)
    cholesterol = classify_result("Cholesterol", Decimal("200"), "mg/dL", 55, "female", corpus)
    assert alt["status"] == "normal"
    assert cholesterol["status"] == "normal"
    assert BOUNDARY_ASSUMPTION in alt["trace"]
    assert BOUNDARY_ASSUMPTION in alt["explanation"]
    assert BOUNDARY_ASSUMPTION in cholesterol["trace"]


def test_age_and_sex_interval_boundaries():
    corpus = load_corpus(DATA)
    assert select_range("ALT", 18, "female", corpus).low == Decimal("7")
    assert select_range("ALT", 100, "female", corpus).high == Decimal("45")
    assert select_range("AST", 18, "male", corpus).high == Decimal("48")
    assert select_range("AST", 100, "female", corpus).high == Decimal("43")
    assert select_range("ALT", 101, "female", corpus) is None


def test_urgent_thresholds_are_strict_and_urgent_overrides_range():
    corpus = load_corpus(DATA)
    assert classify_result("Hemoglobin", Decimal("6.9"), "g/dL", 42, "female", corpus)["status"] == "urgent"
    assert classify_result("Hemoglobin", Decimal("7.0"), "g/dL", 42, "female", corpus)["status"] == "low"
    assert classify_result("Fasting Blood Sugar", Decimal("300"), "mg/dL", 45, "male", corpus)["status"] == "high"
    assert classify_result("Platelet Count", Decimal("50000"), "cells/mcL", 42, "female", corpus)["status"] == "low"
    assert classify_result("ALT", Decimal("1000"), "U/L", 48, "male", corpus)["status"] == "high"


def test_unknown_test_and_unsupported_unit_cannot_be_classified():
    corpus = load_corpus(DATA)
    unknown = classify_result("Serum Ferritin", Decimal("25"), "ng/mL", 22, "female", corpus)
    unsupported = classify_result("Fasting Blood Sugar", Decimal("6.0"), "mmol/L", 50, "male", corpus)
    assert unknown["status"] == "cannot_classify"
    assert unsupported["status"] == "cannot_classify"
    assert "no exact match" in unknown["reason"]
    assert "cannot be matched or converted" in unsupported["reason"]

