# Deployment with Coolify

The production site is one Docker Compose stack (`docker-compose.yml` in the repository root) with two containers:

| Service | Image | What it does | Memory cap |
| --- | --- | --- | --- |
| `web` | `deploy/web.Dockerfile`: the built frontend on nginx | serves the site, proxies `/api/v1/*` to `api`, gzips JSON and CSV | 128 MB |
| `api` | `deploy/api.Dockerfile`: FastAPI + DuckDB, `uvicorn --workers 1` | the API over the data folder | 2.5 GB (no swap) |

Only `web` gets a domain, so the frontend and the API share one origin (`https://<domain>/` and
`https://<domain>/api/v1/`) and no CORS is needed. The frontend is built with `VITE_API_URL=/api/v1` and
`VITE_API_FALLBACK=off`: in production it never falls back to the saved snapshot answers.

## Memory budget

The server this was written for has 8 GB of RAM, of which about 3 GB are free (other services run on it).

- `api` has a hard cap `mem_limit = memswap_limit = 2560m`: a runaway query kills only this container, which Docker
  restarts, and the neighbours are not pushed into swap.
- DuckDB is limited inside that cap: `DUCKDB_MEMORY_LIMIT=1536MB`, `DUCKDB_THREADS=2`. Larger sorts spill to
  `BURN_SPILL_DIR` on disk (at most 4 GB, `SPILL_LIMIT` in `backend/app/main.py`).
- `api` may use at most 1.5 CPUs (`cpus` in `docker-compose.yml`), so the neighbours keep a core.
- One uvicorn worker: one DuckDB connection, one memory limit, one `/calendar` cache.
- The image build (npm + Vite) needs about 1 GB more for a few minutes during a deploy.

With more free memory, raise `API_MEM_LIMIT` and `DUCKDB_MEMORY_LIMIT` together (keep DuckDB at about 60 % of the cap:
pandas, Arrow and the response buffers live outside DuckDB's limit).

## 1. The data on the server

The images hold no data. Put a data folder (layout in `data/README.md`) on the host; only these parts are needed:

```bash
mkdir -p /srv/burn-calendar/dl && cd /srv/burn-calendar/dl
curl -LO https://github.com/Left2Bad/NASA-Hackaton-Catharsis-team/releases/download/data-2026-11-13/FIRMS_data_2026-11-13.zip
sha256sum FIRMS_data_2026-11-13.zip   # compare with SHA256SUMS.txt of the release
unzip -q FIRMS_data_2026-11-13.zip -d /srv/burn-calendar   # creates /srv/burn-calendar/data (1.0 GB)
# without unzip: python3 -m zipfile -e FIRMS_data_2026-11-13.zip /srv/burn-calendar
```

The single detections for the map and the hot spot CSV, `data/points_serve/` (5.7 GB, 51 files), are not in the
release because of their size. Make them with the pipeline (`data/README.md`, steps 0, 1, 5 and 6: download the FIRMS
archives, convert them, then `python pipeline/points_serve.py`; the archives are 9.3 GB and the conversion needs
about 9 GB of RAM, so do it on a workstation, not on the server). Copy the folder to
`/srv/burn-calendar/data/points_serve/`, for example with `rsync -avP data/points_serve/ root@<server>:/srv/burn-calendar/data/points_serve/`,
and compare the sizes (`du -sb` gives 6077284776 bytes for the 2026-11-13 data). Do not copy `data/raw/` or the full
`data/points/`. Without `points_serve/` everything works except the hot spots on the map and their CSV.

Prepare the folders the containers mount:

```bash
chmod -R a+rX,go-w /srv/burn-calendar/data     # readable by the api user (uid 10001), not writable
mkdir -p /srv/burn-calendar/data/_tmp            # mount point of the spill folder inside the read-only data
mkdir -p /srv/burn-calendar/spill && chown 10001:10001 /srv/burn-calendar/spill   # uid of the api user
```

## 2. The resource in Coolify

1. **Projects → (a project) → Add New Resource → Public Repository**.
2. Repository `https://github.com/Left2Bad/NASA-Hackaton-Catharsis-team`, branch `main`.
3. **Build Pack: Docker Compose**, base directory `/`, compose file `/docker-compose.yml`.
4. After Coolify reads the compose file, set **Domains for web** to `https://<domain>` (for example
   `https://nasa.pin-planet.org`). Leave **api** without a domain.
5. **Environment variables** (all optional; the defaults are in `docker-compose.yml`):

   | Variable | Default | Meaning |
   | --- | --- | --- |
   | `BURN_DATA_DIR` | `/srv/burn-calendar/data` | host data folder, mounted read-only |
   | `BURN_SPILL_DIR` | `/srv/burn-calendar/spill` | host folder for DuckDB temp files |
   | `API_MEM_LIMIT` | `2560m` | hard memory cap of `api` |
   | `DUCKDB_MEMORY_LIMIT` | `1536MB` | DuckDB memory limit inside it |
   | `DUCKDB_THREADS` | `2` | DuckDB threads |

   There are no secrets: the API reads only public prepared data.
6. **Deploy**. The first build takes a few minutes; `web` starts after `api` is healthy.

The DNS record of the domain must point at the server (an `A` record). If the proxy already holds a certificate that
covers the domain, Traefik serves it instead of asking Let's Encrypt. On the demo server that is a Cloudflare Origin
certificate for `*.pin-planet.org`, so the record `nasa` must be **Proxied** in Cloudflare (SSL mode Full): with
"DNS only" browsers reject the certificate. Without such a certificate, "DNS only" lets Traefik get one from
Let's Encrypt. Cloudflare closes a proxied request that sends nothing for 100 s; the largest allowed export starts
answering in about 5 s.

The same stack runs without Coolify: `docker compose up -d --build` in the repository root, with your own reverse proxy
in front of `web`.

## 3. Checks after a deploy

```bash
curl -s https://<domain>/api/v1/health
curl -s https://<domain>/api/v1/meta | head -c 400
curl -s -o /dev/null -w '%{http_code} %{size_download} %{time_total}s\n' -H 'Content-Type: application/json' \
  -d '{"geometry":{"type":"Polygon","coordinates":[[[61,51],[71,51],[71,55],[61,55],[61,51]]]}}' \
  https://<domain>/api/v1/calendar
curl -s -o /dev/null -w '%{http_code} %{size_download}
' -H 'Content-Type: application/json'   -d '{"geometry":{"type":"Polygon","coordinates":[[[61,51],[71,51],[71,55],[61,55],[61,51]]]},"year":2025,"month":5}'   https://<domain>/api/v1/points   # 200 and a few MB: points_serve/ is mounted
docker stats --no-stream      # api should stay well below its cap
```

Open the site: the calendars of the three example areas show real data and the "Method" page opens.

## Updating the data

Replace the files in `/srv/burn-calendar/data` (stop the stack first or swap the whole folder) and restart the
resource in Coolify: the API reads the data folder at start. A new folder needs the same preparation as above: the
`_tmp/` mount point, `points_serve/` and `chmod -R a+rX,go-w`.

## Measured on the demo server (2026-11-14)

8 GB RAM, 2 cores, other services running; requests through Cloudflare.

| Request | Answer | Time |
| --- | --- | --- |
| `/calendar`, 4 areas at once (3 presets + 2.7 million km²), first time | 70 KB each | 2.0–3.0 s |
| the same, from the cache | 70 KB each | 0.4–0.5 s |
| `/points`, 2.7 million km² of the Amazon, one month (capped at 20,000 points) | 5.1 MB | 1.7–2.6 s |
| `/export/points.csv`, one year, ~470,000 rows (just under the 500,000 limit) | 37 MB | 10.8 s (first byte 3.8 s) |
| export + `/points` + 8 `/calendar` at once | — | export 10 s, points 2–8 s |

Peak memory of `api` under this load: 912 MB of its 2.5 GB cap (idle: about 100 MB, after the load about 700 MB of
DuckDB cache); no swap used, no restarts, the lowest available memory on the host 2.9 GB.
