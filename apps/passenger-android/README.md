# App do passageiro — ProjetoVai

Aplicativo React Native + Expo, Android primeiro e iOS preparado para uma etapa posterior.

## Requisitos

- Node.js 22+
- pnpm 9+
- Expo Go ou Android Emulator

## Executar

Na raiz do monorepo:

```bash
pnpm install
pnpm --filter @transporte/passenger-android start
```

Para apontar para outro ambiente, defina `EXPO_PUBLIC_API_URL` com a URL completa do prefixo da API, por exemplo `https://api.exemplo.com/api/v1`. O padrão é o staging do ProjetoVai.

## Autenticação de homologação

O app usa OTP da API e guarda access/refresh tokens no SecureStore do dispositivo. Para testar sem SMS real, configure **somente no serviço Render de staging**:

- `APP_ENV=staging`
- `AUTH_OTP_MODE=development`

Nesse modo, a API devolve o código gerado no campo `developmentCode`; o app o apresenta na tela para homologação. Não habilite esse modo em produção. O modo normal continua usando o gateway SMSGo e não revela o código.

## Fluxo implementado

- Login de passageiro por telefone e OTP.
- Renovação automática de sessão após HTTP 401 e logout com revogação do refresh token.
- Entrada dos endereços de embarque e destino com geocodificação nativa do dispositivo.
- Consulta de estimativa antes da solicitação.
- A solicitação é bloqueada quando a API não retorna tarifa disponível; o app não inventa preço.
- Acompanhamento do status da corrida por polling a cada cinco segundos.

## Limitações desta primeira entrega

- A tela usa campos de endereço, ainda sem mapa interativo.
- A API de Paulista ainda não possui política tarifária operacional confirmada e a estimativa de duração/valor pode estar indisponível. Nesse caso, o app informa o motivo e não cria uma corrida.
- Mapas/rotas, push notifications e pagamentos permanecem fora desta entrega.
