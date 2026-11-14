"""Lead-source rule shared with the pipeline: loads pipeline/lead.py so both use one implementation."""

import importlib.util
from pathlib import Path

_PATH = Path(__file__).resolve().parents[2] / "pipeline" / "lead.py"
_spec = importlib.util.spec_from_file_location("pipeline_lead", _PATH)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

FIRST_DATE = _mod.FIRST_DATE
AQUA_START = _mod.AQUA_START
SNPP_START = _mod.SNPP_START
SNPP_END = _mod.SNPP_END
N20_FIRST = _mod.N20_FIRST
LABELS = _mod.LABELS
PERIODS = _mod.PERIODS
lead_source = _mod.lead_source
lead_sql = _mod.lead_sql
value_sql = _mod.value_sql
load_outages = _mod.load_outages
