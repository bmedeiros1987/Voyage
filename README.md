# Voyage

**Importe sua viagem. O Voyage cuida do resto.**

Voyage é o produto de jornada para passageiros do ecossistema CrewCheck, mantido em repositório próprio para preservar ciclos de release, domínio e governança separados.

## Princípios

- Voyage e CrewCheck são produtos separados.
- Integrações compartilhadas acontecem por APIs/contratos versionados, nunca por importação direta do parser/canônico do CrewCheck.
- A IA não inventa fatos de viagem: reservas, voos, hotéis, portões, horários e transporte carregam proveniência, freshness e confiança.
- O usuário controla memória, integrações e permissões.
- O Concierge deve transformar dados estruturados em decisões úteis, não substituir os motores determinísticos.

## Primeira fundação

1. Voyage Intelligence / Concierge AI.
2. Hotel Intelligence com perfil estruturado de quarto.
3. Universal Travel Importer para reservas/API/e-mail/PDF/cartão de embarque.
4. Journey + Guardian + Mobility.
5. Integrações oficiais (Booking Data Portability, Onfly/CVC quando autorizadas).

## Hotel Intelligence

Relatos de quarto não são reduzidos a notas genéricas. Ruído, por exemplo, é classificado por origem (`avenida`, `aeroporto`, `obra`, `elevador`, `corredor`, `vizinho`, `área de lazer`, `infraestrutura`, `vida noturna`, `temporário`), período, intensidade, recorrência, proveniência e validade temporal.

Um hóspede barulhento não transforma permanentemente o quarto em “barulhento”; uma avenida, elevador ou infraestrutura recorrente pode formar uma característica estrutural quando houver evidência suficiente.
