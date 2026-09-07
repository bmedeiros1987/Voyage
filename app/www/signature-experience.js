const SIGNATURE_VERSION = '1.0';

document.documentElement.dataset.voyageSignature = '1';
injectSignatureHome();
injectSignatureCommandCenter();
queueMicrotask(() => refreshSignatureStatus().catch(() => {}));

document.addEventListener('click', (event) => {
  const refresh = event.target.closest('[data-signature-refresh]');
  if (refresh) {
    refresh.classList.add('is-spinning');
    refreshSignatureStatus().finally(() => refresh.classList.remove('is-spinning'));
  }
});

function injectSignatureHome() {
  const journeys = document.querySelector('[data-screen="journeys"]');
  if (!journeys || journeys.querySelector('[data-signature-command]')) return;
  const segmented = journeys.querySelector('.segmented-control');
  const topbarActions = journeys.querySelector('.topbar-actions');

  if (topbarActions && !topbarActions.querySelector('[data-nav="command"]')) {
    const commandButton = document.createElement('button');
    commandButton.className = 'icon-button';
    commandButton.dataset.nav = 'command';
    commandButton.setAttribute('aria-label', 'Abrir Voyage Command Center');
    commandButton.title = 'Command Center';
    commandButton.textContent = '✦';
    topbarActions.prepend(commandButton);
  }

  const block = document.createElement('div');
  block.innerHTML = `
    <section class="signature-command" data-signature-command>
      <div class="signature-orbit" aria-hidden="true"><i></i></div>
      <div class="signature-kicker"><span></span> PRIVATE TRAVEL INTELLIGENCE</div>
      <h2>Seu mundo em movimento.</h2>
      <p>O Voyage organiza o que está confirmado, percebe o que mudou e coloca a próxima decisão certa na sua frente — sem alterar seu roteiro sem você.</p>
      <div class="signature-command__meta">
        <span class="signature-chip" data-signature-chip="platform"><b></b><span>Voyage Core</span></span>
        <span class="signature-chip" data-signature-chip="crewcheck"><b></b><span>CrewCheck</span></span>
        <span class="signature-chip" data-signature-chip="intelligence"><b></b><span>Intelligence</span></span>
        <span class="signature-chip" data-signature-chip="offline"><b></b><span>Offline</span></span>
      </div>
      <button class="signature-command__action" data-nav="command">
        <span>✦</span><span><strong>Abrir Command Center</strong><small>Integrações, prontidão e próximas ações em um só lugar</small></span><span>›</span>
      </button>
    </section>
    <section class="signature-quick-grid" aria-label="Ações rápidas Voyage Signature">
      <button class="signature-quick signature-quick--hero" data-action="imports"><span class="signature-quick__icon">⇧</span><span><strong>Importar tudo</strong><small>Reservas, PDFs e documentos</small></span></button>
      <button class="signature-quick" data-nav="command"><span class="signature-quick__icon">✦</span><span><strong>Inteligência</strong><small>Command Center da jornada</small></span></button>
      <button class="signature-quick" data-nav="live"><span class="signature-quick__icon">⌾</span><span><strong>Guardian</strong><small>Operação da viagem em tempo real</small></span></button>
      <button class="signature-quick" data-nav="security"><span class="signature-quick__icon">♢</span><span><strong>Assistência</strong><small>Segurança e suporte rápido</small></span></button>
    </section>`;

  const nodes = [...block.children];
  const anchor = segmented?.nextSibling;
  nodes.forEach((node) => journeys.insertBefore(node, anchor));
}

function injectSignatureCommandCenter() {
  const shell = document.querySelector('.app-shell');
  const nav = document.querySelector('[data-bottom-nav]');
  if (!shell || !nav || shell.querySelector('[data-screen="command"]')) return;

  const screen = document.createElement('section');
  screen.className = 'screen signature-screen';
  screen.dataset.screen = 'command';
  screen.innerHTML = `
    <header class="topbar">
      <button class="icon-button" data-action="back" aria-label="Voltar">←</button>
      <div><p class="mini-brand">VOYAGE SIGNATURE</p><h1>Command Center</h1><p class="topbar-subtitle">Tudo que importa, sem ruído.</p></div>
      <button class="signature-refresh" data-signature-refresh>Atualizar</button>
    </header>

    <article class="signature-console">
      <div class="signature-console__top">
        <div><p class="card-kicker">PRIVATE TRAVEL INTELLIGENCE</p><h2>Ecossistema Voyage</h2><p>O app prioriza serviços já disponíveis no CrewCheck antes de duplicar integrações ou provedores.</p></div>
        <span class="signature-live-pill"><i></i><span data-signature-platform-label>Verificando</span></span>
      </div>
      <div class="signature-readiness">
        <div class="signature-ring" data-signature-ring style="--score:0"><strong data-signature-score>—</strong></div>
        <div><h3>Prontidão tecnológica</h3><p>Mostra se as camadas necessárias para a experiência estão acessíveis. A prontidão da sua viagem é calculada separadamente quando uma jornada estiver ativa.</p><small data-signature-readiness-label>Aguardando diagnóstico…</small></div>
      </div>
      <div class="signature-system-grid">
        <div class="signature-system-tile" data-signature-system="core"><span><i></i>Core</span><strong>Verificando</strong></div>
        <div class="signature-system-tile" data-signature-system="intelligence"><span><i></i>Intelligence</span><strong>Verificando</strong></div>
        <div class="signature-system-tile" data-signature-system="crewcheck"><span><i></i>CrewCheck</span><strong>Verificando</strong></div>
        <div class="signature-system-tile" data-signature-system="gmail"><span><i></i>Gmail Travel</span><strong>Verificando</strong></div>
      </div>
    </article>

    <section class="signature-section">
      <div class="signature-section__head"><div><small>ORQUESTRAÇÃO</small><h2>Recursos reaproveitados</h2></div></div>
      <div class="signature-capability-grid">
        <button class="signature-capability" data-nav="live"><span>✈</span><span><strong>Voos, portões e bagagem</strong><small>Integração compartilhada com o ecossistema CrewCheck; Cirium e fontes operacionais entram por backend.</small></span><em data-capability-state="flight">Shared first</em></button>
        <button class="signature-capability" data-nav="live"><span>↝</span><span><strong>Rotas e trânsito</strong><small>Reutiliza a camada de rotas disponível no ecossistema antes de contratar ou expor outro provedor.</small></span><em data-capability-state="routes">Shared first</em></button>
        <button class="signature-capability" data-action="availability"><span>¤</span><span><strong>Câmbio e contexto local</strong><small>AwesomeAPI no backend para câmbio/CEP, com cache, proveniência e sem chave no cliente.</small></span><em data-capability-state="currency">Backend</em></button>
        <button class="signature-capability" data-action="imports"><span>⇧</span><span><strong>Universal Travel Importer</strong><small>PDF, Gmail e fontes externas viram fatos estruturados para o Planner Brain.</small></span><em data-capability-state="importer">Voyage</em></button>
        <button class="signature-capability" data-nav="command"><span>◇</span><span><strong>Journey Readiness</strong><small>Documentos, transporte, hospedagem, budget, bagagem, clima, offline e emergência.</small></span><em data-capability-state="readiness">Intelligence</em></button>
        <button class="signature-capability" data-nav="command"><span>⌖</span><span><strong>Aeroporto por dentro</strong><small>Roteamento interno in-app preparado para portão, imigração, esteira, alfândega, lounge e conexão.</small></span><em data-capability-state="indoor">In-app</em></button>
      </div>
    </section>

    <section class="signature-section">
      <div class="signature-section__head"><div><small>AGORA</small><h2>Fluxo do sistema</h2></div><button data-signature-refresh>Sincronizar</button></div>
      <div class="signature-stream" data-signature-stream>
        <article><time>—</time><i></i><div><strong>Carregando inteligência</strong><small>Consultando apenas os serviços disponíveis no ambiente atual.</small></div></article>
      </div>
    </section>

    <section class="quick-grid">
      <button class="quick-card quick-card--gold" data-action="imports"><span class="quick-icon">⇧</span><span><strong>Trazer reservas</strong><small>PDF ou Gmail</small></span><b>›</b></button>
      <button class="quick-card" data-action="availability"><span class="quick-icon">◫</span><span><strong>Planejar janela</strong><small>Tempo, conforto e custo</small></span><b>›</b></button>
      <button class="quick-card" data-nav="live"><span class="quick-icon">⌾</span><span><strong>Acompanhar viagem</strong><small>Guardian em tempo real</small></span><b>›</b></button>
      <button class="quick-card" data-nav="security"><span class="quick-icon">♢</span><span><strong>Assistência</strong><small>Segurança e emergência</small></span><b>›</b></button>
    </section>

    <p class="signature-footer-note"><b>Regra Voyage:</b> detectar, explicar e propor pode ser automático. Alterar o itinerário continua dependendo da aprovação explícita do usuário.</p>`;

  shell.insertBefore(screen, nav);
}

async function refreshSignatureStatus() {
  const responses = await Promise.allSettled([
    apiJson('/health'),
    apiJson('/api/v1/intelligence/capabilities'),
    apiJson('/api/v1/integrations/crewcheck/capabilities'),
    apiJson('/api/v1/integrations/gmail/status'),
    apiJson('/api/v1/imports/capabilities')
  ]);

  const health = valueOf(responses[0]);
  const intelligence = valueOf(responses[1]);
  const crewcheck = valueOf(responses[2]);
  const gmail = valueOf(responses[3]);
  const importer = valueOf(responses[4]);

  const states = {
    core: Boolean(health?.status === 'ok'),
    intelligence: Boolean(intelligence?.version || intelligence?.postRoutes || intelligence?.modules),
    crewcheck: Boolean(crewcheck?.configured || health?.crewCheckIntegration === 'configured'),
    gmail: Boolean(gmail?.enabled),
    importer: Boolean(importer),
    offline: 'serviceWorker' in navigator
  };

  updateChip('platform', states.core, 'Voyage Core');
  updateChip('crewcheck', states.crewcheck, states.crewcheck ? 'CrewCheck conectado' : 'CrewCheck disponível');
  updateChip('intelligence', states.intelligence, states.intelligence ? 'Intelligence ativa' : 'Intelligence verificando');
  updateChip('offline', states.offline, states.offline ? 'Offline shell' : 'Online');

  updateSystemTile('core', states.core, states.core ? 'Online' : 'Indisponível');
  updateSystemTile('intelligence', states.intelligence, states.intelligence ? 'Rotas carregadas' : 'Aguardando API');
  updateSystemTile('crewcheck', states.crewcheck, states.crewcheck ? 'Bridge configurado' : 'Pronto para vincular');
  updateSystemTile('gmail', states.gmail, states.gmail ? (gmail?.pushSyncEnabled ? 'Tempo real' : 'Autorizado') : 'Opcional');

  const weighted = [states.core, states.intelligence, states.importer, states.offline].filter(Boolean).length;
  const score = weighted * 25;
  const ring = document.querySelector('[data-signature-ring]');
  if (ring) ring.style.setProperty('--score', String(score));
  setText('[data-signature-score]', `${score}%`);
  setText('[data-signature-readiness-label]', score === 100 ? 'Base tecnológica pronta para a experiência Signature.' : `${weighted}/4 camadas essenciais disponíveis neste ambiente.`);
  setText('[data-signature-platform-label]', states.core ? 'Sistema ativo' : 'Modo degradado');

  document.querySelectorAll('[data-capability-state]').forEach((element) => {
    const kind = element.dataset.capabilityState;
    const ready = kind === 'importer' ? states.importer : kind === 'currency' ? states.core : kind === 'flight' || kind === 'routes' ? states.crewcheck : states.intelligence;
    element.classList.toggle('is-ready', ready);
    if (ready && ['flight','routes'].includes(kind)) element.textContent = 'Shared ready';
    else if (ready && kind === 'importer') element.textContent = 'Pronto';
    else if (ready && ['readiness','indoor'].includes(kind)) element.textContent = 'Ativo';
  });

  renderStream({ health, intelligence, crewcheck, gmail, importer, states });
}

function renderStream({ health, intelligence, crewcheck, gmail, importer, states }) {
  const container = document.querySelector('[data-signature-stream]');
  if (!container) return;
  const stamp = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  const rows = [
    states.core && ['Core Voyage', 'API e shell respondendo normalmente.'],
    states.intelligence && ['Intelligence Suite', `${countRoutes(intelligence)} superfícies de decisão disponíveis sem mutação automática.`],
    states.crewcheck && ['CrewCheck Shared Services', 'Bridge disponível para reaproveitar infraestrutura e evitar provedores duplicados.'],
    states.importer && ['Universal Travel Importer', 'Capacidades de importação disponíveis para alimentar a jornada.'],
    states.gmail
      ? ['Gmail Travel', gmail?.pushSyncEnabled ? 'Sincronização em tempo real preparada.' : 'Autorização disponível; canal em tempo real depende da configuração.']
      : ['Gmail Travel', 'Integração opcional; a importação manual continua independente.'],
    ['Approval Gate', 'Nenhuma mudança de itinerário é aplicada sem aprovação explícita.']
  ].filter(Boolean);

  container.innerHTML = rows.slice(0, 6).map(([title, detail], index) => `
    <article><time>${index === 0 ? stamp : '·'}</time><i></i><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></div></article>`).join('');
}

function countRoutes(payload) {
  const direct = [...(payload?.getRoutes || []), ...(payload?.postRoutes || [])].length;
  if (direct) return direct;
  const modules = payload?.modules && typeof payload.modules === 'object' ? Object.keys(payload.modules).length : 0;
  return modules || 'Várias';
}

function updateChip(name, ready, label) {
  const chip = document.querySelector(`[data-signature-chip="${name}"]`);
  if (!chip) return;
  chip.classList.toggle('is-ready', ready);
  chip.classList.toggle('is-attention', !ready);
  const text = chip.querySelector('span');
  if (text) text.textContent = label;
}

function updateSystemTile(name, ready, label) {
  const tile = document.querySelector(`[data-signature-system="${name}"]`);
  if (!tile) return;
  tile.classList.toggle('is-ready', ready);
  tile.classList.toggle('is-attention', !ready);
  const text = tile.querySelector('strong');
  if (text) text.textContent = label;
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function valueOf(result) {
  return result?.status === 'fulfilled' ? result.value : null;
}

async function apiJson(path) {
  const base = (localStorage.getItem('voyage-api-base') || '').replace(/\/$/, '');
  const response = await fetch(`${base}${path}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`signature_api_${response.status}`);
  return response.json();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

export { SIGNATURE_VERSION, refreshSignatureStatus };
