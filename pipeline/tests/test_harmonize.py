"""Lead-source rules and harmonization on a synthetic monthly grid with known ratios."""

import datetime as dt
import json

import duckdb
import pytest

import harmonize
import lead

D = dt.date


@pytest.mark.parametrize(
    "day, expected",
    [
        (D(2000, 11, 1), "MODIS_T"),
        (D(2002, 7, 31), "MODIS_T"),
        (D(2002, 8, 1), "MODIS_TA"),
        (D(2012, 1, 31), "MODIS_TA"),
        (D(2012, 2, 1), "VIIRS_SNPP"),
        (D(2022, 8, 15), "VIIRS_N20"),  # outage month
        (D(2026, 10, 31), "VIIRS_SNPP"),
        (D(2026, 11, 1), "VIIRS_N20"),
    ],
)
def test_lead_source(day, expected):
    assert lead.lead_source(day, frozenset({D(2022, 8, 1)})) == expected


def test_lead_sql_matches_python():
    outages = frozenset({D(2022, 8, 1)})
    days = [D(2001, 5, 3), D(2002, 7, 31), D(2002, 8, 1), D(2012, 2, 1), D(2022, 8, 20), D(2023, 1, 1), D(2026, 11, 2)]
    con = duckdb.connect()
    for d in days:
        expr = lead.lead_sql(f"DATE '{d}'", outages)
        got = con.execute(f"SELECT {expr}").fetchone()[0]
        assert got == lead.lead_source(d, outages), d


def test_periods_are_contiguous():
    for (_, _, end), (_, start, _) in zip(lead.PERIODS, lead.PERIODS[1:], strict=False):
        assert start == end + dt.timedelta(days=1)


def make_grid(path):
    """Two 0.1-degree cells in different 1-degree cells; S-NPP = 4 x (Terra+Aqua) in cell A, 2 x in cell B.

    Terra = Aqua, so S-NPP = 8 x Terra in A and 4 x Terra in B. NOAA-20 = S-NPP except 2022-08 (S-NPP halved).
    """
    rows = []
    month = D(2011, 1, 1)
    while month <= D(2025, 12, 1):
        for iy, ix, ratio in ((1000, 2000, 4), (1200, 2300, 2)):
            n_t = n_a = 50 + month.month
            snpp = ratio * (n_t + n_a) if month >= lead.SNPP_START else 0
            n20 = snpp if month >= lead.N20_FIRST else 0
            if month == D(2022, 8, 1):
                snpp //= 2
            rows.append((iy, ix, month, n_t, n_a, snpp, n20, 1.0 * n_t, 1.0 * n_a, 0.5 * snpp, 0.5 * n20))
        month = (month.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    con = duckdb.connect()
    con.execute(
        "CREATE TABLE g (iy SMALLINT, ix SMALLINT, month DATE, n_t INT, n_a INT, n_snpp INT, n_n20 INT,"
        " f_t FLOAT, f_a FLOAT, f_snpp FLOAT, f_n20 FLOAT)"
    )
    con.executemany("INSERT INTO g VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
    con.execute(f"COPY g TO '{path.as_posix()}' (FORMAT parquet)")


def test_harmonize_end_to_end(tmp_path):
    make_grid(tmp_path / "grid_monthly.parquet")
    harmonize.main(data=tmp_path)

    assert (tmp_path / "outage_months.csv").read_text().splitlines()[1].startswith("2022-08,")

    con = duckdb.connect()
    coef = dict(
        ((cy, cx), (ta, t, n20))
        for cy, cx, ta, t, n20 in con.execute(
            f"SELECT cy, cx, w_count_ta, w_count_t, w_count_n20 "
            f"FROM read_parquet('{(tmp_path / 'coefficients.parquet').as_posix()}')"
        ).fetchall()
    )
    ta_a, t_a, n20_a = coef[(100, 200)]
    ta_b, _, _ = coef[(120, 230)]
    # the big cell keeps its own ratio; shrinkage only nudges it toward the 5-degree block / global value
    assert ta_a == pytest.approx(4, rel=0.02) and t_a == pytest.approx(8, rel=0.02)
    assert ta_b == pytest.approx(2, rel=0.03)
    assert n20_a == pytest.approx(1, rel=0.01)  # outage month excluded from the fit

    summary = json.loads((tmp_path / "harmonized" / "summary.json").read_text(encoding="utf-8"))
    assert summary["outage_months"] == ["2022-08"]
    assert summary["validation"]["contract"]["pairs"]["count_ta"]["bias_pct"] == pytest.approx(0, abs=2)

    series = con.execute(
        f"SELECT year, month, source, hotspots FROM read_csv('{(tmp_path / 'harmonized' / 'global_monthly.csv').as_posix()}')"
        " WHERE (year = 2011 AND month = 6) OR (year = 2022 AND month = 8) ORDER BY year"
    ).fetchall()
    # 2011-06: MODIS 2 x 112 detections per cell -> 112*4 + 112*2 = 672 S-NPP equivalent
    assert series[0][2] == "MODIS_TA" and series[0][3] == pytest.approx(672, rel=0.03)
    # 2022-08: S-NPP outage -> NOAA-20 x ~1 = 4*116 + 2*116 = 696
    assert series[1][2] == "VIIRS_N20" and series[1][3] == pytest.approx(696, rel=0.02)

    u = con.execute(f"SELECT count(*) FROM read_parquet('{(tmp_path / 'uncertainty.parquet').as_posix()}')").fetchone()
    assert u[0] >= 0
