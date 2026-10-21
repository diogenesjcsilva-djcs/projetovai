FROM node:22-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.5 --activate

WORKDIR /workspace
COPY . .

# The repository currently has no committed pnpm-lock.yaml.
# Once a lockfile is added, switch to --frozen-lockfile for reproducible builds.
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @transporte/api build

ENV NODE_ENV=production
EXPOSE 10000
CMD ["node", "apps/api/dist/main.js"]
