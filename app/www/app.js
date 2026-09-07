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
    document.dispatchEvent(new CustomEvent('voyage:imports-open'));
    refreshGmailStatus();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.addEventListener('click', (event) => {
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
      return;
    }

    const preference = event.target.closest('.preference');
    if (preference) {
      preference.parentElement.querySelectorAll('.preference').forEach((button) => button.classList.remove('preference--active'));
      preference.classList.add('preference--active');
      return;
    }

    const segment = event.target.closest('.segment');
    if (segment) {
      segment.parentElement?.querySelectorAll('.segment').forEach((button) => button.classList.toggle('segment--active', button === segment));
      return;
    }

    const tab = event.target.closest('.tab');
    if (tab) {
      tab.parentElement?.querySelectorAll('.tab').forEach((button) => button.classList.toggle('tab--active', button === tab));
      return;
    }

    const passiveButton = event.target.closest('button');
    if (passiveButton && !passiveButton.disabled) {
      const safety = passiveButton.matches('.sos-button');
      showShellNotice(safety
        ? 'Assistência ainda não está configurada neste ambiente. O Voyage não simula uma chamada de emergência.'
        : 'Este recurso ainda está sendo conectado à experiência Voyage.');
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
      showShellNotice('A conexão Gmail será habilitada quando o OAuth estiver configurado no servidor.');
      refreshGmailStatus();
      break;
    case 'back':
      showScreen(previousScreen || 'journeys', false);
      break;
    default:
      showShellNotice('Este recurso ainda está sendo conectado à experiência Voyage.');
  }
});

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
    <div class="import-toast" data-import-toast role="status" aria-live="polite"></div>`;
  document.querySelector('.app-shell')?.insertBefore(screen, document.querySelector('[data-bottom-nav]'));
}

async function refreshGmailStatus() {
  const title = document.querySelector('[data-gmail-title]');
  const detail = document.querySelector('[data-gmail-detail]');
  const dot = document.querySelector('[data-gmail-dot]');
  if (!title || !detail || !dot) return;
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

function showShellNotice(message) {
  let toast = document.querySelector('[data-shell-toast]');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'import-toast';
    toast.dataset.shellToast = '';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('import-toast--show');
  clearTimeout(showShellNotice.timer);
  showShellNotice.timer = setTimeout(() => toast.classList.remove('import-toast--show'), 3400);
}
