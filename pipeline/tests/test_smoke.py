"""Smoke tests on tiny synthetic FIRMS archives (CI has no real data)."""

import zipfile

import duckdb
import pytest

import to_parquet

MODIS_HEADER = "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type"
VIIRS_HEADER = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type"


def make_zip(path, src, year, files):
    """files: {country: [csv rows]} -> FIRMS-like yearly archive."""
    header = MODIS_HEADER if src == "modis" else VIIRS_HEADER
    with zipfile.ZipFile(path, "w") as z:
        for country, rows in files.items():
            z.writestr(f"{src}/{year}/{src}_{year}_{country}.csv", "\n".join([header, *rows]) + "\n")
    return path


@pytest.fixture
def out_dirs(tmp_path, monkeypatch):
    monkeypatch.setattr(to_parquet, "OUT", tmp_path / "points")
    monkeypatch.setattr(to_parquet, "TMP", tmp_path / "_tmp")
    (tmp_path / "points").mkdir()
    return tmp_path


def read(path):
    return duckdb.sql(f"SELECT * FROM read_parquet('{path.as_posix()}') ORDER BY conf_raw").fetchall()


def test_modis_confidence_classes_and_schema(out_dirs):
    zp = make_zip(
        out_dirs / "modis_2020_all_countries.zip",
        "modis",
        2020,
        {
            "Brazil": [
                "-10.0,-50.0,310.1,1.0,1.0,2020-08-01,0130,Terra,MODIS,20,6.03,290.0,5.5,N,0",
                "-10.1,-50.1,320.2,1.1,1.0,2020-08-02,1345,Aqua,MODIS,50,6.03,291.0,12.0,D,0",
            ],
            "United States": ["38.0,-120.0,330.3,1.2,1.1,2020-09-01,2010,Aqua,MODIS,90,6.03,295.0,40.0,D,2"],
        },
    )
    to_parquet.convert(zp)
    out = out_dirs / "points" / "modis_2020.parquet"
    assert out.exists()
    cols = [c[0] for c in duckdb.sql(f"DESCRIBE SELECT * FROM read_parquet('{out.as_posix()}')").fetchall()]
    assert cols == [
        "lat", "lon", "acq_date", "acq_time", "satellite", "sensor", "source", "conf_class", "conf_raw",
        "bright", "bright2", "frp", "scan", "track", "daynight", "type", "country",
    ]  # fmt: skip
    rows = read(out)
    assert [r[7] for r in rows] == ["l", "n", "h"]  # 20 -> low, 50 -> nominal, 90 -> high
    assert {r[16] for r in rows} == {"Brazil", "United States"}
    assert all(r[5] == "MODIS" and r[6] == "modis" for r in rows)


def test_viirs_keeps_letter_confidence(out_dirs):
    zp = make_zip(
        out_dirs / "viirs-snpp_2020_all_countries.zip",
        "viirs-snpp",
        2020,
        {"Brazil": ["-4.6,-44.9,308.8,0.39,0.36,2020-01-01,0418,N,VIIRS,n,2,282.1,1.23,N,0"]},
    )
    to_parquet.convert(zp)
    rows = read(out_dirs / "points" / "viirs-snpp_2020.parquet")
    assert rows[0][7] == "n" and rows[0][5] == "VIIRS" and rows[0][6] == "viirs-snpp"


def test_existing_output_is_skipped(out_dirs):
    zp = make_zip(out_dirs / "modis_2001_all_countries.zip", "modis", 2001, {"X": []})
    target = out_dirs / "points" / "modis_2001.parquet"
    target.write_bytes(b"keep")
    to_parquet.convert(zp)
    assert target.read_bytes() == b"keep"


def test_modules_import_without_data_or_key():
    import api_to_parquet  # noqa: F401
    import download_archives
    import fetch_api  # noqa: F401
    import harmonize  # noqa: F401

    assert len(download_archives.FILES) == 48


def test_glob_patterns_are_expanded_by_the_script(tmp_path, monkeypatch):
    """PowerShell passes `data/raw/*.zip` unexpanded; to_parquet.py expands it itself (R23, R38)."""
    for name in ("modis_2001_all_countries.zip", "viirs-snpp_2013_all_countries.zip"):
        (tmp_path / name).write_bytes(b"")
    monkeypatch.chdir(tmp_path)
    assert [p.name for p in to_parquet.expand(["*.zip"])] == [
        "modis_2001_all_countries.zip",
        "viirs-snpp_2013_all_countries.zip",
    ]
    with pytest.raises(SystemExit, match="no files match"):
        to_parquet.expand(["missing*.zip"])
    (tmp_path / "notes.zip").write_bytes(b"")
    with pytest.raises(SystemExit, match="not a FIRMS yearly archive"):
        to_parquet.expand(["*.zip"])
