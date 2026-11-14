"""Load organizer Markdown into typed records, ignoring report appendices."""

from __future__ import annotations

import logging
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path

from core.models import (
    Corpus,
    LabResult,
    PatientReport,
    ReferenceRange,
    UnitConversion,
    UrgentThreshold,
)

logger = logging.getLogger(__name__)
DEFAULT_DATA_DIR = Path(__file__).resolve().parents[1] / "lab_reports"


def _strip_md(value: str) -> str:
    return re.sub(r"\*\*|`", "", value).strip()


def _cell(value: str) -> str:
    return _strip_md(value.strip().strip("|"))


def _number(value: str) -> Decimal | None:
    try:
        return Decimal(value.replace(",", "").strip())
    except (InvalidOperation, AttributeError):
        return None


def _parse_value_and_unit(raw: str) -> tuple[Decimal | str, str] | None:
    raw = _strip_md(raw).strip().strip("*").strip()
    match = re.match(r"^([+-]?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+))\s*(.*?)\s*$", raw)
    if match:
        number = _number(match.group(1))
        if number is not None:
            return number, match.group(2).strip()
    # Qualitative results are preserved; their meaning is decided only by a source range.
    if raw and not re.search(r"\b(?:appendix|section|patient|report)\b", raw, re.I):
        return raw, ""
    return None


def _parse_sex(raw: str | None) -> str | None:
    if raw is None:
        return None
    norm = re.sub(r"[^a-z]", "", raw.casefold())
    if norm in {"male", "m"}:
        return "male"
    if norm in {"female", "f"}:
        return "female"
    return None


def _parse_report(path: Path) -> PatientReport | None:
    text = path.read_text(encoding="utf-8", errors="replace")
    text = re.split(r"(?im)^\s*###\s*APPENDIX\b", text, maxsplit=1)[0]
    patient_match = re.search(r"(?i)report_P(\d{3})_", path.name)
    if not patient_match:
        logger.warning("Skipping report without a patient ID: %s", path.name)
        return None
    patient_id = f"P{patient_match.group(1)}"

    def field(label: str) -> str | None:
        label_pattern = re.compile(rf"^{label}\s*:\s*(.*?)\s*$", re.I)
        for source_line in text.splitlines():
            candidate = _strip_md(source_line).lstrip("*- ").strip()
            match = label_pattern.match(candidate)
            if match:
                return match.group(1).strip()
        return None

    name = field(r"Patient Full Name") or ""
    age_raw = field(r"Recorded Age")
    age_match = re.fullmatch(r"\d+", age_raw or "")
    age = int(age_match.group()) if age_match else None
    sex_raw = field(r"Biological Sex")
    sex = _parse_sex(sex_raw)

    result_section = re.split(r"(?im)^\s*##\s*SECTION III:\s*ANALYTICAL RESULTS\s*$", text, maxsplit=1)
    result_text = result_section[1] if len(result_section) == 2 else ""
    results: list[LabResult] = []
    pending_name: str | None = None
    table_header: list[str] | None = None
    for line_number, line in enumerate(result_text.splitlines(), 1):
        stripped = line.strip()
        if not stripped:
            continue

        # Markdown result tables with varied but explicit column headings.
        if stripped.startswith("|"):
            cells = [_cell(c) for c in stripped.strip("|").split("|")]
            lowered = [re.sub(r"[^a-z]", "", c.casefold()) for c in cells]
            if any(k in lowered for k in ("test", "testname", "analyte", "analytename")):
                table_header = lowered
                continue
            if all(re.fullmatch(r":?-{2,}:?", c.strip()) for c in cells):
                continue
            if table_header:
                try:
                    name_idx = next(i for i, c in enumerate(table_header) if c in {"test", "testname", "analyte", "analytename"})
                    value_idx = next(i for i, c in enumerate(table_header) if c in {"value", "result", "valuerecorded"})
                    unit_idx = next((i for i, c in enumerate(table_header) if c in {"unit", "units"}), None)
                    raw_value = cells[value_idx]
                    value_unit = _parse_value_and_unit(raw_value)
                    if value_unit is None:
                        logger.warning("Skipping malformed result row %s:%d", path.name, line_number)
                        continue
                    value, embedded_unit = value_unit
                    unit = cells[unit_idx] if unit_idx is not None and unit_idx < len(cells) else embedded_unit
                    if isinstance(value, str) and embedded_unit:
                        unit = embedded_unit
                    results.append(LabResult(original_name=cells[name_idx], value=value, unit=unit, line=line_number))
                except (StopIteration, IndexError, ValueError):
                    logger.warning("Skipping malformed table row %s:%d", path.name, line_number)
                continue

        plain = re.match(r"(?i)^\s*(?:[-*]\s*)?(?:\*\*)?(Test Conducted|Test Name|Test)\s*:\s*(.*?)\s*(?:\*\*)?\s*$", stripped)
        if plain:
            pending_name = _strip_md(plain.group(2))
            continue
        plain_result = re.match(r"(?i)^\s*(?:[-*]\s*)?(?:\*\*)?(?:Value Recorded|Result|Value)\s*:\s*(.*?)\s*(?:\*\*)?\s*$", stripped)
        if plain_result and pending_name:
            value_unit = _parse_value_and_unit(plain_result.group(1))
            if value_unit:
                value, unit = value_unit
                results.append(LabResult(original_name=pending_name, value=value, unit=unit, line=line_number))
            else:
                logger.warning("Skipping malformed plain result %s:%d", path.name, line_number)
            pending_name = None
            continue

        arrow = re.match(r"^\s*[-*]?\s*(?:\*\*)?(.+?)(?:\*\*)?\s*->\s*(.*?)\s*$", stripped)
        if arrow:
            value_unit = _parse_value_and_unit(arrow.group(2))
            if value_unit:
                value, unit = value_unit
                results.append(LabResult(original_name=_strip_md(arrow.group(1)), value=value, unit=unit, line=line_number))
            else:
                logger.warning("Skipping malformed arrow result %s:%d", path.name, line_number)
            continue

        # Bullet result: - Name: 5.2 unit, with optional Markdown emphasis.
        bullet = re.match(r"^\s*[-*]\s+(?:\*\*)?([^:]+?)(?:\*\*)?\s*:\s*(.*?)\s*$", stripped)
        if bullet:
            test_name = _strip_md(bullet.group(1))
            if re.search(r"^(?:Patient Full Name|Recorded Age|Biological Sex|Medical Record Number|Date of Issuance)$", test_name, re.I):
                continue
            value_unit = _parse_value_and_unit(bullet.group(2))
            if value_unit:
                value, unit = value_unit
                results.append(LabResult(original_name=test_name, value=value, unit=unit, line=line_number))
            else:
                logger.warning("Skipping malformed bullet result %s:%d", path.name, line_number)

        # Plain result form such as `TSH: 2.5 mIU/L`.
        plain_value = re.match(r"^\s*(?![-*])([^:]+?)\s*:\s*(.*?)\s*$", stripped)
        if plain_value:
            value_unit = _parse_value_and_unit(plain_value.group(2))
            if value_unit:
                value, unit = value_unit
                results.append(LabResult(original_name=_strip_md(plain_value.group(1)), value=value, unit=unit, line=line_number))

    if not name:
        logger.warning("Skipping report with no patient name: %s", path.name)
        return None
    return PatientReport(
        patient_id=patient_id,
        name=name,
        age=age,
        age_raw=age_raw,
        sex=sex,  # type: ignore[arg-type]
        sex_raw=sex_raw,
        source_file=path.name,
        results=results,
    )


def _clean_table_row(line: str) -> list[str]:
    return [_cell(cell) for cell in line.strip().strip("|").split("|")]


def _parse_aliases(path: Path) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = re.search(r"\*\*(.+?)\*\*\s+(?:is the exact equivalent of|maps to)\s+\*\*(.+?)\*\*", line, re.I)
        if match:
            alias, canonical = match.groups()
            aliases[alias] = canonical
    return aliases


def _parse_range_file(path: Path) -> list[ReferenceRange]:
    text = path.read_text(encoding="utf-8", errors="replace")
    text = re.split(r"(?im)^\s*###\s*APPENDIX\b", text, maxsplit=1)[0]
    ranges: list[ReferenceRange] = []

    if path.name == "4_ranges_hematology.md":
        current: str | None = None
        for line in text.splitlines():
            heading = re.match(r"^\s*\*\s+\*\*(.+?)\*\*:\s*$", line)
            if heading:
                current = _strip_md(heading.group(1)).split(" (", 1)[0]
                continue
            row = re.match(r"^\s*\*\s+(Male|Female|All Sexes).*?\((\d+)-(\d+)\s+yrs?\):\s*([^\s]+)\s*-\s*([^\s]+)\s*(.*?)\s*$", line, re.I)
            if row and current:
                sex, age_min, age_max, low, high, unit = row.groups()
                low_n, high_n = _number(low), _number(high)
                if low_n is None or high_n is None:
                    logger.warning("Skipping malformed range row %s: %s", path.name, line.strip())
                    continue
                ranges.append(ReferenceRange(
                    analyte=current, low=low_n, high=high_n, age_min=int(age_min), age_max=int(age_max),
                    sex=sex.casefold() if sex.casefold() != "all sexes" else "all", unit=unit.strip(),
                    source_file=path.name, source_row=line.strip(),
                ))

    elif path.name == "5_ranges_biochemistry.md":
        header: list[str] | None = None
        for line in text.splitlines():
            if not line.strip().startswith("|"):
                continue
            cells = _clean_table_row(line)
            normalized = [re.sub(r"[^a-z]", "", c.casefold()) for c in cells]
            if "analytename" in normalized:
                header = normalized
                continue
            if not header or all(re.fullmatch(r":?-{2,}:?", cell) for cell in cells):
                continue
            try:
                row = dict(zip(header, cells))
                analyte = row["analytename"]
                low = _number(row["minnormallimit"])
                high = _number(row["maxnormallimit"])
                if low is None or high is None:
                    raise ValueError("invalid numeric limits")
                sex_raw = row["biologicalsex"].casefold()
                sex = "all" if sex_raw == "all" else sex_raw
                ranges.append(ReferenceRange(
                    analyte=analyte, low=low, high=high, age_min=int(row["agemin"]), age_max=int(row["agemax"]),
                    sex=sex, unit=row["standardunit"], source_file=path.name, source_row=line.strip(),
                ))
            except (KeyError, ValueError) as exc:
                logger.warning("Skipping malformed range row %s: %s", path.name, exc)

    elif path.name == "6_ranges_thyroid_urine.md":
        for line in text.splitlines():
            match = re.match(r"^\s*\*\s+\*\*(.+?)\*\*:\s*(.*?)\s*\(Applicable to\s+(All sexes|Male|Female),\s*(\d+)-(\d+)\s+yrs?\)\.?\s*$", line, re.I)
            if not match:
                continue
            analyte, limits, sex_raw, age_min, age_max = match.groups()
            numeric = re.match(r"^([+-]?(?:\d+(?:\.\d+)?))\s*-\s*([+-]?(?:\d+(?:\.\d+)?))\s*(.*)$", limits)
            if numeric:
                low, high = _number(numeric.group(1)), _number(numeric.group(2))
                unit = numeric.group(3).strip()
            else:
                low, high, unit = None, None, ""
                # A single categorical reference value is represented as a point range.
                ranges.append(ReferenceRange(
                    analyte=analyte, low=None, high=None, age_min=int(age_min), age_max=int(age_max),
                    sex="all" if sex_raw.casefold() == "all sexes" else sex_raw.casefold(), unit="",
                    source_file=path.name, source_row=line.strip(),
                ))
                continue
            if low is not None and high is not None:
                ranges.append(ReferenceRange(
                    analyte=analyte, low=low, high=high, age_min=int(age_min), age_max=int(age_max),
                    sex="all" if sex_raw.casefold() == "all sexes" else sex_raw.casefold(), unit=unit,
                    source_file=path.name, source_row=line.strip(),
                ))
    return ranges


def _parse_urgent(path: Path) -> list[UrgentThreshold]:
    text = re.split(r"(?im)^\s*###\s*APPENDIX\b", path.read_text(encoding="utf-8", errors="replace"), maxsplit=1)[0]
    result: list[UrgentThreshold] = []
    for line in text.splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = _clean_table_row(line)
        if len(cells) < 4 or re.search(r"analyte|condition", " ".join(cells), re.I):
            continue
        analyte = _strip_md(cells[0])
        condition = cells[1].casefold()
        value = _number(cells[2])
        if value is None:
            continue
        if "less than" in condition or re.search(r"<", condition):
            operator = "lt"
        elif "greater than" in condition or re.search(r">", condition):
            operator = "gt"
        else:
            logger.warning("Skipping unsupported urgent condition: %s", line.strip())
            continue
        result.append(UrgentThreshold(
            analyte=analyte, operator=operator, value=value, unit=cells[3],
            source_file=path.name, source_row=line.strip(),
        ))
    return result


def _parse_conversions(paths: list[Path]) -> list[UnitConversion]:
    """Read only explicit factor tables; never infer or supply conversion factors."""
    conversions: list[UnitConversion] = []
    for path in paths:
        text = re.split(r"(?im)^\s*###\s*APPENDIX\b", path.read_text(encoding="utf-8", errors="replace"), maxsplit=1)[0]
        lines = text.splitlines()
        header: list[str] | None = None
        for line in lines:
            if not line.strip().startswith("|"):
                continue
            cells = _clean_table_row(line)
            normalized = [re.sub(r"[^a-z]", "", c.casefold()) for c in cells]
            if any(c in {"fromunit", "sourceunit"} for c in normalized) and any(c in {"tounit", "targetunit"} for c in normalized) and "factor" in normalized:
                header = normalized
                continue
            if not header:
                continue
            try:
                row = dict(zip(header, cells))
                from_unit = row.get("fromunit", row.get("sourceunit", ""))
                to_unit = row.get("tounit", row.get("targetunit", ""))
                factor = _number(row["factor"])
                if from_unit and to_unit and factor is not None:
                    conversions.append(UnitConversion(
                        analyte=row.get("analyte") or row.get("test") or None,
                        from_unit=from_unit, to_unit=to_unit, factor=factor,
                        source_file=path.name, source_row=line.strip(),
                    ))
            except (KeyError, ValueError):
                logger.warning("Skipping malformed conversion row %s", path.name)
    return conversions


def load_corpus(data_dir: Path | str = DEFAULT_DATA_DIR) -> Corpus:
    """Parse reports and reference data from organizer files only."""
    root = Path(data_dir)
    patients: dict[str, PatientReport] = {}
    for path in sorted(root.glob("report_*.md")):
        try:
            patient = _parse_report(path)
            if patient:
                if patient.patient_id in patients:
                    logger.warning("Duplicate patient ID %s; keeping first report", patient.patient_id)
                    continue
                patients[patient.patient_id] = patient
        except Exception as exc:  # malformed corpus files must not stop startup
            logger.warning("Skipping malformed report %s: %s", path.name, exc)

    aliases_path = root / "2_medical_glossary.md"
    aliases = _parse_aliases(aliases_path) if aliases_path.exists() else {}
    glossary = {alias: canonical for alias, canonical in aliases.items()}
    ranges = []
    for filename in ("4_ranges_hematology.md", "5_ranges_biochemistry.md", "6_ranges_thyroid_urine.md"):
        path = root / filename
        if path.exists():
            ranges.extend(_parse_range_file(path))
    urgent_path = root / "3_dangerous_urgent_values.md"
    urgent = _parse_urgent(urgent_path) if urgent_path.exists() else []
    reference_paths = [root / name for name in (
        "1_lab_safety_rules.md", "2_medical_glossary.md", "3_dangerous_urgent_values.md",
        "4_ranges_hematology.md", "5_ranges_biochemistry.md", "6_ranges_thyroid_urine.md",
    ) if (root / name).exists()]
    conversions = _parse_conversions(reference_paths)
    return Corpus(patients=patients, ranges=ranges, urgent_thresholds=urgent, aliases=aliases, glossary=glossary, conversions=conversions)

