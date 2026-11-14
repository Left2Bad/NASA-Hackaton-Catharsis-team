# Burn Calendar web: the built frontend served by nginx, which also proxies /api/v1/* to the API container.
# Build context: the repository root (the build reads contract/ and docs/methodology.md).
FROM node:22-alpine AS build
WORKDIR /repo
COPY contract contract
COPY docs/methodology.md docs/methodology.md
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci --no-audit --no-fund
COPY frontend frontend
# Same origin as the API; never fall back to the saved snapshot answers in production.
ENV VITE_API_URL=/api/v1 \
    VITE_API_FALLBACK=off \
    VITE_API_MOCKS=false
RUN cd frontend && npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/frontend/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
