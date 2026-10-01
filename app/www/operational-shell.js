import { apiUrl, fetchApi, getSessionToken, clearSessionToken } from './api-origin.js';

const AUTH_STATUS_PATH = '/api/v1/auth/google/status';
const SESSION_PATH = '/api/v1/auth/session';
const JOURNEYS_PATH = '/api/v1/journeys';
const PDF_IMPORT_PATH = '/api/v1/journeys/imports/pdf';
const MAX_PDF_BYTES = 15 * 1024 * 1024;

let googleLoginEnabled = false;

export async function uploadJourneyPdf(file) {
  if (!file || file.size > MAX_PDF_BYTES) throw new Error('Selecione um PDF de até 15 MB.');
  if (!getSessionToken()) throw new Error('Entre na sua conta antes de importar uma jornada.');
  const response = await fetchApi(PDF_IMPORT_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: file
  });
  return parseCanonicalResponse(response, 'Não foi possível importar este PDF.');
}

export async function confirmJourney({ importId, title, facts }) {
  if (!getSessionToken()) throw new Error('Sua sessão terminou. Entre novamente.');
  const response = await fetchApi(JOURNEYS_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      importId,
      title: String(title || '').trim(),
      confirmed: true,
      facts
    })
  });
  return parseCanonicalResponse(response, 'Não foi possível salvar a jornada.');
}

export function flattenJourneyFacts(value) {
  const output = {};
  const ancestors = new Set();

  function visit(current, path) {
    if (Object.keys(output).length >= 56 || path.length > 7) return;
    if (current !== null && typeof current === 'object') {
      if (ancestors.has(current)) return;
      ancestors.add(current);
      if (Array.isArray(current)) {
        current.forEach((item, index) => visit(item, [...path, String(index + 1)]));
      } else {
        for (const [key, child] of Object.entries(current)) {
          if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(key)) continue;
          visit(child, [...path, key]);
        }
      }
      ancestors.delete(current);
      return;
    }

    if (!path.length || !['string', 'number', 'boolean'].includes(typeof current)) return;
    const key = path.join('_').slice(0, 64);
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || Object.hasOwn(output, key)) return;
    const text = String(current).trim().slice(0, 2000);
    if (text) output[key] = text;
  }

  visit(value, []);
  return output;
}

async function parseCanonicalResponse(response, fallbackMessage) {
  if (response.status === 401) {
    clearSessionToken();
    setSignedOutState('Sua sessão terminou. Entre novamente.');
    throw new Error('Sua sessão terminou. Entre novamente.');
  }

  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(fallbackMessage);
  return body;
}

function setLoginAvailability(enabled) {
  googleLoginEnabled = enabled === true;
  for (const button of document.querySelectorAll('[data-action="login"], [data-action="google-login"], [data-action="create-account"]')) {
    button.disabled = !googleLoginEnabled;
    button.setAttribute('aria-disabled', googleLoginEnabled ? 'false' : 'true');
  }
  const note = document.querySelector('.welcome-note');
  if (note) {
    note.textContent = googleLoginEnabled
      ? 'Entre com Google para acessar suas jornadas. O login não concede acesso ao Gmail.'
      : 'O acesso à conta ainda não está disponível neste ambiente.';
  }
}

function openJourneysScreen() {
  document.querySelectorAll('.screen').forEach((screen) => {
    screen.classList.toggle('screen--active', screen.dataset.screen === 'journeys');
  });
  const nav = document.querySelector('[data-bottom-nav]');
  if (nav) nav.hidden = false;
  document.querySelectorAll('[data-nav]').forEach((item) => {
    item.classList.toggle('nav-item--active', item.dataset.nav === 'journeys');
  });
}

function setSignedOutState(message) {
  const welcome = document.querySelector('[data-screen="welcome"]');
  if (welcome) {
    document.querySelectorAll('.screen').forEach((screen) => screen.classList.remove('screen--active'));
    welcome.classList.add('screen--active');
  }
  const nav = document.querySelector('[data-bottom-nav]');
  if (nav) nav.hidden = true;
  if (message) showOperationalNotice(message);
}

async function refreshJourneys() {
  const response = await fetchApi(JOURNEYS_PATH, { headers: { Accept: 'application/json' } });
  const payload = await parseCanonicalResponse(response, 'Não foi possível carregar suas jornadas.');
  renderJourneys(Array.isArray(payload.journeys) ? payload.journeys : []);
}

function renderJourneys(journeys) {
  const screen = document.querySelector('[data-screen="journeys"]');
  const empty = screen?.querySelector('[data-empty-state="journeys"]');
  let list = screen?.querySelector('[data-operational-journeys]');
  if (!screen) return;

  if (!list) {
    list = document.createElement('section');
    list.className = 'journey-runtime-list';
    list.dataset.operationalJourneys = '';
    const insight = screen.querySelector('.insight-card');
    screen.insertBefore(list, insight || null);
  }
  list.replaceChildren();

  if (!journeys.length) {
    if (empty) empty.hidden = false;
    return;
  }

  if (empty) empty.hidden = true;
  for (const journey of journeys) {
    const card = document.createElement('article');
    card.className = 'premium-panel journey-runtime-card';

    const kicker = document.createElement('p');
    kicker.className = 'card-kicker';
    kicker.textContent = 'JORNADA SALVA';

    const heading = document.createElement('h2');
    heading.textContent = String(journey.title || 'Jornada');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button--outline';
    button.textContent = 'Abrir jornada';
    button.addEventListener('click', () => openJourneyDetail(journey.id).catch((error) => showOperationalNotice(error.message)));

    card.append(kicker, heading, button);
    list.append(card);
  }
}

async function openJourneyDetail(journeyId) {
  if (!/^[a-f0-9-]{36}$/i.test(String(journeyId || ''))) throw new Error('Jornada inválida.');
  const response = await fetchApi(`${JOURNEYS_PATH}/${journeyId}`, { headers: { Accept: 'application/json' } });
  const journey = await parseCanonicalResponse(response, 'Não foi possível abrir esta jornada.');
  const screen = document.querySelector('[data-screen="trip"]');
  const card = screen?.querySelector('.empty-state');
  if (!screen || !card) return;

  card.replaceChildren();
  const heading = document.createElement('h2');
  heading.textContent = String(journey.title || 'Jornada');
  const facts = document.createElement('dl');
  for (const [key, value] of Object.entries(journey.facts || {})) {
    const dt = document.createElement('dt');
    dt.textContent = String(key).replaceAll('_', ' ');
    const dd = document.createElement('dd');
    dd.textContent = String(value);
    facts.append(dt, dd);
  }
  card.append(heading, facts);

  document.querySelectorAll('.screen').forEach((item) => {
    item.classList.toggle('screen--active', item === screen);
  });
}

function showOperationalNotice(message) {
  let toast = document.querySelector('[data-operational-toast]');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'import-toast';
    toast.dataset.operationalToast = '';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = String(message || '');
  toast.classList.add('import-toast--show');
  clearTimeout(showOperationalNotice.timer);
  showOperationalNotice.timer = setTimeout(() => toast.classList.remove('import-toast--show'), 4200);
}

function installLoginActions() {
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action="login"], [data-action="google-login"], [data-action="create-account"]');
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    if (!googleLoginEnabled) {
      showOperationalNotice('O acesso à conta ainda não está disponível neste ambiente.');
      return;
    }
    window.location.assign(apiUrl('/api/v1/auth/google/start?purpose=login'));
  }, true);
}

async function initializeOperationalShell() {
  installLoginActions();

  let status = null;
  try {
    const response = await fetchApi(AUTH_STATUS_PATH, { headers: { Accept: 'application/json' } });
    if (response.ok) status = await response.json();
  } catch {}
  setLoginAvailability(status?.enabled === true);

  if (!getSessionToken()) return;

  const session = await fetchApi(SESSION_PATH, { headers: { Accept: 'application/json' } });
  if (!session.ok) {
    clearSessionToken();
    setSignedOutState('Sua sessão não está mais ativa.');
    return;
  }

  openJourneysScreen();
  await refreshJourneys();
  document.dispatchEvent(new CustomEvent('voyage:session-ready'));
  showOperationalNotice('Voyage conectado à sua conta.');
}

if (typeof document !== 'undefined') {
  document.addEventListener('voyage:journey-confirmed', () => refreshJourneys()
    .catch((error) => showOperationalNotice(error.message)));
  queueMicrotask(() => initializeOperationalShell().catch((error) => showOperationalNotice(error.message)));
}
