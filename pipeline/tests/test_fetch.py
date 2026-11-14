"""2026 API fetch and conversion: fixed chunk grid, safe re-runs, no key in messages, one chunk per day (R17, R19, R21, R22)."""

import datetime as dt
import json
import os

import duckdb
import pytest

import api_to_parquet
import fetch_api

D = dt.date


def test_plan_has_a_fixed_grid_split_at_the_end_of_sp():
    av = {"MODIS_SP": (D(2025, 1, 1), D(2026, 1, 7)), "MODIS_NRT": (D(2026, 1, 3), D(2026, 1, 14))}
    tasks, problems = fetch_api.plan(av)
    modis = [(f, last, p) for s, f, last, p in tasks if s == "modis"]
    assert modis == [
        (D(2026, 1, 1), D(2026, 1, 5), "MODIS_SP"),
        (D(2026, 1, 6), D(2026, 1, 7), "MODIS_SP"),
        (D(2026, 1, 8), D(2026, 1, 10), "MODIS_NRT"),
        (D(2026, 1, 11), D(2026, 1, 14), "MODIS_NRT"),
    ]
    assert problems == ["viirs-snpp: no product in data_availability", "viirs-jpss1: no product in data_availability"]
    # a later run with more SP data keeps the 5-day grid: chunk starts never shift
    later, _ = fetch_api.plan(
        {"MODIS_SP": (D(2025, 1, 1), D(2026, 1, 12)), "MODIS_NRT": (D(2026, 1, 3), D(2026, 1, 20))}
    )
    starts = {f for s, f, _, _ in later if s == "modis"}
    assert {D(2026, 1, 1), D(2026, 1, 6), D(2026, 1, 11), D(2026, 1, 16)} <= starts


def test_open_nrt_tail_is_fetched_again(tmp_path):
    last = D(2026, 1, 14)
    f = fetch_api.chunk_path("modis", D(2026, 1, 11), last, "MODIS_NRT", out=tmp_path)
    f.parent.mkdir(parents=True)
    f.write_text("latitude\n")
    end_of_day = dt.datetime(2026, 1, 15, tzinfo=dt.UTC).timestamp()
    os.utime(f, (end_of_day - 3600, end_of_day - 3600))  # fetched during its last day: partial
    assert not fetch_api.is_final(f, last, "MODIS_NRT")
    os.utime(f, (end_of_day + 3 * 3600, end_of_day + 3 * 3600))  # too soon after the day ended
    assert not fetch_api.is_final(f, last, "MODIS_NRT")
    os.utime(f, (end_of_day + 7 * 3600, end_of_day + 7 * 3600))
    assert fetch_api.is_final(f, last, "MODIS_NRT")
    sp = fetch_api.chunk_path("modis", D(2026, 1, 1), D(2026, 1, 5), "MODIS_SP", out=tmp_path)
    sp.write_text("latitude\n")
    assert fetch_api.is_final(sp, D(2026, 1, 5), "MODIS_SP")


def test_key_never_reaches_messages(monkeypatch, capsys):
    monkeypatch.setattr(fetch_api, "KEY", "SECRETKEY123")

    def boom(*_a, **_k):
        raise OSError("connection refused for https://x/api/data_availability/csv/SECRETKEY123/all")

    monkeypatch.setattr(fetch_api.urllib.request, "urlopen", boom)
    monkeypatch.setattr(fetch_api.time, "sleep", lambda _s: None)
    with pytest.raises(SystemExit) as e:
        fetch_api.main([])
    out = capsys.readouterr()
    assert "SECRETKEY123" not in str(e.value) + out.out + out.err
    assert "<key>" in str(e.value)


def test_failed_chunk_makes_the_run_fail(monkeypatch, tmp_path):
    monkeypatch.setattr(fetch_api, "KEY", "K")
    monkeypatch.setattr(fetch_api, "OUT", tmp_path)
    monkeypatch.setattr(fetch_api, "availability", lambda: {"MODIS_SP": (D(2025, 1, 1), D(2026, 1, 3))})
    monkeypatch.setattr(fetch_api, "wait_quota", lambda: None)
    monkeypatch.setattr(fetch_api, "status", lambda: "{}")
    monkeypatch.setattr(fetch_api.time, "sleep", lambda _s: None)
    monkeypatch.setattr(fetch_api, "get", lambda *a, **k: "<html>maintenance</html>")
    monkeypatch.setattr(fetch_api, "chunk_path", lambda s, f, last, p, out=tmp_path: out / s / f"{f}_{last}_{p}.csv")
    assert fetch_api.main(["--workers", "1"]) == 1
    manifest = json.loads((tmp_path / "fetch.json").read_text())
    assert manifest["failed"] == ["modis 2026-01-01..2026-01-03 MODIS_SP"]


MODIS = "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight"


def write_chunk(folder, name, rows, mtime):
    folder.mkdir(parents=True, exist_ok=True)
    f = folder / name
    f.write_text("\n".join([MODIS, *rows]) + "\n", encoding="utf-8")
    os.utime(f, (mtime, mtime))
    return f


def row(lat, day, t="0130", sat="T"):
    return f"{lat},20.0,320,1,1,{day},{t},{sat},MODIS,50,6.1NRT,290,5.0,D"


@pytest.fixture
def api_data(tmp_path):
    data = tmp_path / "data"
    pts = data / "points"
    pts.mkdir(parents=True)
    con = duckdb.connect()  # one archive file so that the static-source mask can be built
    con.execute(f"""COPY (SELECT 10.0::FLOAT lat, 21.0::FLOAT lon, DATE '2025-06-01' acq_date, 2::TINYINT type)
                   TO '{(pts / "modis_2025.parquet").as_posix()}'""")
    raw = data / "raw" / "api_2026" / "modis"
    t0 = dt.datetime(2026, 1, 9, 12, tzinfo=dt.UTC).timestamp()
    # first run: NRT for 1-5 and a partial 6 Jan; second run: SP for 1-5 (overlap) and NRT 6-8, newer
    write_chunk(
        raw, "2026-01-01_2026-01-05_MODIS_NRT.csv", [row(1.0, "2026-01-01"), row(2.0, "2026-01-03")], t0 - 86400 * 3
    )
    write_chunk(raw, "2026-01-06_2026-01-06_MODIS_NRT.csv", [row(3.0, "2026-01-06")], t0 - 86400 * 3)
    write_chunk(raw, "2026-01-01_2026-01-05_MODIS_SP.csv", [row(1.0, "2026-01-01"), row(2.5, "2026-01-04")], t0)
    write_chunk(raw, "2026-01-06_2026-01-08_MODIS_NRT.csv", [row(3.0, "2026-01-06"), row(4.0, "2026-01-08")], t0)
    (data / "raw" / "api_2026" / "fetch.json").write_text(json.dumps({"started_at": "2026-01-09T03:00:00+00:00"}))
    return data


def test_conversion_takes_each_day_from_one_chunk(api_data):
    cov = api_to_parquet.main([], data=api_data)
    got = duckdb.sql(
        f"SELECT lat, acq_date, quality FROM read_parquet('{(api_data / 'points' / 'modis_2026.parquet').as_posix()}')"
        " ORDER BY acq_date"
    ).fetchall()
    # 1-5 Jan from SP only (the NRT copy of 1 Jan and the NRT-only 3 Jan are dropped); 6-8 from the newer NRT chunk
    assert [(round(lat, 1), str(d), q) for lat, d, q in got] == [
        (1.0, "2026-01-01", "SP"),
        (2.5, "2026-01-04", "SP"),
        (3.0, "2026-01-06", "NRT"),
        (4.0, "2026-01-08", "NRT"),
    ]
    src = cov["sources"]["modis"]
    assert src["last_sp_date"] == "2026-01-05"
    # fetched 9 Jan 03:00 UTC: 8 Jan ended only 3 hours earlier, so the last complete day is 7 Jan
    assert cov["complete_through"] == "2026-01-07" and src["last_complete_date"] == "2026-01-07"
    saved = json.loads((api_data / "points" / "api_2026.json").read_text())
    assert saved["complete_through"] == "2026-01-07"


def test_a_missing_chunk_stops_the_conversion(api_data):
    (api_data / "raw" / "api_2026" / "modis" / "2026-01-06_2026-01-06_MODIS_NRT.csv").unlink()
    (api_data / "raw" / "api_2026" / "modis" / "2026-01-06_2026-01-08_MODIS_NRT.csv").rename(
        api_data / "raw" / "api_2026" / "modis" / "2026-01-07_2026-01-08_MODIS_NRT.csv"
    )
    with pytest.raises(SystemExit):
        api_to_parquet.main([], data=api_data)
    assert not (api_data / "points" / "modis_2026.parquet").exists()
