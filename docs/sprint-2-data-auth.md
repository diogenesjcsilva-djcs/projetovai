# Sprint 2 — dados e autenticação

## Entregas desta etapa
- Migration inicial para cidades, usuários, perfis de motorista, veículos, desafios OTP e sessões.
- Cidade piloto cadastrada como Paulista/PE. A área geográfica está deliberadamente vazia até receber o polígono operacional validado.
- Contrato de segurança para concluir o fluxo OTP e a emissão/renovação de tokens.

## Modelo de identidade
- Um telefone E.164 identifica uma conta (\`users.phone_e164\` é único).
- O papel inicial é explícito: \`passenger\`, \`driver\` ou \`admin\`. A criação de uma conta administrativa nunca deve ser pública.
- Perfil de motorista e veículo são submetidos a aprovação; cadastro não implica autorização para receber corridas.
- O backend deve validar o estado da conta, o papel e a relação com o recurso em toda operação protegida.

## Regras obrigatórias para OTP
1. Normalizar e validar o telefone no servidor em formato E.164.
2. Gerar código criptograficamente aleatório de uso único; nunca aceitar o código enviado pelo cliente como prova sem validação server-side.
3. Armazenar apenas HMAC/hash do código com segredo gerenciado, nunca o código em texto puro.
4. Expiração curta (recomendação: 5 minutos), limite de tentativas por desafio (máximo 5) e limite de envio por telefone/IP com Redis e defesa adicional contra abuso.
5. Invalidar desafios anteriores quando um novo for emitido; consumir o desafio atomicamente após validação.
6. Respostas de solicitação não devem revelar se o telefone já possui conta.
7. Não registrar telefone completo, OTP, token, segredo ou payload sensível em logs.
8. Se o provedor SMS estiver indisponível, falhar de modo seguro. Não criar fallback de OTP em logs em produção.

## Sessões e tokens
- Access token de curta duração (ex.: 10–15 minutos), assinado com chave/secreto gerenciado e validado pelo servidor.
- Refresh token opaco e aleatório, armazenar somente hash; rotacionar a cada uso, revogar em logout e detectar reutilização.
- Verificar issuer, audience, expiração e algoritmo permitido; nunca aceitar algoritmo escolhido pelo token.
- Aplicativos móveis devem armazenar tokens em armazenamento seguro do sistema operacional.
- Implementar rate limiting no endpoint, TLS obrigatório e CORS restrito por ambiente.

## Aplicação da migration
A migration está em \`apps/api/database/migrations/0001_initial_schema.sql\`. Faça backup antes de aplicar em ambiente com dados. Para desenvolvimento local, suba o PostGIS via Docker Compose e aplique a migration com uma ferramenta aprovada pela equipe. Ainda não há runner de migrations automático; não execute SQL de schema automaticamente no boot da API.

## O que ainda não está concluído
Esta migration define a estrutura de dados, mas não ativa endpoints OTP, provedor SMS, emissão/renovação JWT, guards de autorização nem telas móveis. Isso deve ser concluído e testado antes de qualquer exposição pública da API.
