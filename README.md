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

## Fundação atual

```text
Voyage
├── src/                  # voyage-api / Render
├── db/                   # schema TiDB
├── app/
│   ├── www/              # PWA premium
│   ├── resources/        # ícone e splash
│   └── capacitor.config.json
├── docs/
│   ├── ARCHITECTURE.md
│   └── GOOGLE_COMPLIANCE.md
└── .github/workflows/
    ├── ci.yml
    └── android-apk.yml
```

### API

Zero-dependency bootstrap para reduzir risco no primeiro deploy do Render. O serviço escuta `process.env.PORT` em `0.0.0.0` e expõe:

- `GET /health`
- `GET /api/v1/config`
- `GET /api/v1/auth/google/status`
- `GET /api/v1/integrations/gmail/status`
- `POST /api/v1/availability/preview`
- `GET /api/v1/trips/demo`

Valores placeholder como `value` são tratados como **não configurados**; Google/Gmail não inicializam até existirem credenciais válidas.

### TiDB

O schema inicial está em `db/001_initial.sql` e deve ser aplicado ao database `voyage`.

A aplicação recebe a conexão exclusivamente por:

```env
DATABASE_URL=mysql://USER:PASSWORD@HOST:4000/voyage?sslaccept=strict
```

Não commitar `.env`, `voyage-api.env`, senhas ou tokens.

### Google

Autorização incremental:

1. Login: `openid email profile`
2. Gmail opcional: `gmail.readonly`

O Gmail Travel Connector deve guardar preferencialmente fatos estruturados de viagem, não cópias indefinidas da caixa postal. Veja `docs/GOOGLE_COMPLIANCE.md`.

## Interface premium

A interface em `app/www` segue a direção visual aprovada do Voyage: navy profundo, ouro quente, cartões sofisticados, Guardian, VoyMate, jornadas e acompanhamento em tempo real.

Há três modos de aparência:

- **Automático** — segue o sistema
- **Escuro**
- **Claro**

O modo escolhido é persistido localmente.

## Android / APK

O app usa Capacitor como casca Android. O projeto nativo é gerado no GitHub Actions para não poluir o repositório com artefatos gerados.

Workflow:

```text
.github/workflows/android-apk.yml
```

Ele:

1. instala dependências Capacitor;
2. gera o projeto Android;
3. gera ícone/splash do Voyage;
4. sincroniza o web shell;
5. executa `assembleDebug`;
6. publica `voyage-debug-apk` como artifact do workflow.

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
3. Gmail Travel Intelligence + Pub/Sub/history sync.
4. Universal Travel Importer para Gmail, Outlook, uploads, Booking, CVC e Onfly.
5. Trip Graph e deduplicação de reservas.
6. CrewCheck Availability API para tripulantes.
7. Guardian + Mobility + Flight Intelligence.
8. VoyMiles e benefícios.
9. Release Android assinado e publicação nas lojas.

## Hotel Intelligence

Relatos de quarto não são reduzidos a notas genéricas. Ruído, por exemplo, é classificado por origem (`avenida`, `aeroporto`, `obra`, `elevador`, `corredor`, `vizinho`, `área de lazer`, `infraestrutura`, `vida noturna`, `temporário`), período, intensidade, recorrência, proveniência e validade temporal.

Um hóspede barulhento não transforma permanentemente o quarto em “barulhento”; uma avenida, elevador ou infraestrutura recorrente pode formar uma característica estrutural quando houver evidência suficiente.
