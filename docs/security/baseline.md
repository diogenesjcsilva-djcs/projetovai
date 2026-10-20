# Baseline de segurança

- Não commitar `.env` ou credenciais.
- Usar TLS e secrets gerenciados em produção.
- Implementar rate limiting em login, envio de OTP e endpoints públicos.
- OTP: curta duração, uso único, limite de tentativas, proteção contra abuso e armazenamento seguro do verificador.
- Aplicar autorização por recurso e por papel no servidor.
- Redigir logs para não incluir OTP, tokens, dados completos de cartão ou documentos.
- Validar assinaturas e idempotência de webhooks.
- Limitar acesso a documentos e localização.
- Implementar backups e testar restauração.
- Manter dependências atualizadas e executar análise de vulnerabilidades na CI.
- Não expor a API publicamente até configurar CORS, TLS, autenticação, rate limits e observabilidade.
