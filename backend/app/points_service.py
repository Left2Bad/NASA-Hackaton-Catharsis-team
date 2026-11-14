"""POST /points (one month of hotspots as GeoJSON) and POST /export/points.csv (a date range as CSV).

Points come from Settings.points_path (data/points_serve, written by pipeline/points_serve.py; the full data/points
works too). Files are sorted by acq_date, lat, so the SQL filter on dates and each part's bounding box lets DuckDB
skip row groups. For a non-rectangular area SQL also keeps only points in the 0.1-degree cells the area touches
(a semi-join on the cell index), so long, thin or multi-part areas do not drag their whole bounding box into the
sort; the exact polygon test then runs on that small remainder (shapely, vectorized). Everything is streamed in
Arrow batches, so Python memory does not grow with the number of points in the area.

harmonized_weight is the contribution of a point to the harmonized count series: the 1-degree cell coefficient of
the lead source on that date (1 for S-NPP), 0 for points of other sensors, non-vegetation fires (type <> 0) and
low-confidence detections — the same filters as the grids (pipeline/grid.py).
"""

import calendar as cal
import csv
import datetime as dt
import io
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pandas as pd
import shapely

from . import geometry, lead
from .data import Data
from .errors import ApiError

CSV_COLUMNS = [
    "lat", "lon", "acq_datetime", "sensor", "satellite", "conf_class", "frp", "daynight",
    "pixel_km2", "type", "quality", "harmonized_weight",
]  # fmt: skip
BATCH_ROWS = 50_000


def _files(data: Data, first: dt.date, last: dt.date) -> list[Path]:
    root = data.settings.points_path
    files = [f for y in range(first.year, last.year + 1) for f in sorted(root.glob(f"*_{y}.parquet"))]
    if not files:
        raise ApiError("NO_DATA", "Points for this period are not loaded on the server.")
    return files


def _check_period(data: Data, first: dt.date, last: dt.date) -> tuple[dt.date, dt.date]:
    if last < lead.FIRST_DATE or first > data.last_date:
        raise ApiError("NO_DATA", f"Points are available for {lead.FIRST_DATE}–{data.last_date}.")
    return max(first, lead.FIRST_DATE), min(last, data.last_date)


def _scan(files: list[Path], area: geometry.Area, first: dt.date, last: dt.date) -> str:
    """FROM clause over the point files: the period, each part's bounding box and, for a non-rectangular area,
    the cells it touches (table `area_cover`, see _register_cover)."""
    src = "[" + ", ".join(f"'{f.as_posix()}'" for f in files) + "]"
    where = f"acq_date BETWEEN DATE '{first}' AND DATE '{last}'"
    if not area.is_box:
        st = geometry.STEP
        cell = (
            f"least(floor((lat + 90) / {st}), {geometry.NY - 1})::INT * {geometry.NX}"
            f" + least(floor((lon + 180) / {st}), {geometry.NX - 1})::INT"
        )
        where += f" AND {cell} IN (SELECT k FROM area_cover)"
    return f"FROM {area.point_scan_sql(f'read_parquet({src}, union_by_name = true)', where)}"


def _register_cover(cur, area: geometry.Area) -> None:
    """Register the cells touched by a non-rectangular area on this cursor (used by _scan)."""
    if not area.is_box:
        cur.register("area_cover", pd.DataFrame({"k": area.cover_keys()}))


def _sql(data: Data, files: list[Path], area: geometry.Area, first: dt.date, last: dt.date, cols: set[str]) -> str:
    """Points in the bounding box and period with contract fields and harmonized_weight."""
    g_t, g_ta, g_n20 = data.global_coef[1], data.global_coef[0], data.global_coef[2]
    pixel = "pixel_km2" if "pixel_km2" in cols else "round(scan * track, 2)"  # full data/points has scan, track
    quality = "coalesce(quality, 'SP')" if "quality" in cols else "'SP'"
    source = lead.lead_sql("p.acq_date", data.outages, data.gap_days)
    return f"""
      WITH p AS (
        SELECT lat, lon, acq_date, acq_time, sensor, source, conf_class, frp, daynight, type,
               CASE satellite WHEN 'Terra' THEN 'T' WHEN 'Aqua' THEN 'A' ELSE satellite END AS satellite,
               {pixel} AS pixel_km2, {quality} AS quality
        {_scan(files, area, first, last)}
      ), j AS (
        SELECT p.*, {source} AS lead, w.w_count_t, w.w_count_ta, w.w_count_n20
        FROM p LEFT JOIN coef w
          ON w.cy = floor((p.lat + 90) / {geometry.STEP})::INT // 10 AND w.cx = floor((p.lon + 180) / {geometry.STEP})::INT // 10
      ), k AS (
        SELECT j.*, CASE
                 WHEN type <> 0 OR conf_class = 'l' THEN 0
                 WHEN lead = 'MODIS_T' AND source = 'modis' AND satellite = 'T' THEN coalesce(w_count_t, {g_t})
                 WHEN lead = 'MODIS_TA' AND source = 'modis' THEN coalesce(w_count_ta, {g_ta})
                 WHEN lead = 'VIIRS_SNPP' AND source = 'viirs-snpp' THEN 1
                 WHEN lead = 'VIIRS_N20' AND source = 'viirs-jpss1' THEN coalesce(w_count_n20, {g_n20})
                 ELSE 0 END AS weight
        FROM j
      )
      SELECT round(lat::DOUBLE, 5) AS lat, round(lon::DOUBLE, 5) AS lon,
             strftime(acq_date + make_time(acq_time // 100, acq_time % 100, 0), '%Y-%m-%dT%H:%M:%SZ') AS acq_datetime,
             sensor, satellite,
             CASE conf_class WHEN 'l' THEN 'low' WHEN 'n' THEN 'nominal' WHEN 'h' THEN 'high' END AS conf_class,
             round(frp::DOUBLE, 2) AS frp, daynight, round(pixel_km2::DOUBLE, 2) AS pixel_km2, type, quality,
             round(weight::DOUBLE, 3) AS harmonized_weight
      FROM k"""


def _columns(cur, files: list[Path]) -> set[str]:
    src = "[" + ", ".join(f"'{f.as_posix()}'" for f in files) + "]"
    return {r[0] for r in cur.execute(f"DESCRIBE SELECT * FROM read_parquet({src}, union_by_name = true)").fetchall()}


def _batches(cur, sql: str, rows: int):
    """Arrow record batches of a query, streamed (DuckDB 2.0 to_arrow_reader; fetch_arrow_reader in 1.x)."""
    rel = cur.sql(sql)
    reader = getattr(rel, "to_arrow_reader", None) or rel.fetch_arrow_reader
    return reader(rows)


def _inside(area: geometry.Area, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Exact polygon test (boundary included); a rectangle needs none after the bounding-box filter."""
    if area.is_box:
        return np.ones(lon.shape, dtype=bool)
    return shapely.intersects_xy(area.geom, lon, lat)


# a total order, so identical requests return identical bytes
TIME_ORDER = ["acq_datetime", "lat", "lon", "sensor", "satellite", "frp", "conf_class", "harmonized_weight"]
TIME_ORDER_SQL = "acq_datetime, lat, lon, sensor, satellite, frp NULLS LAST, conf_class, harmonized_weight"
FRP_ORDER_SQL = "frp DESC NULLS LAST, acq_datetime, lat, lon, sensor, satellite"


def _strongest(df: pd.DataFrame, n: int) -> pd.DataFrame:
    """The n points with the highest FRP (missing FRP last; ties broken by time and position, as FRP_ORDER_SQL)."""
    keys = df.assign(_frp=df["frp"].fillna(-np.inf))
    keys = keys.sort_values(
        ["_frp", "acq_datetime", "lat", "lon", "sensor", "satellite"],
        ascending=[False, True, True, True, True, True],
        kind="stable",
    )
    return keys.drop(columns="_frp").head(n)


def points(data: Data, geojson: dict, year: int, month: int) -> dict:
    """One month of points. `total` is exact; above max_points the strongest fires by FRP are returned.

    A rectangle is answered in SQL (count and top-N), so memory stays inside DuckDB's limit. Any other area is
    streamed in batches through the exact polygon test with a running top-N, so Python holds at most about
    two batches plus max_points rows, however many points the area has.
    """
    area = data.parse_area(geojson)
    first = dt.date(year, month, 1)
    first, last = _check_period(data, first, first.replace(day=cal.monthrange(year, month)[1]))
    files = _files(data, first, last)
    cap = data.settings.max_points
    cur = data.cursor()
    try:
        _register_cover(cur, area)
        sql = _sql(data, files, area, first, last, _columns(cur, files))
        if area.is_box:
            total = cur.execute(f"SELECT count(*) {_scan(files, area, first, last)}").fetchall()[0][0]
            df = cur.execute(f"SELECT * FROM ({sql}) ORDER BY {FRP_ORDER_SQL} LIMIT {cap}").df()
        else:
            total, df = 0, None
            for batch in _batches(cur, sql, BATCH_ROWS):
                part = batch.to_pandas()
                part = part[_inside(area, part["lon"].to_numpy(), part["lat"].to_numpy())]
                total += len(part)
                df = part if df is None else pd.concat([df, part], ignore_index=True)
                if len(df) > 2 * cap:
                    df = _strongest(df, cap)
            if df is None:  # no rows at all: an empty frame with the query's columns
                df = cur.execute(f"SELECT * FROM ({sql}) LIMIT 0").df()
            df = _strongest(df, cap)
    finally:
        cur.close()
    truncated = total > cap
    df = df.sort_values(TIME_ORDER, kind="stable")
    frp = df["frp"].astype(object).where(df["frp"].notna(), None)
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "acq_datetime": t,
                "sensor": sensor,
                "satellite": sat,
                "conf_class": conf,
                "frp": f,
                "daynight": dn,
                "quality": q,
                "harmonized_weight": w,
            },
        }
        for lon, lat, t, sensor, sat, conf, f, dn, q, w in zip(
            df["lon"].tolist(),
            df["lat"].tolist(),
            df["acq_datetime"],
            df["sensor"],
            df["satellite"],
            df["conf_class"],
            frp.tolist(),
            df["daynight"],
            df["quality"],
            df["harmonized_weight"].tolist(),
            strict=True,
        )
    ]
    return {"type": "FeatureCollection", "features": features, "total": total, "truncated": truncated}


def grid_lower_bound(cur, data: Data, area: geometry.Area, first: dt.date, last: dt.date) -> int:
    """Filtered detections (grid_daily) in 0.1-degree cells lying wholly inside the area.

    Every such detection is also a point of the export, so this is a lower bound of the row count; it rejects
    long periods quickly, without scanning years of points.
    """
    st = geometry.STEP
    iy, ix = area.iy.astype(float), area.ix.astype(float)
    cells = shapely.box(ix * st - 180, iy * st - 90, (ix + 1) * st - 180, (iy + 1) * st - 90)
    whole = shapely.covers(area.geom, cells)
    if not whole.any():
        return 0
    cur.register("cells", data.cells_frame(area.iy[whole], area.ix[whole]))
    return cur.execute(f"""
      SELECT coalesce(sum(n_t + n_a + n_snpp + n_n20), 0)::BIGINT
      FROM {area.cell_scan_sql("grid_daily", f"date BETWEEN DATE '{first}' AND DATE '{last}'")} g
      JOIN cells c ON g.iy = c.iy AND g.ix = c.ix""").fetchall()[0][0]


class Export:
    """A validated export: count checked up front, rows streamed in batches by rows()."""

    def __init__(self, data: Data, geojson: dict, start: dt.date, end: dt.date):
        if start > end:
            raise ApiError("INVALID_REQUEST", "start_date is later than end_date.")
        self.data = data
        self.area = data.parse_area(geojson)
        self.first, self.last = _check_period(data, start, end)
        self.files = _files(data, self.first, self.last)
        cur = data.cursor()
        try:
            _register_cover(cur, self.area)
            self.sql = _sql(data, self.files, self.area, self.first, self.last, _columns(cur, self.files))
            self.count = self._count(cur)
        finally:
            cur.close()
        if self.count > data.settings.max_export_rows:
            raise ApiError(
                "EXPORT_TOO_LARGE",
                f"The export has more than {data.settings.max_export_rows:,} points. Shorten the period or reduce the area.",
            )
        self._start()

    def _count(self, cur) -> int:
        """Rows inside the area (grid lower bound first, then year by year); stops once over the export limit."""
        limit = self.data.settings.max_export_rows
        n = grid_lower_bound(cur, self.data, self.area, self.first, self.last)
        if n > limit:
            return n
        n = 0
        for y in range(self.first.year, self.last.year + 1):
            files = [f for f in self.files if f.stem.endswith(f"_{y}")]
            if not files:
                continue
            scan = _scan(files, self.area, max(self.first, dt.date(y, 1, 1)), min(self.last, dt.date(y, 12, 31)))
            if self.area.is_box:
                n += cur.execute(f"SELECT count(*) {scan}").fetchall()[0][0]
            else:
                for batch in _batches(cur, f"SELECT lon, lat {scan}", BATCH_ROWS * 4):
                    n += int(_inside(self.area, batch.column(0).to_numpy(), batch.column(1).to_numpy()).sum())
                    if n > limit:
                        break
            if n > limit:
                break
        return n

    def _start(self) -> None:
        """Run the sorted query and fetch its first batch now, so a failure (memory, temp disk, a missing file)
        becomes an error response instead of a 200 with a cut-off file."""
        self._cur = self.data.cursor()
        try:
            _register_cover(self._cur, self.area)
            self._reader = _batches(self._cur, f"SELECT * FROM ({self.sql}) ORDER BY {TIME_ORDER_SQL}", BATCH_ROWS)
            self._head = _next(self._reader)
        except BaseException:
            self._cur.close()
            raise

    def rows(self) -> Iterator[str]:
        """CSV text in chunks: the header, then batches of points in time order (TIME_ORDER_SQL)."""
        try:
            yield ",".join(CSV_COLUMNS) + "\n"
            batch = self._head
            while batch is not None:
                df = batch.to_pandas()
                df = df[_inside(self.area, df["lon"].to_numpy(), df["lat"].to_numpy())]
                if len(df):
                    buf = io.StringIO()
                    df[CSV_COLUMNS].to_csv(
                        buf, header=False, index=False, lineterminator="\n", quoting=csv.QUOTE_MINIMAL
                    )
                    yield buf.getvalue()
                batch = _next(self._reader)
        finally:
            self._cur.close()


def _next(reader):
    try:
        return reader.read_next_batch()
    except StopIteration:
        return None
