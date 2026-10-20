# Decisões de arquitetura — versão inicial

## Contexto
Plataforma de transporte sob demanda com cidade piloto em Paulista, Pernambuco. Android será a primeira plataforma móvel. Login por telefone com código por SMS. Pagamentos planejados: Pix, cartão e dinheiro.

## Decisões
1. Monólito modular NestJS para reduzir complexidade operacional no MVP.
2. React Native + Expo para os dois aplicativos móveis, com possibilidade de iOS posterior.
3. PostgreSQL/PostGIS como fonte de verdade para dados transacionais e consultas geográficas.
4. Redis para dados temporários, presença, coordenação e filas.
5. REST para comandos/consultas e WebSockets para eventos em tempo real.
6. Infraestrutura gerenciada, a ser selecionada após prova de conceito de WebSockets e processos persistentes.
7. Provedor de SMS, mapas e pagamentos será selecionado antes das respectivas integrações.
8. Comandos críticos terão validação de autorização no servidor; operações sensíveis serão idempotentes.

## Consequências
- Evitar microserviços até que escala ou limites de domínio justifiquem sua adoção.
- Não armazenar segredos no repositório.
- Não confiar em preço, localização, estado de corrida ou pagamento informados pelo cliente sem validação do backend.
- Testar concorrência no aceite e idempotência nos pagamentos antes do piloto.
