"""Unit checking and conversions using explicit factors found in source files."""

from __future__ import annotations

import re
from decimal import Decimal
from typing import NamedTuple

from core.models import UnitConversion


class Conversion(NamedTuple):
    compatible: bool
    value: Decimal | str
    unit: str
    shown: bool
    factor: Decimal | None


def normalize_unit(unit: str) -> str:
    return re.sub(r"[^a-z0-9]", "", unit.casefold())


def convert_value(
    value: Decimal | str,
    from_unit: str,
    to_unit: str,
    analyte: str,
    conversions: list[UnitConversion],
) -> Conversion:
    """Return converted value only for same units or an explicit source-file factor.

    Reverse conversion uses the reciprocal of an explicit forward factor; no medical
    constants or built-in unit relationships are supplied.
    """
    if normalize_unit(from_unit) == normalize_unit(to_unit):
        return Conversion(True, value, to_unit, False, None)
    if not isinstance(value, Decimal):
        return Conversion(False, value, from_unit, False, None)

    wanted_from = normalize_unit(from_unit)
    wanted_to = normalize_unit(to_unit)
    wanted_test = re.sub(r"[^a-z0-9]", "", analyte.casefold())
    for entry in conversions:
        if entry.analyte and re.sub(r"[^a-z0-9]", "", entry.analyte.casefold()) != wanted_test:
            continue
        source = normalize_unit(entry.from_unit)
        target = normalize_unit(entry.to_unit)
        if source == wanted_from and target == wanted_to:
            factor = entry.factor
        elif source == wanted_to and target == wanted_from and entry.factor != 0:
            factor = Decimal(1) / entry.factor
        else:
            continue
        return Conversion(True, value * factor, to_unit, True, factor)
    return Conversion(False, value, from_unit, False, None)

