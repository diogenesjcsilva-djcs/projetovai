# Modelo de dados inicial

- **cities**: cidades habilitadas e área de operação PostGIS.
- **users**: identidade, telefone E.164, papel, estado da conta e cidade.
- **driver_profiles**: revisão e aprovação do motorista.
- **vehicles**: veículos vinculados ao perfil de motorista, com estado de revisão.
- **auth_otp_challenges**: desafio OTP com hash, expiração, tentativas e consumo.
- **auth_sessions**: hash de refresh token, expiração e revogação.

## Considerações
- Campos de documentos e placa são marcados para criptografia/lookup hash, mas o mecanismo de criptografia e a gestão de chaves ainda precisam ser implementados antes de armazenar dados reais.
- \`plate_lookup_hash\` deve ser um HMAC com segredo gerenciado, não um SHA simples de placa.
- \`service_area\` deve conter um polígono operacional validado; não inferir cobertura a partir do limite municipal.
- A migration cria enums. Mudanças futuras nesses valores devem ser feitas por migrations versionadas.
