# Sprint 4 — política de tarifa e despacho de motoristas

## Objetivo

Definir e implementar o primeiro fluxo de estimativa e seleção de motoristas sem confiar em valores enviados pelo aplicativo, sem cobrança e sem dependência de provedor de mapas nesta etapa.

## Constatações da revisão da main

- `CreateRideDto` aceita `estimatedDistanceMeters` e `estimatedDurationSeconds`.
- `RidesService.create` persiste esses dois campos diretamente no banco.
- O contrato da Sprint 3 já determina que distância, duração e tarifa não devem ser aceitas como autoridade do cliente.
- O aceite individual já valida motorista ativo, perfil aprovado, disponibilidade, localização recente e cidade da corrida.
- A criação da corrida ainda inicia em `requested`; não há seleção ordenada de candidatos nem transição automática para `searching`.

## Decisões técnicas propostas

### 1. Estimativa

- Criar `POST /api/v1/rides/estimate` autenticado para papel `passenger`.
- Calcular distância em linha reta no servidor usando as coordenadas recebidas e a fórmula Haversine.
- Não apresentar distância em linha reta como distância viária nem duração de rota.
- Não inventar uma tarifa comercial: a estimativa monetária só fica habilitada quando a política de preços for configurada por cidade (valor base, valor por km, valor por minuto, tarifa mínima e eventual fator de demanda).
- Configuração ausente ou inválida deve falhar de forma fechada (503/configuração indisponível), nunca usar preço zero ou tarifa silenciosamente arbitrária.
- A resposta deve identificar versão da política e validade da estimativa. A criação da corrida deve recalcular no servidor e persistir os valores calculados, não aceitar totais enviados pelo cliente.

### 2. Despacho

- Buscar apenas motoristas da mesma cidade, ativos, não excluídos, com perfil aprovado, disponíveis e localização recente (janela configurável e limitada).
- Usar PostGIS `ST_DWithin` para limitar candidatos por raio e `ST_Distance` para ordenar proximidade.
- Retornar somente identificadores mínimos e distância aproximada; nunca expor localização precisa de outros motoristas ao passageiro.
- Não reservar o motorista durante a listagem. O aceite continua atômico no banco para evitar dupla aceitação.
- Iniciar em ondas de raio configurável e expiração curta; sem websocket, usar polling autenticado na primeira versão.
- Se nenhum candidato estiver disponível, manter estado explícito de busca/sem motorista e permitir cancelamento seguro.

### 3. Segurança e integridade

- Remover distância/duração estimadas do DTO de criação; o `ValidationPipe` com `forbidNonWhitelisted` deve rejeitar esses campos antigos.
- Não aceitar tarifa final do cliente como autoridade. Definir origem do valor final (cálculo servidor/ajuste autorizado) antes de liberar conclusão comercial.
- Validar que o solicitante é passageiro ativo e que as coordenadas pertencem à área operacional permitida, quando o polígono da cidade estiver cadastrado.
- Persistir evento de início de busca e eventos de despacho/expiração na mesma transação da mudança de estado.
- Evitar divulgar dados pessoais ou coordenadas exatas de candidatos.
- Manter idempotência por passageiro.

## Critérios de aceite

- Testes unitários para Haversine, arredondamento em centavos, política ausente/inválida e limites da estimativa.
- Testes de integração PostGIS para raio, ordenação, cidade, perfil aprovado, disponibilidade e localização expirada.
- Teste de concorrência confirmando que apenas um motorista consegue aceitar uma corrida.
- Teste de contrato confirmando que campos de preço/distância enviados pelo cliente são rejeitados.
- CI deve executar migrations 0001 e 0002 em banco efêmero e testes sem acessar Neon de produção.
- Nenhuma migration ou deploy em ambiente persistente nesta sprint sem aprovação explícita.

## Bloqueios de produto antes de ativar tarifa

A política comercial ainda precisa ser aprovada: valor base, preço por km, preço por minuto, tarifa mínima, arredondamento, cancelamento, espera, adicional noturno/demanda e regras de repasse. Até isso existir, a API não deve apresentar uma tarifa monetária como preço real.
