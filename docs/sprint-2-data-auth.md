# Sprint 2 — dados e autenticação

## Entregas desta etapa
- Migration inicial para cidades, usuários, perfis de motorista, veículos, desafios OTP e sessões.
- Cidade piloto Paulista/PE cadastrada. A área geográfica fica vazia até receber polígono operacional validado.
- Endpoints de solicitação/validação OTP, renovação e encerramento de sessão adicionados ao backend.
- Guard JWT e decorator/guard de papéis disponíveis para uso explícito em controllers.
- Gateway SMS adaptado para a API REST da Zenvia.

## Endpoints de autenticação
Prefixo global padrão `/api/v1`:
- `POST /auth/otp/request`: `{"phone":"+5581999999999","role":"passenger"}`.
- `POST /auth/otp/verify`: `{"phone":"+5581999999999","code":"123456","role":"passenger"}`.
- `POST /auth/session/refresh`: `{"refreshToken":"..."}`; rotaciona o token.
- `POST /auth/session/logout`: `{"refreshToken":"..."}`; revoga a sessão.

## Integração SMS — Zenvia
O gateway envia para `https://api.zenvia.com/v1/channels/sms/messages` com:
- Cabeçalho `X-API-TOKEN: $SMS_API_KEY` e `Content-Type: application/json`.
- Corpo `from`, `to` e `contents: [{ "type": "text", "text": "..." }]`, conforme a API de SMS da Zenvia.
- Variáveis de ambiente: `SMS_PROVIDER=zenvia`, `SMS_API_KEY` (token privado) e `SMS_SENDER_ID` (remetente previamente configurado na conta).

Antes do teste real, confirme que o canal SMS está ativado, que o token tem permissão para envio e que o sender ID está habilitado para sua conta. O teste unitário usa fetch simulado e não envia SMS nem requer credenciais. Nunca grave tokens no repositório, em logs ou no corpo de respostas ao cliente. Em produção, use o gerenciador de secrets da hospedagem.

Referência: [documentação oficial da API Zenvia](https://zenvia.github.io/zenvia-openapi-spec/v1/).

## Regras de segurança implementadas
- Telefone validado em formato E.164 e papel público limitado a passageiro/motorista.
- Código criptograficamente aleatório de seis dígitos, armazenado somente como HMAC e com expiração de cinco minutos.
- Máximo de cinco tentativas por desafio; desafios anteriores são consumidos quando novo código é pedido.
- Limites Redis por telefone e IP para pedidos de código; chaves usam hash dos valores.
- Validação/consumo do OTP e criação de conta/sessão em transação PostgreSQL.
- Access token HS256 de 15 minutos, com issuer/audience e algoritmo fixados.
- Refresh token aleatório opaco, armazenado somente como SHA-256, expiração de 30 dias e rotação em renovação.
- Logout revoga refresh token. Access tokens já emitidos continuam válidos até expirar (no máximo 15 minutos); invalidação imediata exige checagem de sessão/revogação em cada request.
- SMS e tokens falham fechados se configuração de segredo/provedor estiver ausente. Nenhum OTP é escrito em logs.

## Configuração
Defina `AUTH_OTP_HMAC_SECRET` e `JWT_ACCESS_SECRET` com valores aleatórios de pelo menos 32 caracteres; configure `JWT_ISSUER`, `JWT_AUDIENCE`, `SMS_PROVIDER=zenvia`, `SMS_API_KEY` e `SMS_SENDER_ID`. Não reutilize segredos de exemplo e não os comite.

## Modelo de identidade
- `users.phone_e164` é único.
- A API pública nunca cria administradores.
- Motoristas novos recebem perfil `pending_review`; cadastro não significa aprovação para operar.
- CNH e placa estão apenas preparadas no schema para futura criptografia; não grave documentos reais antes de implementar criptografia e gestão de chaves.

## Migration
A migration fica em `apps/api/database/migrations/0001_initial_schema.sql`. Faça backup antes de aplicar em ambiente com dados. Ainda não há runner automático; não execute schema no boot da API.

## Antes de uso real
- Instalar dependências com pnpm e confirmar o lockfile no CI.
- Executar migration em banco isolado, build, testes unitários e testes de integração com PostgreSQL/Redis.
- Testar OTP expirado/reutilizado, rate limit e rotação concorrente de refresh.
- Proteger rotas de negócio com guards e checagem de propriedade de recurso; guards não são aplicados globalmente por padrão.
- Configurar TLS, observabilidade, backups, políticas LGPD e proteção contra abuso.
- Fazer teste de envio controlado com número autorizado na conta Zenvia; o teste unitário não comprova a entrega na operadora.
