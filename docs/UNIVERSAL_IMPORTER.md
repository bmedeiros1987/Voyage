# Universal Travel Importer

O Voyage trata a viagem como um grafo de fatos e reservas, não como uma lista rígida de fornecedores. O importador deve aceitar um documento mesmo quando o tipo ou o emissor ainda não forem conhecidos.

## Entradas

### Manual

O usuário pode importar um ou vários PDFs de forma manual, incluindo:

- passagem aérea e e-ticket;
- cartão de embarque;
- hotel, hostel, pousada, resort e aluguel por temporada;
- aluguel de carro;
- trem, ônibus, ferry/balsa e transfer;
- cruzeiro;
- show, festival e evento;
- museu, parque, atração e monumento;
- passeio/tour/excursão;
- restaurante;
- seguro viagem;
- sala VIP;
- estacionamento;
- visto, ETA/ESTA ou autorização de entrada;
- bagagem;
- qualquer outro PDF, classificado como `OTHER` quando necessário.

A regra central é **não descartar silenciosamente**. Se o PDF for criptografado, escaneado ou de baixa confiança, ele permanece importado e entra em `NEEDS_REVIEW`.

### Gmail em tempo real

Gmail é opcional e separado do Google Sign-In. O escopo planejado é somente leitura:

`https://www.googleapis.com/auth/gmail.readonly`

Fluxo:

1. consentimento incremental específico para Gmail;
2. busca inicial limitada a candidatos de viagem;
3. armazenamento de `lastHistoryId`;
4. `users.watch` + Google Pub/Sub;
5. para cada notificação, buscar o delta por Gmail History API;
6. processar apenas mensagens/attachments candidatos;
7. deduplicar por message id, hash do anexo e fingerprint da reserva;
8. renovar o watch antes da expiração;
9. se a continuidade do history for perdida, fazer ressincronização delimitada e registrar a quebra de continuidade.

## Pipeline

```text
TravelSource
  -> DocumentNormalizer
  -> DocumentClassifier
  -> TravelEntityExtractor
  -> ReservationMatcher
  -> TripGraph
  -> Guardian / Mobility / Hotel Intelligence / Wallet
```

Todos os fatos carregam proveniência, confiança e freshness. Um fato novo não deve sobrescrever silenciosamente um fato antigo sem registro de supersessão.

## PDF

O primeiro parser usa extração best-effort de content streams digitais e suporta streams Flate comuns. Ele não finge suportar todos os PDFs. PDFs com filtros/fontes incompatíveis, imagem escaneada ou criptografia entram em revisão. OCR entra como adaptador posterior, sem alterar o contrato do pipeline.

Limite inicial: 15 MB por PDF.

## Offline-first

No app, PDFs selecionados são armazenados localmente em IndexedDB e entram em fila. Se a API estiver acessível, são sincronizados automaticamente. Se não estiver, o documento continua no dispositivo e a sincronização é retomada quando houver conectividade.

## Persistência TiDB

`db/002_universal_importer.sql` acrescenta:

- `import_jobs`;
- `import_artifacts`;
- `travel_facts`;
- `gmail_message_index`;
- `gmail_watch_state`;
- `reservation_links`.

Os artefatos brutos devem seguir política de retenção explícita. O padrão preferido para integrações de e-mail é manter fatos estruturados e digests, evitando retenção desnecessária de conteúdo de caixa postal.

## Próximos adaptadores

Sem alterar a taxonomia central, o mesmo pipeline pode receber Outlook/Microsoft Graph, Booking Data Portability, CVC, Onfly, APIs de cias aéreas, rail/bus providers e uploads de imagens/Wallet. Cada integração deve apenas produzir `TravelSource` + documento/fatos normalizados.
