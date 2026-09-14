# Dietary Safety — Voyage

O Voyage trata alimentação em duas camadas diferentes:

1. **Preferências** — vegan, vegetariano, halal, kosher, culinárias preferidas etc. Podem influenciar ranking.
2. **Restrições de segurança** — intolerâncias, alergias e alergias severas. Funcionam como restrições duras do planejador.

## Princípios

- O sistema nunca deduz segurança alimentar a partir de nota, popularidade, tipo de culinária ou nome do prato.
- Informações desconhecidas de alergênicos ou contaminação cruzada permanecem `UNKNOWN`.
- Para alergia/alergia severa, `UNKNOWN` bloqueia recomendação automática até haver evidência suficiente.
- Um local pode ser ótimo para uma preferência e simultaneamente inadequado para uma alergia.
- Cada viajante mantém perfil individual; em refeições de grupo, o planejador usa a restrição mais rigorosa aplicável.
- O padrão de colaboração compartilha apenas os requisitos necessários para planejar uma refeição segura. Detalhes individuais permanecem privados salvo compartilhamento explícito.

## Severidade

- `PREFERENCE`
- `INTOLERANCE`
- `ALLERGY`
- `SEVERE_ALLERGY`

Alergias severas ativam automaticamente a preocupação com contaminação cruzada. Alergias podem exigir confirmação de equipe/menu antes da recomendação final.

## Evidência do estabelecimento

Estados de restrição:

- `SUPPORTED`
- `UNSUPPORTED`
- `CONTAINS`
- `UNKNOWN`

Confiança da informação:

- `UNKNOWN`
- `USER_REPORTED`
- `VENUE_REPORTED`
- `MENU_VERIFIED`
- `STAFF_CONFIRMED`

Contaminação cruzada:

- `SAFE`
- `UNSAFE`
- `UNKNOWN`

A evidência deve carregar fonte, data de verificação e, futuramente, validade/freshness.

## Planejamento

O motor alimentar deve ser executado antes de ranking por nota, distância ou preço. Candidatos bloqueados por segurança não entram na otimização automática.

Fluxo esperado:

```text
DietaryProfile
  -> venue/menu evidence
  -> DietarySafetyCheck
  -> hard-block unsafe/unknown allergy cases
  -> rank eligible venues
  -> optimize route/time
```

O Voyage também poderá produzir um cartão de restrições para acesso offline durante a viagem. Esse cartão comunica requisitos fornecidos pelo usuário; não certifica segurança médica de um estabelecimento ou prato.

## Persistência

`db/004_dietary_safety.sql` adiciona:

- `dietary_profiles`
- `dietary_restrictions`
- `venue_dietary_evidence`
- `trip_dietary_snapshots`
- `meal_safety_checks`

Snapshots por viagem permitem que mudanças futuras no perfil não alterem silenciosamente o histórico de decisões já tomadas.
