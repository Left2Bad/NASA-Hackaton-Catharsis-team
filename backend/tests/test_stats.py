"""percentile and category follow the contract's definitions and agree with each other (R9, R16, R26)."""

import numpy as np
import pytest

from app import stats


def band(p: float) -> str:
    if p < 25:
        return "below_normal"
    if p <= 75:
        return "normal"
    if p <= 90:
        return "above_normal"
    return "high"


def classify(sample, value, in_baseline=True):
    p = stats.percentile_of(sample, value)
    return p, stats.category(p, value, stats.baseline_stats(sample), in_baseline)


def test_zero_month_among_zero_years_is_the_middle_not_the_top():
    assert classify([0.0] * 25, 0.0) == (50.0, "normal")
    # 22 of 25 years without fires: a zero month sits in the middle of the tie
    sample = [0.0] * 22 + [3.0, 5.0, 8.0]
    assert classify(sample, 0.0) == (44.0, "normal")


def test_mid_rank_values():
    sample = list(range(1, 11))  # 1..10
    assert stats.percentile_of(sample, 5) == 45.0  # 4 below, 1 equal
    assert stats.percentile_of(sample, 0) == 0.0
    assert stats.percentile_of(sample, 11) == 100.0
    assert stats.percentile_of([], 1) is None


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (2.0, (15.0, "below_normal")),
        (3.0, (25.0, "normal")),  # exactly 25 is normal
        (8.0, (75.0, "normal")),  # exactly 75 is normal
        (8.5, (80.0, "above_normal")),
        (9.5, (90.0, "above_normal")),  # exactly 90 is still above_normal
        (10.0, (95.0, "high")),
    ],
)
def test_band_boundaries(value, expected):
    sample = [float(x) for x in range(1, 11)]  # n = 10
    assert classify(sample, value) == expected


def test_rounded_value_is_compared_with_rounded_sample():
    # the published (rounded) value and the unrounded one get the same rank, so the payload is self-consistent
    sample = [float(x) for x in range(100, 124)] + [399.21726]
    assert stats.percentile_of(sample, 399.2) == stats.percentile_of(sample, 399.21726)
    # record needs a rounded value above the rounded maximum
    base = stats.baseline_stats(sample)
    assert base["max"] == 399.2
    p = stats.percentile_of(sample, 399.24)
    assert stats.category(p, 399.24, base, in_baseline=False) == "high"
    assert stats.category(stats.percentile_of(sample, 399.26), 399.26, base, in_baseline=False) == "record"


def test_category_always_matches_percentile_band():
    rng = np.random.default_rng(1)
    for _ in range(500):
        n = int(rng.integers(5, 27))
        zeros = int(rng.integers(0, n))
        sample = [0.0] * zeros + rng.gamma(1.0, 50.0, n - zeros).round(3).tolist()
        value = float(rng.choice([0.0, *sample, float(rng.gamma(1.0, 50.0))]))
        p, c = classify(sample, value)
        assert 0 <= p <= 100 and c == band(p)


def test_no_baseline_no_category():
    assert stats.category(None, 1.0, stats.baseline_stats([]), True) is None
