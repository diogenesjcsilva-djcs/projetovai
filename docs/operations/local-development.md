# Desenvolvimento local

1. Instale Node.js 22 LTS, pnpm 9+ e Docker.
2. Copie `.env.example` para `.env`.
3. Execute `docker compose up -d`.
4. Execute `pnpm install`.
5. Execute `pnpm --filter @transporte/api start:dev`.
6. Verifique `/api/v1/health` e `/api/v1/health/ready`.

O endpoint de readiness exige PostgreSQL e Redis acessíveis. O endpoint de liveness verifica apenas que a aplicação responde.
