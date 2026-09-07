const DB_NAME = 'voyage-local';
const DB_VERSION = 1;
const STORE = 'imports';
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const SYNCED_RAW_BLOB_TTL_MS = 30 * 24 * 60 * 60 * 1000;

queueMicrotask(() => installUniversalImporterEnhancements().catch((error) => reportStorageFailure(error)));

async function installUniversalImporterEnhancements() {
  const input = document.querySelector('[data-import-files]');
  const dropzone = document.querySelector('.import-dropzone');
  const importList = document.querySelector('[data-import-list]');
  if (!input || !dropzone || !importList) return;

  injectManualEntryPanel();
  injectReviewDialog();

  input.addEventListener('change', interceptFileSelection, true);
  dropzone.addEventListener('dragenter', onDragEnter);
  dropzone.addEventListener('dragover', onDragOver);
  dropzone.addEventListener('dragleave', onDragLeave);
  dropzone.addEventListener('drop', onDrop);

  document.addEventListener('click', handleEnhancementClick);
  document.addEventListener('submit', handleEnhancementSubmit);
  document.addEventListener('voyage:imports-open', () => refreshQueueViaScreen().catch((error) => reportStorageFailure(error)));
  window.addEventListener('online', () => syncManualItems().catch((error) => reportStorageFailure(error)));

  const observer = new MutationObserver(() => decorateImportRows(importList));
  observer.observe(importList, { childList: true, subtree: true });
  decorateImportRows(importList);
  await purgeExpiredSyncedBlobs();
  await syncManualItems();
}

async function interceptFileSelection(event) {
  const files = [...(event.target.files || [])];
  if (!files.length) return;
  event.stopImmediatePropagation();
  try {
    const hint = document.querySelector('[data-import-category]')?.value || '';
    const result = await importFiles(files, hint);
    event.target.value = '';
    await refreshQueueViaScreen();
    announceImportResult(result);
  } catch (error) {
    event.target.value = '';
    reportStorageFailure(error);
  }
}

async function importFiles(files, categoryHint = '') {
  const result = { added: 0, duplicates: 0, rejected: 0 };
  for (const file of files) {
    if (!isPdf(file) || file.size > MAX_PDF_BYTES) {
      result.rejected += 1;
      continue;
    }
    const sha256 = await sha256File(file);
    if (await findBySha(sha256)) {
      result.duplicates += 1;
      continue;
    }
    const record = {
      id: makeId(),
      sha256,
      name: file.name || 'documento.pdf',
      type: 'application/pdf',
      size: file.size,
      categoryHint: categoryHint || null,
      status: 'LOCAL_QUEUED',
      createdAt: new Date().toISOString(),
      blob: file,
      sourceMode: 'MANUAL_PDF'
    };
    await putRecord(record);
    result.added += 1;
    await uploadPdf(record).catch(() => false);
  }
  return result;
}

async function onDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('import-dropzone--dragging');
  const files = [...(event.dataTransfer?.files || [])];
  if (!files.length) return;
  try {
    const hint = document.querySelector('[data-import-category]')?.value || '';
    const result = await importFiles(files, hint);
    await refreshQueueViaScreen();
    announceImportResult(result);
  } catch (error) {
    reportStorageFailure(error);
  }
}

function onDragEnter(event) {
  event.preventDefault();
  event.currentTarget.classList.add('import-dropzone--dragging');
}

function onDragOver(event) {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  event.currentTarget.classList.add('import-dropzone--dragging');
}

function onDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.classList.remove('import-dropzone--dragging');
}

function injectManualEntryPanel() {
  const stack = document.querySelector('.import-stack');
  const gmailPanel = [...stack?.querySelectorAll('.import-panel') || []].find((panel) => panel.textContent.includes('Gmail Travel Intelligence'));
  if (!stack || !gmailPanel || document.querySelector('[data-manual-panel]')) return;
  const panel = document.createElement('article');
  panel.className = 'import-panel';
  panel.dataset.manualPanel = '';
  panel.innerHTML = `
    <div class="import-panel__head"><div class="import-panel__icon">＋</div><div><h2>Adicionar sem PDF</h2><p>Inclua uma reserva ou compromisso mesmo quando você só tiver os dados. Funciona offline e sincroniza depois.</p></div></div>
    <button class="button button--outline" type="button" data-import-manual-open>Adicionar item manualmente</button>`;
  stack.insertBefore(panel, gmailPanel);
}

function injectReviewDialog() {
  if (document.querySelector('[data-import-dialog]')) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'import-dialog';
  dialog.dataset.importDialog = '';
  dialog.innerHTML = `
    <form method="dialog" class="import-dialog__card" data-import-form>
      <div class="import-dialog__head"><div><p class="mini-brand" data-dialog-kicker>ITEM DA JORNADA</p><h2 data-dialog-title>Adicionar item</h2></div><button class="icon-button" value="cancel" type="button" data-import-dialog-close aria-label="Fechar">×</button></div>
      <input type="hidden" name="recordId" />
      <section class="import-review-evidence" data-review-evidence hidden aria-live="polite">
        <div class="import-review-evidence__head"><div><strong>O que o Voyage encontrou</strong><small>Confira os fatos antes de confirmar.</small></div><span data-review-confidence></span></div>
        <div class="import-review-reasons" data-review-reasons hidden></div>
        <dl class="import-review-facts" data-review-facts></dl>
        <details class="import-review-preview" data-review-preview-wrap hidden><summary>Ver trecho extraído do documento</summary><p data-review-text></p></details>
      </section>
      <label class="import-field"><span>Tipo</span><select name="category" required>${categoryOptions()}</select></label>
      <label class="import-field"><span>Título</span><input name="title" maxlength="220" placeholder="Ex.: Museu do Louvre, Hotel Roma, Trem para Florença" required /></label>
      <div class="import-field-grid">
        <label class="import-field"><span>Início</span><input name="startsAt" type="datetime-local" /></label>
        <label class="import-field"><span>Fim</span><input name="endsAt" type="datetime-local" /></label>
      </div>
      <label class="import-field"><span>Local</span><input name="location" maxlength="300" placeholder="Cidade, aeroporto, hotel, endereço…" /></label>
      <div class="import-field-grid">
        <label class="import-field"><span>Fornecedor</span><input name="provider" maxlength="160" placeholder="Companhia, hotel, operadora…" /></label>
        <label class="import-field"><span>Localizador / código</span><input name="confirmationCode" maxlength="120" autocomplete="off" /></label>
      </div>
      <label class="import-field"><span>Observações</span><textarea name="notes" maxlength="2000" rows="4" placeholder="Qualquer informação útil para a jornada"></textarea></label>
      <p class="import-confirmation-note" data-confirmation-note hidden>Nada será associado à sua jornada até você confirmar estes dados.</p>
      <div class="import-dialog__actions"><button class="button button--ghost" type="button" data-import-dialog-close>Cancelar</button><button class="button button--gold" type="submit" data-import-submit>Adicionar à jornada</button></div>
    </form>`;
  document.body.appendChild(dialog);
}

async function handleEnhancementClick(event) {
  const openManual = event.target.closest('[data-import-manual-open]');
  if (openManual) {
    openEditor(null);
    return;
  }

  const close = event.target.closest('[data-import-dialog-close]');
  if (close) {
    document.querySelector('[data-import-dialog]')?.close();
    return;
  }

  const review = event.target.closest('[data-review-import]');
  if (review) {
    try {
      const record = await getRecord(review.dataset.reviewImport);
      if (record) openEditor(record);
    } catch (error) {
      reportStorageFailure(error);
    }
    return;
  }

  const remove = event.target.closest('[data-delete-import]');
  if (remove) {
    try {
      await deleteRecord(remove.dataset.deleteImport);
      await refreshQueueViaScreen();
      toast('Documento removido deste dispositivo.');
    } catch (error) {
      reportStorageFailure(error);
    }
  }
}

async function handleEnhancementSubmit(event) {
  const form = event.target.closest('[data-import-form]');
  if (!form) return;
  event.preventDefault();

  try {
    const data = new FormData(form);
    const existingId = String(data.get('recordId') || '');
    const existing = existingId ? await getRecord(existingId) : null;
    const manualPayload = {
      category: String(data.get('category') || 'OTHER'),
      title: String(data.get('title') || '').trim(),
      startsAt: normalizeLocalDateTime(data.get('startsAt')),
      endsAt: normalizeLocalDateTime(data.get('endsAt')),
      location: nullable(data.get('location')),
      provider: nullable(data.get('provider')),
      confirmationCode: nullable(data.get('confirmationCode')),
      notes: nullable(data.get('notes')),
      confirmedByUser: true
    };
    if (!manualPayload.title) return;

    const now = new Date().toISOString();
    const record = existing ? {
      ...existing,
      category: manualPayload.category,
      categoryHint: manualPayload.category,
      manualPayload: { ...(existing.manualPayload || {}), ...manualPayload },
      status: existing.blob ? 'PARSED' : 'LOCAL_MANUAL_QUEUED',
      reviewReasons: [],
      reviewedAt: now,
      userConfirmed: true
    } : {
      id: makeId(),
      sha256: null,
      name: manualPayload.title,
      type: 'application/vnd.voyage.manual+json',
      size: 0,
      category: manualPayload.category,
      categoryHint: manualPayload.category,
      status: 'LOCAL_MANUAL_QUEUED',
      createdAt: now,
      sourceMode: 'MANUAL_ENTRY',
      manualPayload,
      userConfirmed: true
    };

    await putRecord(record);
    if (!record.blob) await uploadManual(record).catch(() => false);
    document.querySelector('[data-import-dialog]')?.close();
    await refreshQueueViaScreen();
    toast(existing ? 'Dados confirmados pelo usuário.' : 'Item adicionado à jornada.');
  } catch (error) {
    reportStorageFailure(error);
  }
}

function openEditor(record) {
  const dialog = document.querySelector('[data-import-dialog]');
  const form = dialog?.querySelector('[data-import-form]');
  if (!dialog || !form) return;
  form.reset();
  form.elements.recordId.value = record?.id || '';
  const payload = record?.manualPayload || {};
  const facts = record?.extractedFacts || {};
  form.elements.category.value = record?.category || record?.categoryHint || payload.category || 'OTHER';
  form.elements.title.value = payload.title || (record?.name && record.type !== 'application/pdf' ? record.name : stripPdfExtension(record?.name || ''));
  form.elements.startsAt.value = toDateTimeLocal(payload.startsAt);
  form.elements.endsAt.value = toDateTimeLocal(payload.endsAt);
  form.elements.location.value = payload.location || routeLabel(facts.route) || '';
  form.elements.provider.value = payload.provider || facts.provider || facts.marketingCarrier || '';
  form.elements.confirmationCode.value = payload.confirmationCode || facts.confirmationCode || '';
  form.elements.notes.value = payload.notes || '';

  const isReview = Boolean(record?.type === 'application/pdf');
  dialog.querySelector('[data-dialog-kicker]').textContent = isReview ? 'REVISÃO DO IMPORTADOR' : 'ITEM DA JORNADA';
  dialog.querySelector('[data-dialog-title]').textContent = isReview ? 'Confirmar dados extraídos' : (record ? 'Editar item' : 'Adicionar item');
  dialog.querySelector('[data-import-submit]').textContent = isReview ? 'Confirmar e adicionar' : 'Adicionar à jornada';
  dialog.querySelector('[data-confirmation-note]').hidden = !isReview;
  renderReviewEvidence(record);

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function renderReviewEvidence(record) {
  const section = document.querySelector('[data-review-evidence]');
  const factsList = document.querySelector('[data-review-facts]');
  const reasons = document.querySelector('[data-review-reasons]');
  const confidence = document.querySelector('[data-review-confidence]');
  const previewWrap = document.querySelector('[data-review-preview-wrap]');
  const preview = document.querySelector('[data-review-text]');
  if (!section || !factsList || !reasons || !confidence || !previewWrap || !preview) return;

  const isPdf = Boolean(record?.type === 'application/pdf');
  section.hidden = !isPdf;
  if (!isPdf) return;

  const facts = record.extractedFacts && typeof record.extractedFacts === 'object' ? record.extractedFacts : {};
  const factConfidence = record.factConfidence && typeof record.factConfidence === 'object' ? record.factConfidence : {};
  const rows = factRows(facts, factConfidence);
  factsList.innerHTML = rows.length
    ? rows.map(({ label, value, confidence: score }) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}${Number.isFinite(score) ? `<span>${Math.round(score * 100)}%</span>` : ''}</dd></div>`).join('')
    : '<div><dt>Fatos estruturados</dt><dd>Nenhum fato confiável foi confirmado automaticamente.</dd></div>';

  const scores = Object.values(factConfidence).filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  const minScore = scores.length ? Math.min(...scores) : null;
  confidence.textContent = minScore == null ? 'Revisão necessária' : `mín. ${Math.round(minScore * 100)}%`;

  const reviewReasons = Array.isArray(record.reviewReasons) ? record.reviewReasons : [];
  reasons.hidden = reviewReasons.length === 0;
  reasons.innerHTML = reviewReasons.map((reason) => `<span>${escapeHtml(reviewReasonLabel(reason))}</span>`).join('');

  const text = String(record.textPreview || '').trim();
  previewWrap.hidden = !text;
  preview.textContent = text;
}

function factRows(facts, confidence = {}) {
  const rows = [];
  const push = (key, label, value) => {
    if (value == null || value === '') return;
    rows.push({ key, label, value: String(value), confidence: Number(confidence[key]) });
  };
  push('flightNumber', 'Voo', facts.marketingCarrier && facts.flightNumber ? `${facts.marketingCarrier} ${facts.flightNumber}` : facts.flightNumber);
  push('route', 'Rota', routeLabel(facts.route));
  push('confirmationCode', 'Localizador', facts.confirmationCode);
  push('seat', 'Assento', facts.seat);
  push('gate', 'Portão', facts.gate);
  push('terminal', 'Terminal', facts.terminal);
  push('providerStatus', 'Status', facts.providerStatus);
  push('priceText', 'Valor', facts.priceText);
  push('dateMentions', 'Datas detectadas', Array.isArray(facts.dateMentions) ? facts.dateMentions.join(' · ') : facts.dateMentions);
  push('timeMentions', 'Horários detectados', Array.isArray(facts.timeMentions) ? facts.timeMentions.join(' · ') : facts.timeMentions);
  return rows;
}

function reviewReasonLabel(reason) {
  const labels = {
    PDF_ENCRYPTED: 'PDF protegido por senha',
    TEXT_EXTRACTION_INSUFFICIENT: 'Texto insuficiente para confirmar automaticamente',
    CLASSIFICATION_LOW_CONFIDENCE: 'Tipo do documento com baixa confiança',
    HINT_CONTRADICTS_CONTENT: 'O tipo escolhido contradiz o conteúdo',
    PDF_SCAN_TRUNCATED_FOR_SAFETY: 'Leitura parcial por limite de segurança'
  };
  return labels[reason] || String(reason || '').replace(/^LOW_CONFIDENCE_FACT_/, 'Baixa confiança: ').replaceAll('_', ' ').toLowerCase();
}

function decorateImportRows(list) {
  for (const row of list.querySelectorAll('.import-item')) {
    const remove = row.querySelector('[data-delete-import]');
    if (!remove || row.querySelector('[data-review-import]')) continue;
    const status = row.querySelector('.import-status');
    const recordId = remove.dataset.deleteImport;
    const reviewButton = document.createElement('button');
    reviewButton.className = 'text-button';
    reviewButton.type = 'button';
    reviewButton.dataset.reviewImport = recordId;
    reviewButton.textContent = status?.textContent === 'Revisar' ? 'Revisar agora' : 'Editar';
    remove.parentElement?.insertBefore(reviewButton, remove);
  }
  enhanceManualStatusLabels(list);
}

async function enhanceManualStatusLabels(list) {
  const records = await listRecords().catch(() => []);
  const byId = new Map(records.map((record) => [record.id, record]));
  for (const row of list.querySelectorAll('.import-item')) {
    const id = row.querySelector('[data-delete-import]')?.dataset.deleteImport;
    const record = byId.get(id);
    if (!record) continue;
    if (record.type === 'application/vnd.voyage.manual+json') {
      const icon = row.querySelector('.import-item__icon');
      if (icon) icon.textContent = '＋';
      const status = row.querySelector('.import-status');
      if (status && record.status === 'PARSED') {
        status.textContent = 'Importado';
        status.classList.add('import-status--ok');
      } else if (status) {
        status.textContent = 'Na fila';
      }
    }
  }
}

async function syncManualItems() {
  if (!navigator.onLine) {
    await refreshQueueViaScreen();
    return;
  }
  const records = await listRecords();
  for (const record of records.filter((item) => item.status === 'LOCAL_MANUAL_QUEUED')) {
    await uploadManual(record).catch(() => false);
  }
  for (const record of records.filter((item) => item.status === 'LOCAL_QUEUED' && item.blob)) {
    await uploadPdf(record).catch(() => false);
  }
  await refreshQueueViaScreen();
}

async function uploadManual(record) {
  if (!navigator.onLine || !record.manualPayload) return false;
  const response = await fetchApi('/api/v1/imports/manual/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record.manualPayload)
  });
  if (!response.ok) throw new Error(`manual_upload_${response.status}`);
  const parsed = await response.json();
  record.status = record.userConfirmed ? 'PARSED' : (parsed.status || 'NEEDS_REVIEW');
  record.backendImportId = parsed.importId || null;
  record.syncedAt = new Date().toISOString();
  await putRecord(record);
  return true;
}

async function uploadPdf(record) {
  if (!navigator.onLine || !record.blob) return false;
  const headers = { 'Content-Type': 'application/pdf', 'X-Voyage-Filename': record.name };
  if (record.categoryHint) headers['X-Voyage-Category'] = record.categoryHint;
  const response = await fetchApi('/api/v1/imports/pdf', { method: 'POST', headers, body: record.blob });
  if (!response.ok) throw new Error(`upload_${response.status}`);
  const parsed = await response.json();
  record.status = parsed.status || 'PARSED';
  record.category = parsed.document?.category || record.categoryHint || 'OTHER';
  record.backendImportId = parsed.importId || null;
  record.reviewReasons = parsed.review?.reasons || [];
  record.extractedFacts = parsed.facts || null;
  record.factConfidence = parsed.factConfidence || null;
  record.textPreview = parsed.textPreview || '';
  record.syncedAt = new Date().toISOString();
  await putRecord(record);
  return true;
}

async function refreshQueueViaScreen() {
  const list = document.querySelector('[data-import-list]');
  if (!list) return;
  try {
    const records = (await listRecords()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    list.innerHTML = records.length ? records.slice(0, 80).map(renderRecord).join('') : '<div class="import-empty">Nenhum documento importado neste dispositivo.</div>';
    decorateImportRows(list);
  } catch (error) {
    list.innerHTML = '<div class="import-empty import-empty--error">Não foi possível acessar o armazenamento local. Seus arquivos não foram marcados como salvos.</div>';
    throw error;
  }
}

function renderRecord(record) {
  const isManual = record.type === 'application/vnd.voyage.manual+json';
  const statusClass = record.status === 'PARSED' ? 'import-status--ok' : record.status === 'NEEDS_REVIEW' ? 'import-status--review' : '';
  const statusLabel = record.status === 'PARSED' ? 'Importado' : record.status === 'NEEDS_REVIEW' ? 'Revisar' : 'Na fila';
  const category = categoryLabel(record.category || record.categoryHint || 'OTHER');
  const retention = record.retentionState === 'BLOB_PURGED' ? ' · PDF original removido após retenção' : '';
  const subtitle = isManual ? `${category} · item manual · ${formatDate(record.createdAt)}` : `${category} · ${formatBytes(record.size)} · ${formatDate(record.createdAt)}${retention}`;
  return `<div class="import-item"><div class="import-item__icon">${isManual ? '＋' : 'PDF'}</div><div><strong>${escapeHtml(record.name)}</strong><small>${escapeHtml(subtitle)}</small></div><div class="import-item__actions"><span class="import-status ${statusClass}">${statusLabel}</span><button class="text-button" type="button" data-review-import="${record.id}">${record.status === 'NEEDS_REVIEW' ? 'Revisar agora' : 'Editar'}</button><button class="text-button" type="button" data-delete-import="${record.id}">Remover</button></div></div>`;
}

async function findBySha(sha256) {
  if (!sha256) return null;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const index = tx.objectStore(STORE).index('sha256');
    return await requestResult(index.get(sha256));
  } finally { db.close(); }
}

async function getRecord(id) {
  const db = await openDb();
  try { return await requestResult(db.transaction(STORE, 'readonly').objectStore(STORE).get(id)); }
  finally { db.close(); }
}

async function putRecord(record) {
  const db = await openDb();
  try {
    await transactionDone(db.transaction(STORE, 'readwrite'), (store) => store.put(record));
  } finally { db.close(); }
}

async function deleteRecord(id) {
  const db = await openDb();
  try {
    await transactionDone(db.transaction(STORE, 'readwrite'), (store) => store.delete(id));
  } finally { db.close(); }
}

async function listRecords() {
  const db = await openDb();
  try { return await requestResult(db.transaction(STORE, 'readonly').objectStore(STORE).getAll()) || []; }
  finally { db.close(); }
}

async function purgeExpiredSyncedBlobs() {
  const records = await listRecords().catch(() => []);
  const now = Date.now();
  for (const record of records) {
    if (!record?.blob || !record.syncedAt || record.status === 'LOCAL_QUEUED') continue;
    const reference = Date.parse(record.syncedAt || record.createdAt || '');
    if (!Number.isFinite(reference) || now - reference <= SYNCED_RAW_BLOB_TTL_MS) continue;
    const updated = { ...record, blob: null, retentionState: 'BLOB_PURGED', rawBlobPurgedAt: new Date().toISOString() };
    await putRecord(updated);
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('indexeddb_unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('sha256', 'sha256', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexeddb_open_failed'));
    request.onblocked = () => reject(new Error('indexeddb_open_blocked'));
  });
}

function transactionDone(tx, operation) {
  return new Promise((resolve, reject) => {
    try { operation(tx.objectStore(STORE)); }
    catch (error) { reject(error); return; }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('indexeddb_transaction_failed'));
    tx.onabort = () => reject(tx.error || new Error('indexeddb_transaction_aborted'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexeddb_request_failed'));
  });
}

function fetchApi(path, options = {}) {
  const base = (localStorage.getItem('voyage-api-base') || '').replace(/\/$/, '');
  return fetch(`${base}${path}`, options);
}

async function sha256File(file) {
  if (!crypto?.subtle) throw new Error('webcrypto_unavailable');
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function announceImportResult(result) {
  const parts = [];
  if (result.added) parts.push(`${result.added} novo${result.added > 1 ? 's' : ''}`);
  if (result.duplicates) parts.push(`${result.duplicates} duplicado${result.duplicates > 1 ? 's' : ''} ignorado${result.duplicates > 1 ? 's' : ''}`);
  if (result.rejected) parts.push(`${result.rejected} rejeitado${result.rejected > 1 ? 's' : ''}`);
  toast(parts.length ? parts.join(' · ') : 'Nenhum novo documento para importar.');
}

function reportStorageFailure(error) {
  const code = String(error?.name || error?.message || 'storage_error');
  const message = /quota/i.test(code)
    ? 'O armazenamento local está cheio. Nenhum arquivo foi marcado como salvo. Libere espaço e tente novamente.'
    : /indexeddb|database|transaction|abort|blocked/i.test(code)
      ? 'O armazenamento local não está disponível. Nenhum arquivo foi marcado como salvo.'
      : /webcrypto/i.test(code)
        ? 'Este dispositivo não oferece a verificação segura necessária para importar o PDF.'
        : 'Não foi possível concluir a importação. Nenhum arquivo foi marcado como salvo.';
  toast(message);
}

function toast(message) {
  const el = document.querySelector('[data-import-toast]') || ensureGlobalToast();
  if (!el) return;
  el.textContent = message;
  el.classList.add('import-toast--show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('import-toast--show'), 4200);
}

function ensureGlobalToast() {
  let el = document.querySelector('[data-import-fallback-toast]');
  if (el) return el;
  el = document.createElement('div');
  el.className = 'import-toast';
  el.dataset.importFallbackToast = '';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  document.body.appendChild(el);
  return el;
}

function categoryOptions() {
  const categories = [
    ['BOARDING_PASS','Cartão de embarque'], ['AIR_TRAVEL','Passagem aérea / voo'], ['LODGING','Hotel / hospedagem'], ['CAR_RENTAL','Carro alugado'],
    ['RAIL','Trem'], ['BUS','Ônibus'], ['FERRY','Ferry / balsa'], ['TRANSFER','Transfer / traslado'], ['CRUISE','Cruzeiro'], ['EVENT_TICKET','Show / evento'],
    ['ATTRACTION_TICKET','Museu / atração'], ['TOUR','Passeio / tour'], ['RESTAURANT','Restaurante'], ['TRAVEL_INSURANCE','Seguro viagem'],
    ['LOUNGE','Sala VIP'], ['PARKING','Estacionamento'], ['VISA_OR_ENTRY','Visto / autorização'], ['BAGGAGE','Bagagem'], ['OTHER','Outro']
  ];
  return categories.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
}

function categoryLabel(value) {
  const labels = { BOARDING_PASS:'Cartão de embarque', AIR_TRAVEL:'Passagem aérea', LODGING:'Hospedagem', CAR_RENTAL:'Carro alugado', RAIL:'Trem', BUS:'Ônibus', FERRY:'Ferry', TRANSFER:'Transfer', EVENT_TICKET:'Show / evento', ATTRACTION_TICKET:'Museu / atração', TOUR:'Passeio / tour', RESTAURANT:'Restaurante', TRAVEL_INSURANCE:'Seguro viagem', LOUNGE:'Sala VIP', PARKING:'Estacionamento', VISA_OR_ENTRY:'Visto / autorização', CRUISE:'Cruzeiro', BAGGAGE:'Bagagem', OTHER:'Outro' };
  return labels[value] || 'Outro';
}

function routeLabel(route) {
  if (!route || typeof route !== 'object') return '';
  const origin = String(route.origin || '').trim();
  const destination = String(route.destination || '').trim();
  return origin && destination ? `${origin} → ${destination}` : '';
}

function isPdf(file) {
  return file && (file.type === 'application/pdf' || String(file.name || '').toLowerCase().endsWith('.pdf'));
}
function makeId() { return crypto.randomUUID ? crypto.randomUUID() : `import-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function nullable(value) { const result = String(value || '').trim(); return result || null; }
function normalizeLocalDateTime(value) { return value ? new Date(String(value)).toISOString() : null; }
function toDateTimeLocal(value) { if (!value) return ''; const date = new Date(value); if (Number.isNaN(date.getTime())) return ''; const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return local.toISOString().slice(0,16); }
function stripPdfExtension(value) { return String(value || '').replace(/\.pdf$/i, ''); }
function formatBytes(value) { const bytes = Number(value) || 0; if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
function formatDate(value) { try { return new Date(value).toLocaleDateString('pt-BR'); } catch { return ''; } }
function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char])); }
