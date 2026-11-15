"""percentile and category follow the contract's definitions (R9, R16, R26).

The percentile is the mid-rank of the value; the category compares the value with the published p25, p75, p90 and
max, the same numbers the frontend draws as the level legend.
"""

import numpy as np
import pytest

from app import stats


def level(value: float, base: dict) -> str:
    """The level of the value on the published baseline numbers (frontend: levelBands)."""
    v = stats.r1(value)
    if v < base["p25"]:
        return "below_normal"
    if v <= base["p75"]:
        return "normal"
    if v <= base["p90"]:
        return "above_normal"
    return "high"


def classify(sample, value, in_baseline=True):
    p = stats.percentile_of(sample, value)
    return p, stats.category(value, stats.baseline_stats(sample), in_baseline)


def test_zero_month_among_zero_years_is_the_middle_not_the_top():
    assert classify([0.0] * 25, 0.0) == (50.0, "normal")
    # 22 of 25 years without fires: a zero month sits in the middle of the tie, and p25 = p75 = 0
    sample = [0.0] * 22 + [3.0, 5.0, 8.0]
    assert classify(sample, 0.0) == (44.0, "normal")


def test_mid_rank_values():
    sample = list(range(1, 11))  # 1..10
    assert stats.percentile_of(sample, 5) == 45.0  # 4 below, 1 equal
    assert stats.percentile_of(sample, 0) == 0.0
    assert stats.percentile_of(sample, 11) == 100.0
    assert stats.percentile_of([], 1) is None


@pytest.mark.parametrize(
    ("value", "in_baseline", "expected"),
    [
        (24.9, True, "below_normal"),
        (25.0, True, "normal"),  # exactly p25 is normal
        (75.0, True, "normal"),  # exactly p75 is normal
        (75.1, True, "above_normal"),
        (90.0, True, "above_normal"),  # exactly p90 is still above_normal
        (90.1, True, "high"),
        (100.0, True, "high"),  # the maximum itself is high
        (100.0, False, "high"),
        (100.1, False, "record"),
    ],
)
def test_level_boundaries(value, in_baseline, expected):
    sample = [float(x) for x in range(0, 101, 10)]  # n = 11
    base = stats.baseline_stats(sample)
    assert (base["p25"], base["p75"], base["p90"], base["max"]) == (25.0, 75.0, 90.0, 100.0)
    assert stats.category(value, base, in_baseline) == expected


def test_category_follows_thresholds_not_rank():
    # like Northern Kazakhstan in November 2026: 25 years, the value lies above the interpolated p90 but below the
    # 23rd year, so its mid-rank is 88; the legend shows it in "High", and so must the category
    sample = [float(x) for x in range(10, 220, 10)] + [400.0, 500.0, 600.0, 900.0]
    base = stats.baseline_stats(sample)
    assert (base["p90"], base["max"]) == (460.0, 900.0)
    p, c = classify(sample, 480.0, in_baseline=False)
    assert (p, c) == (88.0, "high")


def test_rounded_value_is_compared_with_rounded_sample():
    # the published (rounded) value and the unrounded one get the same rank, so the payload is self-consistent
    sample = [float(x) for x in range(100, 124)] + [399.21726]
    assert stats.percentile_of(sample, 399.2) == stats.percentile_of(sample, 399.21726)
    # record needs a rounded value above the rounded maximum
    base = stats.baseline_stats(sample)
    assert base["max"] == 399.2
    assert stats.category(399.24, base, in_baseline=False) == "high"
    assert stats.category(399.26, base, in_baseline=False) == "record"


def test_category_always_matches_published_levels():
    rng = np.random.default_rng(1)
    for _ in range(500):
        n = int(rng.integers(5, 27))
        zeros = int(rng.integers(0, n))
        sample = [0.0] * zeros + rng.gamma(1.0, 50.0, n - zeros).round(3).tolist()
        value = float(rng.choice([0.0, *sample]))
        p, c = classify(sample, value)
        assert 0 <= p <= 100 and c == level(value, stats.baseline_stats(sample))


def test_no_baseline_no_category():
    assert stats.category(1.0, stats.baseline_stats([]), True) is None
