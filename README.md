# ProjetoVai — plataforma de transporte sob demanda

MVP para operação piloto em Paulista, Pernambuco. O backend é um monólito modular NestJS; os clientes móveis usam React Native + Expo, com Android como primeira plataforma.

## Estrutura do monorepo

- `apps/api`: API NestJS/TypeScript, autenticação OTP, sessões, corridas, estimativas, despacho geográfico, política tarifária e feed de eventos.
- `apps/passenger-android`: aplicativo Expo do passageiro (Sprint 7 em andamento).
- `apps/driver-android`: espaço reservado para o aplicativo do motorista.
- `apps/admin-web`: espaço reservado para o painel administrativo.
- `packages/contracts`: tipos compartilhados entre clientes e servidor.
- PostgreSQL/PostGIS e Redis para persistência, consultas geográficas e coordenação.

## Decisões de arquitetura

- Cidade piloto: Paulista, Região Metropolitana do Recife, Pernambuco.
- Android primeiro; React Native + Expo permite preparar iOS posteriormente.
- PostgreSQL/PostGIS como fonte de verdade; Redis para estado temporário e coordenação.
- API REST versionada em `/api/v1`.
- Login por telefone com OTP; SMS real permanece pausado durante a homologação.
- Pagamentos planejados: Pix, cartão e dinheiro. Nenhum fluxo de pagamento está ativo ainda.

## Aplicativo do passageiro

Na raiz do repositório:

```bash
pnpm install
pnpm --filter @transporte/passenger-android start
```

O app usa por padrão o backend de staging. Para outro ambiente, defina `EXPO_PUBLIC_API_URL` com a URL completa incluindo `/api/v1`.

A Sprint 7 está em andamento no PR #7. O fluxo atual inclui login OTP, sessão segura, geocodificação de endereços, consulta de estimativa e polling do status da corrida. A solicitação é bloqueada quando a API não fornece tarifa válida.

Para autenticação sem SMS real, o backend só devolve o OTP quando as duas variáveis abaixo estiverem configuradas **exclusivamente no Render staging**:

- `APP_ENV=staging`
- `AUTH_OTP_MODE=development`

Não habilite o modo de simulação em produção.

## Estado do piloto

- A API de staging está hospedada no Render.
- A infraestrutura de dados usa Neon PostgreSQL/PostGIS e Redis.
- O backend já possui estrutura de estimativa, criação, busca/aceite de corridas, concorrência e feed de eventos.
- A política tarifária operacional de Paulista e o cálculo de duração/rota ainda precisam ser validados. Enquanto não houver estimativa de tarifa válida, o app não solicita uma corrida.
- O aplicativo do motorista, mapas/rotas, notificações push e pagamentos ainda precisam ser desenvolvidos/integrados.

## Validação

```bash
pnpm install
pnpm --filter @transporte/api build
pnpm --filter @transporte/api test
pnpm --filter @transporte/passenger-android typecheck
pnpm --filter @transporte/passenger-android export:android
```

O CI também valida migrations PostgreSQL/PostGIS e testes de integração com banco e Redis.

## Segurança e produção

- Nunca grave segredos no repositório ou em logs.
- Não aplique migrations no banco de produção sem backup e autorização explícita.
- Antes do piloto: configurar TLS, domínio, CORS restrito, rate limits, secrets gerenciados, backups/restauração, observabilidade e revisão LGPD.
- Selecionar e validar provedores de mapas/rotas, SMS, push e pagamentos antes de ativar essas integrações.
