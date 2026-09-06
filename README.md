# Voyage

**Importe sua viagem. O Voyage cuida do resto.**

Voyage by CrewCheck é o produto de jornada para passageiros do ecossistema CrewCheck, mantido em repositório próprio para preservar ciclos de release, domínio e governança separados.

## Princípios

- Voyage e CrewCheck são produtos separados.
- Integrações compartilhadas acontecem por APIs/contratos versionados, nunca por importação direta do parser/canônico do CrewCheck.
- A IA não inventa fatos de viagem: reservas, voos, hotéis, portões, horários e transporte carregam proveniência, freshness e confiança.
- O usuário controla memória, integrações e permissões.
- O Concierge transforma dados estruturados em decisões úteis, sem substituir motores determinísticos.
- Passageiros e tripulantes sempre informam quantos dias realmente querem usar; a escala do CrewCheck é contexto, não presunção.
- Um documento desconhecido nunca é descartado silenciosamente: ele entra como `OTHER` ou `NEEDS_REVIEW`.

## Fundação atual

```text
Voyage
├── src/                  # voyage-api / Render
├── db/                   # schema TiDB + Universal Importer
├── app/
│   ├── www/              # PWA premium + importação offline-first
│   ├── resources/        # ícone e splash
│   └── capacitor.config.json
├── docs/
│   ├── ARCHITECTURE.md
│   ├── GOOGLE_COMPLIANCE.md
│   └── UNIVERSAL_IMPORTER.md
└── .github/workflows/
    ├── ci.yml
    └── android-apk.yml
```

## Universal Travel Importer

O usuário pode importar um ou vários PDFs manualmente. A taxonomia atual cobre, sem limitar o sistema a esses itens:

- passagem aérea e e-ticket;
- cartão de embarque;
- hotel/hospedagem;
- carro alugado;
- trem, ônibus, ferry e transfer;
- cruzeiro;
- show, festival e evento;
- museu, parque, atração e monumento;
- passeio/tour;
- restaurante;
- seguro viagem;
- sala VIP;
- estacionamento;
- visto/ETA/ESTA/autorização de entrada;
- bagagem;
- qualquer outro PDF (`OTHER`).

A interface guarda PDFs localmente em IndexedDB para funcionar mesmo quando a API não estiver disponível. A sincronização é retomada automaticamente quando houver conectividade.

O parser inicial faz extração best-effort de PDFs digitais, inclusive streams Flate comuns. PDF escaneado, criptografado ou de baixa confiança continua aceito, porém com `NEEDS_REVIEW`. OCR entra como adaptador posterior sem alterar o contrato do pipeline.

Pipeline:

```text
TravelSource
  -> DocumentNormalizer
  -> DocumentClassifier
  -> TravelEntityExtractor
  -> ReservationFingerprint
  -> ReservationMatcher
  -> TripGraph
  -> DomainProjections
```

A deduplicação/matching usa confirmação, provider, voo, rota, data, título e fingerprint determinístico. O TripGraph ordena reservas e cria relações temporais/operacionais para que Guardian, Mobility, Wallet e Hotel Intelligence usem a mesma fonte canônica.

## API

Bootstrap Node sem dependências externas para reduzir risco no primeiro deploy do Render. O serviço escuta `process.env.PORT` em `0.0.0.0`.

Endpoints atuais:

- `GET /health`
- `GET /api/v1/config`
- `GET /api/v1/auth/google/status`
- `GET /api/v1/imports/capabilities`
- `POST /api/v1/imports/pdf` (`Content-Type: application/pdf`)
- `POST /api/v1/imports/manual/preview`
- `GET /api/v1/integrations/gmail/status`
- `POST /api/v1/integrations/gmail/message/preview`
- `POST /api/v1/integrations/gmail/pubsub`
- `POST /api/v1/availability/preview`
- `GET /api/v1/trips/demo`

Valores placeholder como `value` são tratados como **não configurados**; Google/Gmail não inicializam até existirem credenciais válidas.

## Gmail Travel Intelligence

Google Sign-In e Gmail são permissões diferentes. A leitura do Gmail usa consentimento incremental e escopo somente leitura:

`https://www.googleapis.com/auth/gmail.readonly`

Arquitetura preparada:

1. descoberta inicial delimitada;
2. `lastHistoryId` persistido;
3. `users.watch` + Google Pub/Sub;
4. processamento incremental via Gmail History API;
5. classificação de mensagens candidatas;
6. anexos PDF passam pelo mesmo Universal Travel Importer;
7. deduplicação por message id, digest do anexo e fingerprint da reserva;
8. renovação do watch antes da expiração;
9. ressincronização fail-closed quando a continuidade do history for perdida.

A política é guardar preferencialmente fatos estruturados de viagem e digests, evitando retenção desnecessária de conteúdo de caixa postal. Veja `docs/GOOGLE_COMPLIANCE.md` e `docs/UNIVERSAL_IMPORTER.md`.

## TiDB

Schemas:

- `db/001_initial.sql`
- `db/002_universal_importer.sql`

A segunda migração adiciona jobs/artefatos de importação, fatos de viagem, estado do Gmail Watch, índice de mensagens e relações entre reservas.

A aplicação recebe a conexão por:

```env
DATABASE_URL=mysql://USER:PASSWORD@HOST:4000/voyage?sslaccept=strict
```

Não commitar `.env`, `voyage-api.env`, senhas ou tokens.

## Interface premium

A interface em `app/www` segue a direção visual aprovada do Voyage: navy profundo, ouro quente, cartões sofisticados, Guardian, VoyMate, jornadas, acompanhamento em tempo real e **Central de Importação**.

Há três modos de aparência:

- **Automático** — segue o sistema
- **Escuro**
- **Claro**

O modo escolhido é persistido localmente.

## Android / APK

O app usa Capacitor como casca Android. O projeto nativo é gerado no GitHub Actions para não poluir o repositório com artefatos gerados.

O workflow `.github/workflows/android-apk.yml`:

1. instala dependências Capacitor;
2. gera o projeto Android;
3. gera ícone/splash do Voyage;
4. sincroniza o web shell;
5. executa `assembleDebug`;
6. publica `voyage-debug-apk` como artifact.

A assinatura de produção será adicionada depois por GitHub Secrets; nenhum keystore real deve ser commitado.

## Render

Configuração recomendada para o serviço já criado:

```text
Name: voyage-api
Language: Node
Branch: main (após merge)
Root Directory: [vazio]
Build Command: npm ci && npm run build
Start Command: npm start
Health Check Path: /health
```

Variáveis atuais:

```env
DATABASE_URL=
NODE_ENV=production
APP_NAME=Voyage by CrewCheck
APP_URL=https://crewcheck.online/voyage
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
TOKEN_ENCRYPTION_KEY=
GOOGLE_PUBSUB_TOPIC=
GOOGLE_PUBSUB_AUDIENCE=
```

Segredos ficam apenas no provedor de execução/secret manager.

## Próximos marcos

1. Persistência real da API no TiDB usando driver/ORM versionado.
2. Google Sign-In production-ready.
3. OAuth Gmail real + History API + Pub/Sub Watch.
4. OCR para PDFs escaneados e imagens.
5. Outlook/Microsoft Graph, Booking Data Portability, CVC e Onfly como novos `TravelSource`.
6. CrewCheck Availability API para tripulantes.
7. Guardian + Mobility + Flight Intelligence.
8. VoyMiles e benefícios.
9. Release Android assinado e publicação nas lojas.

## Hotel Intelligence

Relatos de quarto não são reduzidos a notas genéricas. Ruído, por exemplo, é classificado por origem (`avenida`, `aeroporto`, `obra`, `elevador`, `corredor`, `vizinho`, `área de lazer`, `infraestrutura`, `vida noturna`, `temporário`), período, intensidade, recorrência, proveniência e validade temporal.

Um hóspede barulhento não transforma permanentemente o quarto em “barulhento”; uma avenida, elevador ou infraestrutura recorrente pode formar uma característica estrutural quando houver evidência suficiente.
