"""Day-level sensor gaps, the coefficient guard, safe grid parts and the symmetric static-source mask
(R1, R8, R18, R19, R20, R35, R37)."""

import datetime as dt
import json

import duckdb
import pytest

import grid
import harmonize
import lead

D = dt.date
GAPS = {
    "terra": frozenset({D(2001, 6, 20), D(2003, 12, 18)}),
    "aqua": frozenset({D(2002, 8, 3)}),
    "snpp": frozenset({D(2012, 3, 25), D(2022, 3, 10), D(2023, 7, 20)}),
    "n20": frozenset({D(2023, 7, 20), D(2026, 11, 5)}),
}


@pytest.mark.parametrize(
    "day, expected",
    [
        (D(2001, 6, 20), "MODIS_T"),  # Terra gap in the Terra-only era: nothing replaces it
        (D(2002, 8, 3), "MODIS_T"),  # Aqua gap: Terra x Terra-only coefficient
        (D(2003, 12, 18), "MODIS_TA"),  # Terra gap: Aqua alone stays, flagged
        (D(2012, 3, 25), "MODIS_TA"),  # S-NPP gap before NOAA-20
        (D(2022, 3, 10), "VIIRS_N20"),  # S-NPP gap with NOAA-20
        (D(2023, 7, 20), "VIIRS_SNPP"),  # both VIIRS missing: nothing to switch to
        (D(2022, 3, 11), "VIIRS_SNPP"),
    ],
)
def test_day_rule(day, expected):
    assert lead.lead_source(day, frozenset(), GAPS) == expected
    con = duckdb.connect()
    assert (
        con.execute(f"SELECT {lead.lead_sql(f'DATE {day.isoformat()!r}', frozenset(), GAPS)}").fetchone()[0] == expected
    )


def test_gap_months_and_substitutions():
    months = lead.gap_months(frozenset({D(2024, 7, 1)}), GAPS)
    assert {D(2001, 6, 1), D(2002, 8, 1), D(2003, 12, 1), D(2012, 3, 1), D(2022, 3, 1), D(2023, 7, 1)} <= months
    assert D(2024, 7, 1) in months  # outage months stay flagged
    assert D(2026, 11, 1) in months  # NOAA-20 leads after S-NPP: its gap flags the month
    subs = lead.substitutions(frozenset(), GAPS)
    assert subs == {D(2002, 8, 3): "MODIS_T", D(2012, 3, 25): "MODIS_TA", D(2022, 3, 10): "VIIRS_N20"}
    assert lead.substituted_months(frozenset(), GAPS) == {D(2002, 8, 1), D(2012, 3, 1), D(2022, 3, 1)}


def write_daily(path, rows):
    con = duckdb.connect()
    con.execute(
        "CREATE TABLE g (iy SMALLINT, ix SMALLINT, date DATE, n_t INT, n_a INT, n_snpp INT, n_n20 INT,"
        " f_t FLOAT, f_a FLOAT, f_snpp FLOAT, f_n20 FLOAT)"
    )
    con.executemany("INSERT INTO g VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
    con.execute(f"COPY (SELECT * FROM g ORDER BY iy, ix, date) TO '{path.as_posix()}' (FORMAT parquet)")
    con.execute(f"""COPY (SELECT iy, ix, date_trunc('month', date)::DATE AS month, {grid.SUMS} FROM g GROUP BY ALL
                         ORDER BY iy, ix, month) TO '{(path.parent / "grid_monthly.parquet").as_posix()}' (FORMAT parquet)""")


def test_find_gap_days(tmp_path):
    rows = []
    d = D(2021, 1, 1)
    while d <= D(2021, 3, 31):
        k = 1 + (d.day % 3) / 10  # some day-to-day noise
        n_t, n_a, snpp, n20 = int(100 * k), int(200 * k), int(1200 * k), int(1180 * k)
        if d == D(2021, 2, 10):
            snpp = 0  # S-NPP outage
        if d == D(2021, 2, 11):
            snpp = int(300 * k)  # partial S-NPP day: 25 % of normal
        if d == D(2021, 3, 3):
            n_t = 5  # Terra almost absent
        rows.append((1000, 2000, d, n_t, n_a, snpp, n20, 0, 0, 0, 0))
        d += dt.timedelta(days=1)
    write_daily(tmp_path / "grid_daily.parquet", rows)
    con = duckdb.connect()
    found = harmonize.find_gap_days(con, tmp_path / "grid_daily.parquet", D(2021, 3, 31))
    assert [(day, s) for day, s, _ in found] == [
        (D(2021, 2, 10), "snpp"),
        (D(2021, 2, 11), "snpp"),
        (D(2021, 3, 3), "terra"),
    ]


def test_coefficient_guard_keeps_an_outlier_cell_out_of_its_block():
    """A block of three 1-degree cells: two normal (S-NPP = 4 x MODIS), one lava-like (12 MODIS vs 50,000 S-NPP)."""
    con = duckdb.connect()
    rows = []
    for m in range(1, 13):
        month = D(2015, m, 1)
        rows += [
            (100, 200, month, 50, 50, 400),
            (100, 201, month, 0, 1, 2),
            (101, 200, month, 0, 0, 50000 if m == 6 else 0),
            (120, 230, month, 10000, 10000, 80000),  # the rest of the world, another block
        ]
    con.execute("CREATE TABLE m1 (cy SMALLINT, cx SMALLINT, month DATE, n_t DOUBLE, n_a DOUBLE, n_snpp DOUBLE)")
    con.executemany("INSERT INTO m1 VALUES (?, ?, ?, ?, ?, ?)", rows)
    con.execute("ALTER TABLE m1 ADD COLUMN n_n20 DOUBLE DEFAULT 0")
    con.execute("CREATE TABLE cells AS SELECT DISTINCT cy, cx FROM m1")
    con.execute("UPDATE m1 SET n_a = n_a + 1 WHERE cy = 101")  # one Aqua detection a month in the lava cell
    where = "year(month) = 2015"
    harmonize.fit(con, "guarded", "count_ta", where)
    harmonize.fit(con, "naive", "count_ta", where, band=1e9)
    g = dict(con.execute("SELECT cx::INT + cy::INT * 1000, r FROM guarded").fetchall())
    n = dict(con.execute("SELECT cx::INT + cy::INT * 1000, r FROM naive").fetchall())
    outlier = dict(con.execute("SELECT cx::INT + cy::INT * 1000, outlier FROM guarded").fetchall())
    assert outlier == {100200: False, 100201: False, 101200: True, 120230: False}
    # without the guard the lava cell drags the sparse neighbour far above the normal ratio of 4
    assert n[100201] > 15
    assert g[100201] == pytest.approx(4, rel=0.15)
    assert g[101200] == pytest.approx(g[100201], rel=0.15)  # the outlier takes the block value
    assert g[100200] == pytest.approx(4, rel=0.02)


def make_points(pts):
    pts.mkdir()
    con = duckdb.connect()
    con.execute(
        "CREATE TABLE p (lat FLOAT, lon FLOAT, acq_date DATE, satellite VARCHAR, source VARCHAR,"
        " conf_class VARCHAR, frp FLOAT, type TINYINT)"
    )
    rows = {
        2020: [  # MODIS types the lava cell as a static source, VIIRS calls it type 0
            (64.0, -17.0, "2020-08-01", "Terra", "modis", "n", 5.0, 2),
            (64.001, -17.001, "2020-08-01", "N", "viirs-snpp", "n", 5.0, 0),
            (10.0, 20.0, "2020-08-01", "N", "viirs-snpp", "n", 5.0, 0),
        ],
        2021: [(10.0, 20.0, "2021-08-01", "N", "viirs-snpp", "n", 5.0, 0)],
    }
    for year, rs in rows.items():
        con.execute("DELETE FROM p")
        con.executemany("INSERT INTO p VALUES (?, ?, ?, ?, ?, ?, ?, ?)", rs)
        con.execute(f"COPY p TO '{(pts / f'mixed_{year}.parquet').as_posix()}' (FORMAT parquet)")


def test_mask_is_symmetric_and_partial_years_never_replace_the_grid(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    make_points(data / "points")
    grid.run(data=data)
    con = duckdb.connect()
    daily = (data / "grid_daily.parquet").as_posix()
    # the VIIRS detection in the MODIS static-source cell is masked too; the ordinary fire stays
    assert con.execute(f"SELECT sum(n_snpp), sum(n_t) FROM read_parquet('{daily}')").fetchone() == (2, 0)
    # the cache of parts is lost: a --years run rebuilds the missing year instead of dropping it
    (data / "grid_parts" / "2020.parquet").unlink()
    grid.run(years=[2021], data=data)
    assert con.execute(f"SELECT count(DISTINCT year(date)) FROM read_parquet('{daily}')").fetchone()[0] == 2
    # a part built with another step is stale and rebuilt, never mixed in
    grid.run(years=[2021], step=0.5, data=data)
    steps = {grid.kv_metadata(con, p)["step"] for p in (data / "grid_parts").glob("*.parquet")}
    assert steps == {"0.5"}
    # a part without points is refused
    (data / "grid_parts" / "2019.parquet").write_bytes((data / "grid_parts" / "2021.parquet").read_bytes())
    with pytest.raises(SystemExit):
        grid.run(data=data, step=0.5)


def test_harmonize_writes_dates_gap_days_and_consistent_gap_month_rows(tmp_path):
    """Two cells, daily 2012-02..2026-01-05 with an S-NPP gap day; fetched on 2026-01-05 (partial)."""
    data = tmp_path
    rows = []
    d = D(2012, 2, 1)
    while d <= D(2026, 1, 5):
        k = 1 + (d.day % 3) / 10
        for iy, ix, r in ((1000, 2000, 4), (1200, 2300, 2)):
            n = int(10 * k)
            snpp = r * 2 * n
            n20 = snpp if d >= lead.N20_FIRST else 0
            if d == D(2022, 3, 10):
                snpp = 0
            rows.append((iy, ix, d, n, n, snpp, n20, n, n, snpp / 2, n20 / 2))
        d += dt.timedelta(days=1)
    write_daily(data / "grid_daily.parquet", rows)
    (data / "points").mkdir()
    (data / "points" / "api_2026.json").write_text(
        json.dumps({
            "complete_through": "2026-01-04",
            "sources": {"viirs-snpp": {"last_sp_date": "2025-12-31"}, "viirs-jpss1": {"last_sp_date": "2026-01-02"}},
        }),
        encoding="utf-8",
    )  # fmt: skip
    harmonize.main(data=data)
    summary = json.loads((data / "harmonized" / "summary.json").read_text(encoding="utf-8"))
    assert summary["last_date"] == "2026-01-05"
    assert summary["last_complete_date"] == "2026-01-04"
    assert summary["last_standard_date"] == "2025-12-31"  # the earlier of the two VIIRS SP ends
    assert summary["gap_days"]["snpp"] == 1 and "2022-03" in summary["sensor_gap_months"]
    assert (data / "gap_days.csv").read_text().splitlines()[1].startswith("2022-03-10,snpp,")
    # gap-month rows sum to the daily grid of those months, and the day rule gives NOAA-20 only to the gap day
    con = duckdb.connect()
    gm = (data / harmonize.GAP_MONTH_ROWS).as_posix()
    totals = con.execute(f"SELECT sum(n_snpp), sum(n_n20), count(DISTINCT date) FROM read_parquet('{gm}')").fetchone()
    daily = con.execute(
        f"SELECT sum(n_snpp), sum(n_n20) FROM read_parquet('{(data / 'grid_daily.parquet').as_posix()}')"
        " WHERE date BETWEEN DATE '2022-03-01' AND DATE '2022-03-31'"
    ).fetchone()
    assert totals[:2] == daily and totals[2] == 2  # one base group and one NOAA-20 group
    gaps = lead.load_gap_days(data / "gap_days.csv")
    src = con.execute(
        f"SELECT DISTINCT {lead.lead_sql('date', frozenset(), gaps)} FROM read_parquet('{gm}') ORDER BY 1"
    ).fetchall()
    assert src == [("VIIRS_N20",), ("VIIRS_SNPP",)]
    # the global series uses NOAA-20 on that day: March 2022 is not short of a day
    march = con.execute(
        f"SELECT hotspots FROM read_csv('{(data / 'harmonized' / 'global_monthly.csv').as_posix()}')"
        " WHERE year = 2022 AND month = 3"
    ).fetchone()[0]
    full = con.execute(
        f"SELECT sum(n_n20) FROM read_parquet('{(data / 'grid_daily.parquet').as_posix()}')"
        " WHERE date BETWEEN DATE '2022-03-01' AND DATE '2022-03-31'"
    ).fetchone()[0]
    assert march == pytest.approx(full, rel=0.02)
