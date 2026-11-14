"""Exact, files-derived test-name matching."""

from __future__ import annotations

import re

from core.models import Corpus


def normalize_name(name: str) -> str:
    """Ignore case, whitespace, and punctuation while preserving all letters/digits."""
    return re.sub(r"[^a-z0-9]", "", name.casefold())


def canonical_name(name: str, corpus: Corpus) -> str | None:
    """Resolve exact normalized names and aliases found in the glossary only."""
    key = normalize_name(name)
    canonical_by_key = {normalize_name(item.analyte): item.analyte for item in corpus.ranges}
    if key in canonical_by_key:
        return canonical_by_key[key]
    aliases = {normalize_name(alias): canonical for alias, canonical in corpus.aliases.items()}
    target = aliases.get(key)
    if target is None:
        return None
    return canonical_by_key.get(normalize_name(target), target)

