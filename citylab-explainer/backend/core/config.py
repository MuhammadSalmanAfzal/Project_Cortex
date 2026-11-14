"""Deterministic classification configuration."""

from core.models import Corpus, UnitConversion

# The hematology sheet says both endpoints are normal. The other sheets are silent;
# this documented convention is applied consistently to every numeric range.
ENDPOINTS_INCLUSIVE = True


def unit_conversion_table(corpus: Corpus) -> list[UnitConversion]:
    """Conversion factors parsed from organizer files; empty for the supplied corpus."""
    return corpus.conversions

