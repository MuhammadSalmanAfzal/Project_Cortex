from decimal import Decimal

from core.models import UnitConversion
from core.units import convert_value, normalize_unit


def test_unit_normalization_does_not_confuse_different_units():
    assert normalize_unit(" mg/dL ") == normalize_unit("MG/dL")
    assert normalize_unit("mg/dL") != normalize_unit("mmol/L")


def test_same_unit_needs_no_conversion_factor():
    result = convert_value(Decimal("85"), "mg/dL", "mg/dL", "Fasting Blood Sugar", [])
    assert result.compatible and result.value == Decimal("85") and not result.shown


def test_conversion_requires_a_file_sourced_factor_and_supports_reverse():
    factors = [UnitConversion(
        analyte="Analyte A", from_unit="unit-x", to_unit="unit-y", factor=Decimal("2"),
        source_file="test-source.md", source_row="| Analyte A | unit-x | unit-y | 2 |",
    )]
    forward = convert_value(Decimal("3"), "unit-x", "unit-y", "Analyte A", factors)
    reverse = convert_value(Decimal("6"), "unit-y", "unit-x", "Analyte A", factors)
    assert forward.compatible and forward.value == Decimal("6") and forward.factor == Decimal("2")
    assert reverse.compatible and reverse.value == Decimal("3") and reverse.factor == Decimal("0.5")
    unsupported = convert_value(Decimal("6"), "unit-z", "unit-y", "Analyte A", factors)
    assert not unsupported.compatible

