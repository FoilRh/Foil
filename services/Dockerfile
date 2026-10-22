# Shared image for Bun services. Build from the repo root, e.g.:
#   fly deploy . --config services/relayer/fly.toml --dockerfile services/Dockerfile --app <app>
# Tag kept for readability; the multi-arch index digest is what is pulled (registry-1.docker.io, 2026-10-22).
FROM oven/bun:1.3.13-slim@sha256:7e8ed3961db1cdedf17d516dda87948cfedbd294f53bf16462e5b57ed3fff0f1
WORKDIR /app
ARG SERVICE
COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
# Every workspace manifest bun.lock references (their sources are not needed here).
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/extension/package.json ./apps/extension/package.json
COPY circuits/package.json ./circuits/package.json
RUN bun install --frozen-lockfile --production --filter "@foil/${SERVICE}"
ENV NODE_ENV=production SERVICE=${SERVICE}
USER bun
CMD ["sh", "-c", "bun services/${SERVICE}/src/main.ts"]
