"""Harmonized and raw series of an area, aggregated from the 0.1-degree grids."""

import datetime as dt

import pandas as pd

from . import lead
from .data import Data
from .geometry import Area

WEIGHTS = ("w_count_ta", "w_count_t", "w_count_n20", "w_frp_ta", "w_frp_t", "w_frp_n20")


def _joined(data: Data, table: str, time_col: str, area: Area, start: dt.date, end: dt.date) -> str:
    """Grid rows of the area joined with 1-degree coefficients (global ones where a cell has none)."""
    coalesced = ", ".join(f"coalesce(w.{w}, {g}) AS {w}" for w, g in zip(WEIGHTS, data.global_coef, strict=True))
    return f"""
      SELECT g.*, {coalesced}
      FROM {table} g
      JOIN cells c ON g.iy = c.iy AND g.ix = c.ix
      LEFT JOIN coef w ON w.cy = g.iy // 10 AND w.cx = g.ix // 10
      WHERE g.iy BETWEEN {int(area.iy.min())} AND {int(area.iy.max())}
        AND g.{time_col} BETWEEN DATE '{start}' AND DATE '{end}'"""


def query(data: Data, area: Area, metric: str, start: dt.date, end: dt.date, daily: bool = False) -> pd.DataFrame:
    """One row per month (or day) that has any detection: value (harmonized), raw sums per sensor."""
    table, time_col = ("grid_daily", "date") if daily else ("grid_monthly", "month")
    p = "n" if metric == "count" else "f"
    source = lead.lead_sql(f"j.{time_col}", data.outages)
    cur = data.cursor()
    cur.register("cells", data.cells_frame(area.iy, area.ix))
    df = cur.execute(f"""
      WITH j AS ({_joined(data, table, time_col, area, start, end)})
      SELECT j.{time_col} AS t,
             sum({lead.value_sql(metric, "j", "j", source)})::DOUBLE AS value,
             sum(j.{p}_t + j.{p}_a)::DOUBLE AS modis,
             sum(j.{p}_snpp)::DOUBLE AS viirs_snpp,
             sum(j.{p}_n20)::DOUBLE AS viirs_n20
      FROM j GROUP BY 1 ORDER BY 1""").df()
    cur.close()
    df["t"] = pd.to_datetime(df["t"]).dt.date
    return df


def month_range(first: dt.date, last: dt.date) -> list[dt.date]:
    out, m = [], first.replace(day=1)
    while m <= last:
        out.append(m)
        m = (m.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    return out


def raw_available(month: dt.date) -> dict[str, bool]:
    """Which sensors were reporting in this month (otherwise the raw value is null)."""
    return {
        "modis": month >= lead.FIRST_DATE,
        "viirs_snpp": dt.date(2012, 1, 1) <= month <= lead.SNPP_END,
        "viirs_n20": month >= lead.N20_FIRST,
    }
