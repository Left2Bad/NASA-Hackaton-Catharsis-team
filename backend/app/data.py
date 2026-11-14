"""Read-only access to pipeline outputs in DATA_DIR (see data/README.md).

Files used: grid_daily.parquet, grid_monthly.parquet, coefficients.parquet, uncertainty.parquet,
outage_months.csv, harmonized/summary.json. Small tables are loaded into memory once; the grids stay
on disk and are scanned per request (sorted by iy, so a latitude band reads only its row groups).
"""

import datetime as dt
import hashlib
import json
import threading
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from . import lead
from .settings import Settings

COUNT_UNIT = "viirs_snpp_equivalent_detections"
FRP_UNIT = "viirs_snpp_equivalent_frp_mw"


@dataclass
class Uncertainty:
    """q10/q90 multipliers of the harmonized value, by (basis, metric) and magnitude bin."""

    table: dict[tuple[str, str], tuple[np.ndarray, np.ndarray, np.ndarray]]  # bins, q10, q90 (sorted by bin)

    def interval(self, source: str, metric: str, value: float) -> tuple[float, float]:
        if source == "VIIRS_SNPP" or value <= 0 or (source, metric) not in self.table:
            return value, value
        bins, q10, q90 = self.table[(source, metric)]
        b = int(np.floor(np.log10(value + 1) * 2))
        i = int(np.clip(np.searchsorted(bins, b), 0, len(bins) - 1))
        if bins[i] != b and i > 0 and abs(bins[i - 1] - b) < abs(bins[i] - b):
            i -= 1
        low, high = value * float(q10[i]), value * float(q90[i])
        return min(low, value), max(high, value)


class Data:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.dir: Path = settings.data_dir
        self._lock = threading.Lock()
        self.con = duckdb.connect()
        self.con.execute(f"SET memory_limit='{settings.duckdb_memory_limit}'; SET threads={settings.duckdb_threads}")
        spill = self.dir / "_tmp" / "spill_api"
        self.con.execute(f"SET temp_directory='{spill.as_posix()}'")
        for name in ("grid_daily", "grid_monthly"):
            path = self.dir / f"{name}.parquet"
            if not path.exists():
                raise FileNotFoundError(
                    f"{path} not found — run the pipeline or unpack the data archive (data/README.md)"
                )
            self.con.execute(f"CREATE VIEW {name} AS SELECT * FROM read_parquet('{path.as_posix()}')")
        coef = (self.dir / "coefficients.parquet").as_posix()
        self.con.execute(f"CREATE TABLE coef AS SELECT * FROM read_parquet('{coef}')")
        self.global_coef = self.con.execute(
            "SELECT median(w_count_ta), median(w_count_t), median(w_count_n20), "
            "median(w_frp_ta), median(w_frp_t), median(w_frp_n20) FROM coef"
        ).fetchone()
        summary_path = self.dir / "harmonized" / "summary.json"
        self.summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.exists() else {}
        if g := self.summary.get("global_coefficients"):
            self.global_coef = (g["count_ta"], g["count_t"], g["count_n20"], g["frp_ta"], g["frp_t"], g["frp_n20"])
        self.outages = lead.load_outages(self.dir / "outage_months.csv")
        self.uncertainty = self._load_uncertainty()
        self.last_date = self.con.execute("SELECT max(date) FROM grid_daily").fetchone()[0]
        self.first_date = lead.FIRST_DATE  # dataset start; the first fire day may come later
        self.last_standard_date = self._last_standard_date()

    def cursor(self) -> duckdb.DuckDBPyConnection:
        with self._lock:
            return self.con.cursor()

    def _load_uncertainty(self) -> Uncertainty:
        path = self.dir / "uncertainty.parquet"
        table = {}
        if path.exists():
            df = self.con.execute(f"SELECT * FROM read_parquet('{path.as_posix()}') ORDER BY basis, metric, bin").df()
            for (basis, metric), g in df.groupby(["basis", "metric"]):
                table[(basis, metric)] = (g["bin"].to_numpy(), g["q10"].to_numpy(), g["q90"].to_numpy())
        return Uncertainty(table)

    def _last_standard_date(self) -> dt.date:
        """Last day of standard-processing (SP) data; later days are near-real-time (NRT)."""
        points = self.dir / "points"
        files = sorted(points.glob(f"*_{self.last_date.year}.parquet")) if points.exists() else []
        for f in files:
            cols = [r[0] for r in self.con.execute(f"DESCRIBE SELECT * FROM read_parquet('{f.as_posix()}')").fetchall()]
            if "quality" in cols:
                d = self.con.execute(
                    f"SELECT max(acq_date) FROM read_parquet('{(points / f'*_{self.last_date.year}.parquet').as_posix()}', "
                    "union_by_name=true) WHERE quality = 'SP'"
                ).fetchone()[0]
                return d or self.last_date
        return self.last_date  # yearly archives are all standard processing

    @cached_property
    def data_version(self) -> str:
        stamp = self.summary.get("generated_at", "")[:10] or str(self.last_date)
        digest = hashlib.sha1(json.dumps(self.summary, sort_keys=True).encode() + str(self.last_date).encode())
        return f"{stamp}-{digest.hexdigest()[:8]}"

    def cells_frame(self, iy: np.ndarray, ix: np.ndarray) -> pd.DataFrame:
        return pd.DataFrame({"iy": iy.astype("int16"), "ix": ix.astype("int16")})
