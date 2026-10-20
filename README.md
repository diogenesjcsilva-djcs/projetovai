# Plataforma de Transporte — Sprint 1

Base inicial para uma plataforma de transporte sob demanda, com cidade piloto em Paulista/PE.

## O que está incluído

- `apps/api`: API NestJS + TypeScript com endpoints de liveness e readiness.
- `apps/passenger-android`: espaço reservado para o app do passageiro.
- `apps/driver-android`: espaço reservado para o app do motorista.
- `apps/admin-web`: espaço reservado para o painel administrativo.
- `packages/contracts`: tipos compartilhados entre clientes e servidor.
- PostgreSQL com PostGIS e Redis para desenvolvimento local via Docker Compose.
- Pipeline inicial de CI no GitHub Actions.

Esta é apenas a fundação. Autenticação por SMS, corridas, despacho, mapas, notificações e pagamentos ainda não estão implementados.

## Pré-requisitos

- Node.js 22 LTS
- pnpm 9+
- Docker Engine com Docker Compose

## Configuração local

1. Copie `.env.example` para `.env`.
2. Suba os serviços: `docker compose up -d`.
3. Instale as dependências: `pnpm install`.
4. Inicie a API: `pnpm --filter @transporte/api start:dev`.
5. Verifique `http://localhost:3000/api/v1/health` e `http://localhost:3000/api/v1/health/ready`.

`/health` verifica se o processo responde. `/health/ready` verifica também PostgreSQL e Redis.

## Decisões registradas

- Cidade piloto: Paulista, Região Metropolitana do Recife, Pernambuco.
- Hospedagem: infraestrutura gerenciada; fornecedor final a escolher após validar custo, região, WebSockets e processos persistentes.
- Login planejado: telefone com código de uso único por SMS.
- Backend: monólito modular NestJS.
- Banco: PostgreSQL/PostGIS; Redis para estado temporário e coordenação.
- Clientes: Android primeiro, com React Native/Expo para permitir entrega iOS posterior.
- API versionada em `/api/v1`.

## Antes de produção

Configurar TLS, domínio, CORS restrito, rate limits, secrets gerenciados, backups e restauração testada. Selecionar provedores de SMS, mapas, push e pagamentos. Revisar LGPD, regras municipais e operação de transporte remunerado. Não exponha a API publicamente antes de implementar autenticação, autorização, limitação de requisições e observabilidade.
