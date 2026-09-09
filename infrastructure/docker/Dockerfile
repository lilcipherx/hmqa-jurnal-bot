FROM node:24.11.1-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@11.19.0 --activate
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm db:generate
RUN pnpm build

FROM node:24.11.1-bookworm-slim AS runtime-base
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-dejavu-core fonts-liberation libreoffice-writer-nogui openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@11.19.0 --activate \
  && mkdir -p /workspace /var/lib/hmqa/quarantine \
  && chown -R node:node /workspace /var/lib/hmqa
WORKDIR /workspace

FROM runtime-base AS verification
COPY --from=build --chown=node:node /workspace /workspace
USER node
CMD ["pnpm", "--filter", "@hmqa/api", "start"]

FROM verification AS browser-verification
USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN pnpm exec playwright install --with-deps chromium firefox webkit \
  && chmod -R a+rX /ms-playwright
USER node
CMD ["pnpm", "test:browser"]

FROM runtime-base AS runtime
ARG DEPLOYED_SHA=development
LABEL org.opencontainers.image.revision=$DEPLOYED_SHA
COPY --from=build --chown=node:node /workspace/package.json /workspace/pnpm-lock.yaml /workspace/pnpm-workspace.yaml /workspace/.npmrc ./
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules

COPY --from=build --chown=node:node /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /workspace/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /workspace/apps/bot/package.json ./apps/bot/package.json
COPY --from=build --chown=node:node /workspace/apps/bot/node_modules ./apps/bot/node_modules
COPY --from=build --chown=node:node /workspace/apps/bot/dist ./apps/bot/dist
COPY --from=build --chown=node:node /workspace/apps/worker/package.json ./apps/worker/package.json
COPY --from=build --chown=node:node /workspace/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build --chown=node:node /workspace/apps/worker/dist ./apps/worker/dist
COPY --from=build --chown=node:node /workspace/apps/admin-web/package.json ./apps/admin-web/package.json
COPY --from=build --chown=node:node /workspace/apps/admin-web/node_modules ./apps/admin-web/node_modules
COPY --from=build --chown=node:node /workspace/apps/admin-web/.next ./apps/admin-web/.next
COPY --from=build --chown=node:node /workspace/apps/admin-web/next.config.ts ./apps/admin-web/next.config.ts

COPY --from=build --chown=node:node /workspace/packages/config/package.json ./packages/config/package.json
COPY --from=build --chown=node:node /workspace/packages/config/node_modules ./packages/config/node_modules
COPY --from=build --chown=node:node /workspace/packages/config/dist ./packages/config/dist
COPY --from=build --chown=node:node /workspace/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /workspace/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=build --chown=node:node /workspace/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /workspace/packages/database/package.json ./packages/database/package.json
COPY --from=build --chown=node:node /workspace/packages/database/node_modules ./packages/database/node_modules
COPY --from=build --chown=node:node /workspace/packages/database/dist ./packages/database/dist
COPY --from=build --chown=node:node /workspace/packages/database/prisma ./packages/database/prisma
COPY --from=build --chown=node:node /workspace/packages/database/prisma.config.ts ./packages/database/prisma.config.ts
COPY --from=build --chown=node:node /workspace/packages/domain/package.json ./packages/domain/package.json
COPY --from=build --chown=node:node /workspace/packages/domain/dist ./packages/domain/dist
COPY --from=build --chown=node:node /workspace/packages/i18n/package.json ./packages/i18n/package.json
COPY --from=build --chown=node:node /workspace/packages/i18n/dist ./packages/i18n/dist
COPY --from=build --chown=node:node /workspace/packages/logger/package.json ./packages/logger/package.json
COPY --from=build --chown=node:node /workspace/packages/logger/node_modules ./packages/logger/node_modules
COPY --from=build --chown=node:node /workspace/packages/logger/dist ./packages/logger/dist
COPY --from=build --chown=node:node /workspace/packages/security/package.json ./packages/security/package.json
COPY --from=build --chown=node:node /workspace/packages/security/node_modules ./packages/security/node_modules
COPY --from=build --chown=node:node /workspace/packages/security/dist ./packages/security/dist
COPY --from=build --chown=node:node /workspace/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=node:node /workspace/packages/shared/dist ./packages/shared/dist

USER node
CMD ["pnpm", "--filter", "@hmqa/api", "start"]
