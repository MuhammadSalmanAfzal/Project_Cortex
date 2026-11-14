"""Age-, sex-, and unit-aware range lookup from parsed organizer rows."""

from __future__ import annotations

from core.models import Corpus, ReferenceRange
from core.names import normalize_name


def select_range(analyte: str, age: int, sex: str, corpus: Corpus) -> ReferenceRange | None:
    candidates = [
        item for item in corpus.ranges
        if normalize_name(item.analyte) == normalize_name(analyte)
        and item.age_min <= age <= item.age_max
        and item.sex in {"all", sex}
    ]
    # Prefer a sex-specific interval over an all-sex interval when both are present.
    candidates.sort(key=lambda item: item.sex == "all")
    return candidates[0] if candidates else None


def supported_age_bounds(corpus: Corpus) -> tuple[int, int] | None:
    if not corpus.ranges:
        return None
    return min(item.age_min for item in corpus.ranges), max(item.age_max for item in corpus.ranges)


def categorical_reference(row: ReferenceRange) -> str | None:
    if row.low is not None or row.high is not None:
        return None
    import re

    match = re.search(r":\s*([^()]+?)\s*\(Applicable to", row.source_row, re.I)
    return match.group(1).strip() if match else None

