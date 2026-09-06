const themeOverrides = document.createElement('link');
themeOverrides.rel = 'stylesheet';
themeOverrides.href = './themes.css';
document.head.appendChild(themeOverrides);

const importStyles = document.createElement('link');
importStyles.rel = 'stylesheet';
importStyles.href = './imports.css';
document.head.appendChild(importStyles);

injectImportCenter();

const THEME_ORDER = ['auto', 'dark', 'light'];
const THEME_LABELS = { auto: 'Automático', dark: 'Escuro', light: 'Claro' };
const nav = document.querySelector('[data-bottom-nav]');
const screens = [...document.querySelectorAll('[data-screen]')];
const themeLabels = [...document.querySelectorAll('[data-theme-label]')];
const importFileInput = document.querySelector('[data-import-files]');
const importCategory = document.querySelector('[data-import-category]');
const importList = document.querySelector('[data-import-list]');

let currentScreen = 'welcome';
let previousScreen = 'journeys';

function getStoredTheme() {
  const stored = localStorage.getItem('voyage-theme');
  return THEME_ORDER.includes(stored) ? stored : 'auto';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('voyage-theme', theme);
  themeLabels.forEach((label) => { label.textContent = THEME_LABELS[theme]; });
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f0e8' : '#08131f');
}

function cycleTheme() {
  const current = document.documentElement.dataset.theme || 'auto';
  const next = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
  applyTheme(next);
}

function showScreen(name, remember = true) {
  if (!screens.some((screen) => screen.dataset.screen === name)) return;
  if (remember && currentScreen !== 'welcome') previousScreen = currentScreen;
  currentScreen = name;

  screens.forEach((screen) => screen.classList.toggle('screen--active', screen.dataset.screen === name));
  const showNav = name !== 'welcome' && name !== 'availability' && name !== 'imports';
  nav.hidden = !showNav;

  document.querySelectorAll('[data-nav]').forEach((item) => {
    item.classList.toggle('nav-item--active', item.dataset.nav === name || (name === 'journeys' && item.dataset.nav === 'journeys'));
  });

  if (name === 'imports') {
    renderImportQueue();
    refreshGmailStatus();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.addEventListener('click', (event) => {
  const deleteEl = event.target.closest('[data-delete-import]');
  if (deleteEl) {
    removeLocalImport(deleteEl.dataset.deleteImport).then(renderImportQueue);
    return;
  }

  const actionEl = event.target.closest('[data-action]');
  const navEl = event.target.closest('[data-nav]');

  if (navEl) {
    showScreen(navEl.dataset.nav);
    return;
  }

  if (!actionEl) {
    const dayButton = event.target.closest('[data-day-picker] button');
    if (dayButton) {
      dayButton.parentElement.querySelectorAll('button').forEach((button) => button.classList.remove('selected'));
      dayButton.classList.add('selected');
    }
    const preference = event.target.closest('.preference');
    if (preference) {
      preference.parentElement.querySelectorAll('.preference').forEach((button) => button.classList.remove('preference--active'));
      preference.classList.add('preference--active');
    }
    return;
  }

  switch (actionEl.dataset.action) {
    case 'enter':
    case 'google-login':
    case 'create-account':
      showScreen('journeys');
      break;
    case 'cycle-theme':
      cycleTheme();
      break;
    case 'open-trip':
      showScreen('trip');
      break;
    case 'availability':
      showScreen('availability');
      break;
    case 'imports':
      showScreen('imports');
      break;
    case 'gmail-connect':
      showImportToast('A conexão Gmail será habilitada automaticamente quando o OAuth estiver configurado no servidor.');
      refreshGmailStatus();
      break;
    case 'back':
      showScreen(previousScreen || 'journeys', false);
      break;
  }
});

importFileInput?.addEventListener('change', async () => {
  const files = [...(importFileInput.files || [])];
  if (!files.length) return;
  const hint = importCategory?.value || '';
  for (const file of files) await queuePdfImport(file, hint);
  importFileInput.value = '';
  await renderImportQueue();
  showImportToast(`${files.length} arquivo${files.length > 1 ? 's' : ''} adicionado${files.length > 1 ? 's' : ''} ao Voyage.`);
});

window.addEventListener('online', () => syncQueuedImports().then(renderImportQueue).catch(() => {}));

applyTheme(getStoredTheme());
showScreen('welcome', false);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
}

function injectImportCenter() {
  const journeysActions = document.querySelector('[data-screen="journeys"] .topbar-actions');
  if (journeysActions && !journeysActions.querySelector('[data-action="imports"]')) {
    const button = document.createElement('button');
    button.className = 'icon-button';
    button.dataset.action = 'imports';
    button.setAttribute('aria-label', 'Importar reservas e documentos');
    button.textContent = '⇧';
    journeysActions.prepend(button);
  }

  const screen = document.createElement('section');
  screen.className = 'screen import-screen';
  screen.dataset.screen = 'imports';
  screen.innerHTML = `
    <header class="topbar">
      <button class="icon-button" data-action="back" aria-label="Voltar">←</button>
      <div><p class="mini-brand">UNIVERSAL TRAVEL IMPORTER</p><h1>Traga tudo para a sua jornada</h1><p class="topbar-subtitle">PDF manual ou Gmail em tempo real.</p></div>
    </header>
    <div class="import-stack">
      <article class="import-panel">
        <div class="import-panel__head"><div class="import-panel__icon">⇧</div><div><h2>Importar PDFs</h2><p>Passagens, cartões de embarque, hotéis, aluguel de carro, trem, ônibus, ferry, transfer, shows, museus, passeios, seguro e qualquer outro documento da viagem.</p></div></div>
        <label class="import-dropzone">
          <strong>Selecionar um ou vários PDFs</strong>
          <small>O Voyage aceita também documentos desconhecidos: eles entram como “Outro” para você não perder nada.</small>
          <span class="button button--gold" style="display:grid;place-items:center;min-height:44px;max-width:260px">Escolher arquivos</span>
          <input type="file" accept="application/pdf,.pdf" multiple data-import-files />
        </label>
        <select class="import-category" data-import-category aria-label="Tipo do documento">
          <option value="">Detectar automaticamente</option>
          <option value="BOARDING_PASS">Cartão de embarque</option><option value="AIR_TRAVEL">Passagem aérea / voo</option><option value="LODGING">Hotel / hospedagem</option>
          <option value="CAR_RENTAL">Carro alugado</option><option value="RAIL">Trem</option><option value="BUS">Ônibus</option><option value="FERRY">Ferry / balsa</option>
          <option value="TRANSFER">Transfer / traslado</option><option value="EVENT_TICKET">Show / evento</option><option value="ATTRACTION_TICKET">Museu / atração</option>
          <option value="TOUR">Passeio / tour</option><option value="RESTAURANT">Restaurante</option><option value="TRAVEL_INSURANCE">Seguro viagem</option>
          <option value="LOUNGE">Sala VIP</option><option value="PARKING">Estacionamento</option><option value="VISA_OR_ENTRY">Visto / autorização</option>
          <option value="CRUISE">Cruzeiro</option><option value="BAGGAGE">Bagagem</option><option value="OTHER">Outro</option>
        </select>
        <div class="import-chips"><span class="import-chip">✈ Voos</span><span class="import-chip">▣ Hotéis</span><span class="import-chip">↝ Transportes</span><span class="import-chip">◇ Ingressos</span><span class="import-chip">⌑ Passeios</span><span class="import-chip">＋ Qualquer PDF</span></div>
        <p class="import-fineprint">Os arquivos ficam disponíveis localmente para não depender de conexão. Quando a API estiver acessível, a fila sincroniza automaticamente.</p>
      </article>
      <article class="import-panel">
        <div class="import-panel__head"><div class="import-panel__icon">G</div><div><h2>Gmail Travel Intelligence</h2><p>Com autorização opcional de leitura, o Voyage acompanha confirmações e alterações de viagem sem misturar essa permissão com o login Google.</p></div></div>
        <div class="gmail-connect">
          <div class="gmail-connect__state"><span class="gmail-dot" data-gmail-dot></span><div><strong data-gmail-title>Verificando integração…</strong><small data-gmail-detail>Gmail somente leitura · dados de viagem</small></div></div>
          <button class="text-button" data-action="gmail-connect">Conectar</button>
        </div>
      </article>
      <article class="import-panel">
        <div class="import-panel__head"><div class="import-panel__icon">▤</div><div><h2>Fila de importação</h2><p>Se um PDF não puder ser lido automaticamente, ele continua salvo e é marcado para revisão — nunca descartado em silêncio.</p></div></div>
        <div class="import-list" data-import-list><div class="import-empty">Nenhum documento importado neste dispositivo.</div></div>
      </article>
    </div>
    <div class="import-toast" data-import-toast></div>`;
  document.querySelector('.app-shell')?.insertBefore(screen, document.querySelector('[data-bottom-nav]'));
}

async function queuePdfImport(file, categoryHint) {
  if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    showImportToast(`${file.name}: formato ainda não suportado.`);
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    showImportToast(`${file.name}: PDF maior que 15 MB.`);
    return;
  }
  const sha256 = await sha256File(file);
  const record = {
    id: crypto.randomUUID ? crypto.randomUUID() : `import-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sha256,
    name: file.name,
    type: 'application/pdf',
    size: file.size,
    categoryHint: categoryHint || null,
    status: 'LOCAL_QUEUED',
    createdAt: new Date().toISOString(),
    blob: file
  };
  await putImport(record);
  await tryBackendUpload(record).catch(() => {});
}

async function tryBackendUpload(record) {
  if (!navigator.onLine || !record?.blob) return false;
  const headers = { 'Content-Type': 'application/pdf', 'X-Voyage-Filename': record.name };
  if (record.categoryHint) headers['X-Voyage-Category'] = record.categoryHint;
  const response = await fetchApi('/api/v1/imports/pdf', { method: 'POST', headers, body: record.blob });
  if (!response.ok) throw new Error(`upload_${response.status}`);
  const parsed = await response.json();
  record.status = parsed.status || 'PARSED';
  record.category = parsed.document?.category || record.categoryHint || 'OTHER';
  record.backendImportId = parsed.importId || null;
  record.reviewReasons = parsed.review?.reasons || [];
  record.syncedAt = new Date().toISOString();
  await putImport(record);
  return true;
}

async function syncQueuedImports() {
  const records = await listImports();
  for (const record of records.filter((item) => item.status === 'LOCAL_QUEUED')) {
    await tryBackendUpload(record).catch(() => {});
  }
}

async function renderImportQueue() {
  if (!importList) return;
  const records = (await listImports()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (!records.length) {
    importList.innerHTML = '<div class="import-empty">Nenhum documento importado neste dispositivo.</div>';
    return;
  }
  importList.innerHTML = records.slice(0, 40).map((record) => {
    const statusClass = record.status === 'PARSED' ? 'import-status--ok' : record.status === 'NEEDS_REVIEW' ? 'import-status--review' : '';
    const statusLabel = record.status === 'PARSED' ? 'Importado' : record.status === 'NEEDS_REVIEW' ? 'Revisar' : 'Na fila';
    const category = categoryLabel(record.category || record.categoryHint || 'OTHER');
    return `<div class="import-item"><div class="import-item__icon">PDF</div><div><strong>${escapeHtml(record.name)}</strong><small>${category} · ${formatBytes(record.size)} · ${new Date(record.createdAt).toLocaleDateString('pt-BR')}</small></div><div style="display:grid;gap:6px;justify-items:end"><span class="import-status ${statusClass}">${statusLabel}</span><button class="text-button" data-delete-import="${record.id}" aria-label="Remover ${escapeHtml(record.name)}">Remover</button></div></div>`;
  }).join('');
}

async function refreshGmailStatus() {
  const title = document.querySelector('[data-gmail-title]');
  const detail = document.querySelector('[data-gmail-detail]');
  const dot = document.querySelector('[data-gmail-dot]');
  try {
    const response = await fetchApi('/api/v1/integrations/gmail/status', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('gmail_status_unavailable');
    const status = await response.json();
    if (status.enabled) {
      title.textContent = status.pushSyncEnabled ? 'Gmail pronto para tempo real' : 'Gmail autorizado';
      detail.textContent = status.pushSyncEnabled ? 'Watch + Pub/Sub disponíveis' : 'Aguardando canal Pub/Sub';
      dot.classList.add('gmail-dot--ready');
    } else {
      title.textContent = 'Gmail ainda não conectado';
      detail.textContent = 'A importação manual continua funcionando normalmente';
      dot.classList.remove('gmail-dot--ready');
    }
  } catch {
    title.textContent = 'Importação manual disponível';
    detail.textContent = 'O Gmail será sincronizado quando a API estiver acessível';
    dot.classList.remove('gmail-dot--ready');
  }
}

function fetchApi(path, options = {}) {
  const base = (localStorage.getItem('voyage-api-base') || '').replace(/\/$/, '');
  return fetch(`${base}${path}`, options);
}

function sha256File(file) {
  return file.arrayBuffer().then((buffer) => crypto.subtle.digest('SHA-256', buffer)).then((digest) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
}

function openImportDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('voyage-local', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('imports')) db.createObjectStore('imports', { keyPath: 'id' }).createIndex('sha256', 'sha256', { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putImport(record) {
  const db = await openImportDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('imports', 'readwrite');
    tx.objectStore('imports').put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function listImports() {
  const db = await openImportDb();
  const records = await new Promise((resolve, reject) => {
    const request = db.transaction('imports', 'readonly').objectStore('imports').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return records;
}

async function removeLocalImport(id) {
  const db = await openImportDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('imports', 'readwrite');
    tx.objectStore('imports').delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function categoryLabel(value) {
  const labels = { BOARDING_PASS:'Cartão de embarque', AIR_TRAVEL:'Passagem aérea', LODGING:'Hospedagem', CAR_RENTAL:'Carro alugado', RAIL:'Trem', BUS:'Ônibus', FERRY:'Ferry', TRANSFER:'Transfer', EVENT_TICKET:'Show / evento', ATTRACTION_TICKET:'Museu / atração', TOUR:'Passeio / tour', RESTAURANT:'Restaurante', TRAVEL_INSURANCE:'Seguro viagem', LOUNGE:'Sala VIP', PARKING:'Estacionamento', VISA_OR_ENTRY:'Visto / autorização', CRUISE:'Cruzeiro', BAGGAGE:'Bagagem', OTHER:'Outro' };
  return labels[value] || 'Outro';
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
}

function showImportToast(message) {
  const toast = document.querySelector('[data-import-toast]');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('import-toast--show');
  clearTimeout(showImportToast.timer);
  showImportToast.timer = setTimeout(() => toast.classList.remove('import-toast--show'), 3200);
}
