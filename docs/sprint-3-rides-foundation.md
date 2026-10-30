# Sprint 3 — fundação de corridas

## Escopo desta etapa

Esta sprint estabelece o modelo persistente para solicitações de corrida, eventos do ciclo de vida e localização/disponibilidade de motoristas. A migration `0002_rides_foundation.sql` deve ser aplicada somente depois de `0001_initial_schema.sql`.

## Contrato de domínio

### Estados da corrida

- `requested`: solicitação criada pelo passageiro.
- `searching`: backend iniciou a busca por motoristas elegíveis.
- `accepted`: um motorista aceitou a corrida.
- `driver_arriving`: motorista está a caminho do embarque.
- `in_progress`: viagem iniciada.
- `completed`: viagem concluída.
- `cancelled`: corrida cancelada.

Transições permitidas serão impostas no serviço de domínio, nunca confiadas ao estado enviado pelo aplicativo. A aceitação precisa usar transação e bloqueio/atualização condicional para impedir que dois motoristas aceitem a mesma corrida.

## Dados e segurança

- Passageiro e motorista são referenciados por usuários já autenticados.
- Coordenadas são armazenadas como `geography(Point, 4326)`; latitude/longitude devem ser validadas e convertidas pelo backend.
- A disponibilidade do motorista é mantida separadamente da corrida e não concede elegibilidade por si só: o backend também deve verificar conta ativa, perfil de motorista aprovado e atualização recente da localização.
- `idempotency_key` é única por passageiro para evitar duplicação de solicitações em retries.
- `ride_events` registra as transições com ator e horário para auditoria.
- Valores monetários são inteiros em centavos e moeda BRL. Não há tarifa fixa embutida nesta migration.

## Limites explícitos

- Não há integração de mapas/roteamento nesta etapa. Distância, duração e tarifa estimadas só devem ser preenchidas quando uma fonte confiável e uma política de preços forem definidas; o backend não deve aceitar esses valores como autoridade do cliente.
- Não há cobrança ou captura de pagamento nesta etapa.
- Não há despacho automático nem WebSocket nesta migration.
- Não armazenar localização histórica indefinidamente; retenção e expurgo precisam ser definidos antes do piloto.

## Endpoints previstos para a próxima implementação

- `POST /api/v1/rides/estimate`: estimativa calculada no servidor após definir provedor/política.
- `POST /api/v1/rides`: criar solicitação autenticada, com chave de idempotência.
- `GET /api/v1/rides/:id`: consultar corrida somente se o usuário for passageiro ou motorista atribuído, ou admin autorizado.
- `POST /api/v1/rides/:id/accept`: aceite concorrente e atômico por motorista elegível.
- `POST /api/v1/rides/:id/status`: transições restritas por papel e estado atual.
- `PUT /api/v1/drivers/me/location`: atualizar localização do motorista autenticado.

## Validação necessária

A CI deve aplicar as migrations 0001 e 0002 em sequência e testar constraints, índices espaciais, idempotência, isolamento entre usuários, transições inválidas e aceitação concorrente antes de qualquer merge ou deploy.
