"""Typed records for the organizer corpus."""

from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict


class LabResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    original_name: str
    value: Decimal | str
    unit: str = ""
    line: int


class PatientReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patient_id: str
    name: str
    age: int | None = None
    age_raw: str | None = None
    sex: Literal["male", "female"] | None = None
    sex_raw: str | None = None
    source_file: str
    results: list[LabResult]


class ReferenceRange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analyte: str
    low: Decimal | None
    high: Decimal | None
    age_min: int
    age_max: int
    sex: Literal["male", "female", "all"]
    unit: str = ""
    source_file: str
    source_row: str


class UrgentThreshold(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analyte: str
    operator: Literal["lt", "gt"]
    value: Decimal
    unit: str
    source_file: str
    source_row: str


class UnitConversion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analyte: str | None = None
    from_unit: str
    to_unit: str
    factor: Decimal
    source_file: str
    source_row: str


class Corpus(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patients: dict[str, PatientReport]
    ranges: list[ReferenceRange]
    urgent_thresholds: list[UrgentThreshold]
    aliases: dict[str, str]
    glossary: dict[str, str]
    conversions: list[UnitConversion]

