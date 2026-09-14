const HOME_STORAGE_KEY = 'voyage-home-preferences-v1';
const LEGACY_HOME_KEYS = ['voyage-home-layout', 'voyage-adaptive-home'];
const SUGGESTION_STORAGE_KEY = 'voyage-home-suggestions-v1';
const HOME_SCHEMA_VERSION = 1;
const SUGGESTION_TTL_MS = 6 * 60 * 60 * 1000;

const DEFAULT_CARDS = [
  { id: 'import', title: 'Importar tudo', description: 'Reservas, PDFs e documentos', icon: '⇧', action: 'imports', tier: 'essential', size: 'large', pinned: true, visible: true },
  { id: 'availability', title: 'Planejar janela', description: 'Tempo, conforto e custo', icon: '◫', action: 'availability', tier: 'essential', size: 'standard', pinned: false, visible: true },
  { id: 'command', title: 'Inteligência', description: 'Command Center da jornada', icon: '✦', nav: 'command', tier: 'essential', size: 'standard', pinned: false, visible: true },
  { id: 'guardian', title: 'Guardian', description: 'Operação em tempo real', icon: '⌾', nav: 'live', tier: 'advanced', size: 'standard', pinned: false, visible: true },
  { id: 'assistance', title: 'Assistência', description: 'Segurança e suporte rápido', icon: '♢', nav: 'security', tier: 'advanced', size: 'standard', pinned: false, visible: true },
  { id: 'connections', title: 'VoyMate', description: 'Pessoas e grupos da jornada', icon: '◎', nav: 'voymate', tier: 'advanced', size: 'standard', pinned: false, visible: true }
];

let state = loadHomeState();
let activeTier = 'all';
let draggedId = null;
persistState();

mountHome();

function mountHome() {
  const root = document.querySelector('[data-adaptive-home]');
  if (!root) return;
  renderHome(root);
  renderManager(root);
  updateNetworkState(root);
  window.addEventListener('online', () => updateNetworkState(root));
  window.addEventListener('offline', () => updateNetworkState(root));
  window.addEventListener('voyage:home-suggestion', (event) => {
    const detail = event.detail;
    if (!detail || typeof detail.id !== 'string' || typeof detail.message !== 'string') return;
    saveSuggestion({ id: detail.id, message: detail.message, action: detail.action, expiresAt: Date.now() + (Number(detail.ttlMs) || SUGGESTION_TTL_MS) });
    renderHome(root);
  });
  document.addEventListener('voyage:imports-updated', () => renderHome(root));
}

function renderHome(root) {
  const cards = root.querySelector('[data-home-cards]');
  if (!cards) return;
  cards.replaceChildren();
  const storedSuggestion = loadSuggestion();
  const suggestion = document.querySelector('[data-home-suggestion="journey"]');
  if (suggestion) {
    suggestion.hidden = !storedSuggestion;
    if (storedSuggestion) {
      const paragraph = suggestion.querySelector('p:not(.card-kicker)');
      if (paragraph) paragraph.textContent = storedSuggestion.message;
    }
  }

  state.cards
    .filter((card) => card.visible && (activeTier === 'all' || card.tier === activeTier))
    .sort((left, right) => left.order - right.order)
    .forEach((card) => cards.appendChild(createHomeCard(card)));

  if (!cards.children.length) {
    const empty = document.createElement('p');
    empty.className = 'adaptive-home__empty';
    empty.textContent = 'Nenhum módulo visível. Abra Personalizar Home para restaurar um módulo.';
    cards.appendChild(empty);
  }

  const status = root.querySelector('[data-home-status]');
  if (status && !navigator.onLine) status.textContent = 'Offline: preferências e módulos locais continuam disponíveis.';
}

function createHomeCard(card) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `adaptive-card adaptive-card--${card.size}${card.pinned ? ' adaptive-card--pinned' : ''}`;
  button.dataset.homeCard = card.id;
  if (card.nav) button.dataset.nav = card.nav;
  if (card.action) button.dataset.action = card.action;
  button.setAttribute('aria-label', `${card.title}: ${card.description}`);

  const icon = document.createElement('span');
  icon.className = 'adaptive-card__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = card.icon;
  const content = document.createElement('span');
  content.className = 'adaptive-card__content';
  const title = document.createElement('strong');
  title.textContent = card.title;
  const description = document.createElement('small');
  description.textContent = card.description;
  content.append(title, description);
  const arrow = document.createElement('b');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '›';
  button.append(icon, content, arrow);
  return button;
}

function renderManager(root) {
  const manager = document.createElement('dialog');
  manager.className = 'adaptive-dialog';
  manager.setAttribute('aria-labelledby', 'adaptive-home-title');
  manager.innerHTML = `
    <form method="dialog" class="adaptive-dialog__card">
      <header class="adaptive-dialog__head">
        <div><p class="card-kicker">ADAPTIVE HOME</p><h2 id="adaptive-home-title">Personalizar Home</h2><p>Escolha o que aparece primeiro. As preferências ficam apenas neste dispositivo.</p></div>
        <button class="icon-button" value="cancel" aria-label="Fechar personalização">×</button>
      </header>
      <div class="adaptive-tier" role="tablist" aria-label="Filtrar módulos">
        <button type="button" class="adaptive-tier__button is-active" data-home-tier="all" role="tab" aria-selected="true">Todos</button>
        <button type="button" class="adaptive-tier__button" data-home-tier="essential" role="tab" aria-selected="false">Essenciais</button>
        <button type="button" class="adaptive-tier__button" data-home-tier="advanced" role="tab" aria-selected="false">Avançados</button>
      </div>
      <div class="adaptive-manager-list" data-home-manager-list></div>
      <div class="adaptive-dialog__footer"><button type="button" class="button button--outline" data-home-reset>Restaurar padrão</button><button type="submit" class="button button--gold">Concluir</button></div>
    </form>`;
  document.body.appendChild(manager);

  root.querySelector('[data-action="manage-home"]')?.addEventListener('click', () => {
    renderManagerList(manager);
    if (typeof manager.showModal === 'function') manager.showModal();
    else manager.setAttribute('open', '');
  });
  manager.addEventListener('click', handleManagerClick);
  manager.addEventListener('close', () => {
    activeTier = 'all';
    renderHome(root);
  });
  manager.querySelector('[data-home-reset]')?.addEventListener('click', () => {
    state = makeDefaultState();
    persistState();
    activeTier = 'all';
    renderManagerList(manager);
    renderHome(root);
    setHomeStatus(root, 'Padrão restaurado e salvo neste dispositivo.');
  });
}

function renderManagerList(manager) {
  const list = manager.querySelector('[data-home-manager-list]');
  if (!list) return;
  list.replaceChildren();
  state.cards
    .filter((card) => activeTier === 'all' || card.tier === activeTier)
    .sort((left, right) => left.order - right.order)
    .forEach((card, index, cards) => list.appendChild(createManagerRow(card, index, cards)));
}

function createManagerRow(card, index, cards) {
  const row = document.createElement('article');
  row.className = `adaptive-manager-row${card.visible ? '' : ' is-hidden'}`;
  row.draggable = true;
  row.dataset.managerCard = card.id;
  row.innerHTML = `
    <span class="adaptive-manager-row__handle" aria-hidden="true">⋮⋮</span>
    <div class="adaptive-manager-row__copy"><strong></strong><small></small><span class="adaptive-tier-label"></span></div>
    <button type="button" class="adaptive-manager-row__toggle" data-home-visibility aria-pressed="true"></button>
    <button type="button" class="adaptive-manager-row__pin" data-home-pin aria-pressed="false"></button>
    <button type="button" class="adaptive-manager-row__size" data-home-size></button>
    <span class="adaptive-manager-row__move"><button type="button" data-home-move="up" aria-label="Mover para cima">↑</button><button type="button" data-home-move="down" aria-label="Mover para baixo">↓</button></span>`;
  row.querySelector('strong').textContent = card.title;
  row.querySelector('small').textContent = card.description;
  row.querySelector('.adaptive-tier-label').textContent = card.tier === 'essential' ? 'Essencial' : 'Avançado';
  const visibility = row.querySelector('[data-home-visibility]');
  visibility.textContent = card.visible ? 'Visível' : 'Oculto';
  visibility.setAttribute('aria-pressed', String(card.visible));
  const pin = row.querySelector('[data-home-pin]');
  pin.textContent = card.pinned ? 'Fixado' : 'Fixar';
  pin.setAttribute('aria-pressed', String(card.pinned));
  const size = row.querySelector('[data-home-size]');
  size.textContent = card.size === 'large' ? 'Grande' : 'Compacto';
  size.setAttribute('aria-label', `Tamanho ${card.title}: ${size.textContent}. Alterar tamanho`);
  row.addEventListener('dragstart', () => { draggedId = card.id; row.classList.add('is-dragging'); });
  row.addEventListener('dragend', () => { draggedId = null; row.classList.remove('is-dragging'); });
  row.addEventListener('dragover', (event) => event.preventDefault());
  row.addEventListener('drop', (event) => {
    event.preventDefault();
    if (!draggedId || draggedId === card.id) return;
    reorderCards(draggedId, card.id);
    renderManagerList(row.closest('dialog'));
  });
  row.querySelector('[data-home-move="up"]').disabled = index === 0;
  row.querySelector('[data-home-move="down"]').disabled = index === cards.length - 1;
  row.querySelectorAll('[data-home-move]').forEach((control) => control.addEventListener('click', (event) => {
    event.stopPropagation();
    moveCards(card.id, control.dataset.homeMove === 'up' ? -1 : 1);
    const manager = row.closest('dialog');
    if (manager) renderManagerList(manager);
    const home = document.querySelector('[data-adaptive-home]');
    if (home) renderHome(home);
  }));
  return row;
}

function handleManagerClick(event) {
  const tier = event.target.closest('[data-home-tier]');
  if (tier) {
    activeTier = tier.dataset.homeTier || 'all';
    event.currentTarget.querySelectorAll('[data-home-tier]').forEach((button) => {
      const active = button === tier;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    renderManagerList(event.currentTarget);
    return;
  }

  const row = event.target.closest('[data-manager-card]');
  if (!row) return;
  const card = state.cards.find((item) => item.id === row.dataset.managerCard);
  if (!card) return;
  if (event.target.closest('[data-home-visibility]')) card.visible = !card.visible;
  if (event.target.closest('[data-home-pin]')) card.pinned = !card.pinned;
  if (event.target.closest('[data-home-size]')) card.size = card.size === 'large' ? 'standard' : 'large';
  const move = event.target.closest('[data-home-move]');
  if (move) moveCards(card.id, move.dataset.homeMove === 'up' ? -1 : 1);
  if (event.target.closest('[data-home-visibility], [data-home-pin], [data-home-size], [data-home-move]')) {
    normalizeOrders();
    persistState();
    renderManagerList(event.currentTarget);
    const root = document.querySelector('[data-adaptive-home]');
    if (root) renderHome(root);
  }
}

function loadHomeState() {
  const candidates = [localStorage.getItem(HOME_STORAGE_KEY), ...LEGACY_HOME_KEYS.map((key) => localStorage.getItem(key))];
  for (const raw of candidates) {
    const migrated = migrateHomeState(raw);
    if (migrated) {
      return migrated;
    }
  }
  return makeDefaultState();
}

function migrateHomeState(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const sourceCards = Array.isArray(parsed) ? parsed : Array.isArray(parsed.cards) ? parsed.cards : Array.isArray(parsed.order) ? parsed.order.map((id) => ({ id })) : [];
    if (!sourceCards.length) return null;
    const byId = new Map(sourceCards.map((item, index) => [item?.id, { ...item, order: Number.isInteger(item?.order) ? item.order : index }]));
    const cards = DEFAULT_CARDS.map((defaultCard, index) => {
      const saved = byId.get(defaultCard.id);
      return { ...defaultCard, ...(saved || {}), order: saved ? saved.order : index, visible: saved?.visible !== false };
    });
    return { version: HOME_SCHEMA_VERSION, migratedFrom: parsed.version || 0, cards };
  } catch {
    return null;
  }
}

function makeDefaultState() {
  return { version: HOME_SCHEMA_VERSION, migratedFrom: null, cards: DEFAULT_CARDS.map((card, order) => ({ ...card, order })) };
}

function persistState() {
  normalizeOrders();
  try { localStorage.setItem(HOME_STORAGE_KEY, JSON.stringify(state)); } catch { /* local-only preference is best effort */ }
}

function normalizeOrders() {
  state.cards.sort((left, right) => left.order - right.order).forEach((card, index) => { card.order = index; });
}

function reorderCards(sourceId, targetId) {
  const source = state.cards.find((card) => card.id === sourceId);
  const target = state.cards.find((card) => card.id === targetId);
  if (!source || !target) return;
  source.order = target.order - 0.5;
  normalizeOrders();
  persistState();
}

function moveCards(id, delta) {
  normalizeOrders();
  const index = state.cards.findIndex((card) => card.id === id);
  const targetIndex = index + delta;
  if (index < 0 || targetIndex < 0 || targetIndex >= state.cards.length) return;
  [state.cards[index].order, state.cards[targetIndex].order] = [state.cards[targetIndex].order, state.cards[index].order];
  normalizeOrders();
  persistState();
}

function saveSuggestion(suggestion) {
  try { localStorage.setItem(SUGGESTION_STORAGE_KEY, JSON.stringify(suggestion)); } catch { /* suggestion is optional */ }
}

function loadSuggestion() {
  try {
    const raw = localStorage.getItem(SUGGESTION_STORAGE_KEY);
    if (!raw) return null;
    const suggestion = JSON.parse(raw);
    if (!suggestion || Number(suggestion.expiresAt) <= Date.now()) {
      localStorage.removeItem(SUGGESTION_STORAGE_KEY);
      return null;
    }
    return suggestion;
  } catch {
    return null;
  }
}

function updateNetworkState(root) {
  setHomeStatus(root, navigator.onLine ? 'Preferências salvas neste dispositivo.' : 'Offline: preferências e módulos locais continuam disponíveis.');
}

function setHomeStatus(root, message) {
  const status = root?.querySelector('[data-home-status]');
  if (status) status.textContent = message;
}

export { HOME_SCHEMA_VERSION, DEFAULT_CARDS, migrateHomeState, makeDefaultState, SUGGESTION_TTL_MS };
