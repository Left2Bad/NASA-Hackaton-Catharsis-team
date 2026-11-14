# Burn Calendar API: FastAPI + DuckDB over the prepared Parquet files.
# Build context: the repository root (the API serves contract/openapi.yaml at /api/v1/docs).
# The data are not in the image: mount a data folder (data/README.md) read-only at /data.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY constraints.txt ./
COPY contract/openapi.yaml contract/openapi.yaml
COPY backend backend
RUN pip install -c constraints.txt -e ./backend \
    && useradd --system --uid 10001 --no-create-home api

# DATA_DIR is mounted read-only; DuckDB spills large sorts into DATA_DIR/_tmp, which the compose file
# mounts as a separate writable volume. One worker: one DuckDB connection, one memory limit, one cache.
ENV DATA_DIR=/data \
    DUCKDB_MEMORY_LIMIT=1536MB \
    DUCKDB_THREADS=2

USER api
WORKDIR /app/backend
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=4).status != 200)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", \
     "--proxy-headers", "--forwarded-allow-ips", "*", "--no-server-header"]
