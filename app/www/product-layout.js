injectPremiumProductLayout();

function injectPremiumProductLayout() {
  const journeys = document.querySelector('[data-screen="journeys"]');
  const nav = document.querySelector('[data-bottom-nav]');
  if (!journeys || !nav) return;

  const segmented = journeys.querySelector('.segmented-control');
  if (segmented && !journeys.querySelector('[data-voyage-pulse]')) {
    const pulse = document.createElement('section');
    pulse.className = 'voyage-pulse';
    pulse.dataset.voyagePulse = '';
    pulse.innerHTML = `
      <div class="voyage-pulse__ambient"></div>
      <div class="voyage-pulse__head">
        <div>
          <p class="card-kicker">Voyage Pulse</p>
          <h2>Seu dia, organizado antes de começar.</h2>
        </div>
        <span class="live-pill"><i></i> Inteligência ativa</span>
      </div>
      <div class="voyage-pulse__timeline">
        <div class="pulse-stop pulse-stop--done"><span class="pulse-dot">✓</span><div><small>Reserva</small><strong>Hotel confirmado</strong></div></div>
        <div class="pulse-line"><span style="width:58%"></span></div>
        <div class="pulse-stop pulse-stop--active"><span class="pulse-dot">2</span><div><small>Agora</small><strong>2 decisões para revisar</strong></div></div>
        <div class="pulse-line"><span></span></div>
        <div class="pulse-stop"><span class="pulse-dot">3</span><div><small>Depois</small><strong>Roteiro otimizado</strong></div></div>
      </div>
      <button class="pulse-action" data-nav="inbox"><span>Ver o que precisa de atenção</span><b>→</b></button>`;
    segmented.insertAdjacentElement('afterend', pulse);
  }

  const firstHero = journeys.querySelector('.hero-card');
  if (firstHero && !journeys.querySelector('[data-quick-grid]')) {
    const quick = document.createElement('section');
    quick.className = 'quick-grid';
    quick.dataset.quickGrid = '';
    quick.innerHTML = `
      <button class="quick-card quick-card--gold" data-nav="inbox"><span class="quick-icon">✦</span><span><strong>Inbox</strong><small>Novas reservas</small></span><em>3</em></button>
      <button class="quick-card" data-nav="wallet"><span class="quick-icon">▤</span><span><strong>Carteira</strong><small>Offline e pronta</small></span></button>
      <button class="quick-card" data-nav="planner"><span class="quick-icon">◇</span><span><strong>Planejar</strong><small>Planner Brain</small></span></button>
      <button class="quick-card" data-action="imports"><span class="quick-icon">⇧</span><span><strong>Importar</strong><small>PDF ou Gmail</small></span></button>`;
    firstHero.insertAdjacentElement('beforebegin', quick);
  }

  const insight = journeys.querySelector('.insight-card');
  if (insight && !journeys.querySelector('[data-today-preview]')) {
    const today = document.createElement('section');
    today.className = 'today-preview';
    today.dataset.todayPreview = '';
    today.innerHTML = `
      <div class="section-heading"><div><p class="card-kicker">Sua viagem agora</p><h2>Um roteiro que respira com você</h2></div><button class="text-button" data-nav="planner">Abrir</button></div>
      <div class="today-track">
        <article class="today-item"><time>08:30</time><span class="today-marker today-marker--gold"></span><div><strong>Café da manhã</strong><small>Hotel ou cafés próximos · decisão pendente</small></div></article>
        <article class="today-item"><time>10:00</time><span class="today-marker"></span><div><strong>Centro histórico</strong><small>3 pontos agrupados · 1h42 a pé no total</small></div></article>
        <article class="today-item"><time>12:30</time><span class="today-marker"></span><div><strong>Almoço</strong><small>Compatível com suas preferências · 4 opções</small></div></article>
        <article class="today-item today-item--soft"><time>15:20</time><span class="today-marker"></span><div><strong>Tempo livre protegido</strong><small>1h20 sem compromisso obrigatório</small></div></article>
      </div>`;
    insight.insertAdjacentElement('beforebegin', today);
  }

  const screens = [buildInboxScreen(), buildWalletScreen(), buildPlannerScreen()];
  screens.forEach((screen) => {
    if (!document.querySelector(`[data-screen="${screen.dataset.screen}"]`)) nav.parentElement.insertBefore(screen, nav);
  });

  const journeyNav = nav.querySelector('[data-nav="trip"]');
  if (journeyNav) {
    journeyNav.dataset.nav = 'wallet';
    journeyNav.innerHTML = '<span class="nav-icon">▤</span><small>Carteira</small>';
  }
}

function buildInboxScreen() {
  const section = document.createElement('section');
  section.className = 'screen product-screen';
  section.dataset.screen = 'inbox';
  section.innerHTML = `
    <header class="topbar product-topbar">
      <div><p class="mini-brand">TRAVEL INBOX</p><h1>Tudo que mudou na sua viagem</h1><p class="topbar-subtitle">O Voyage organiza confirmações, alterações e documentos em um só lugar.</p></div>
      <button class="icon-button" data-action="imports" aria-label="Importar">⇧</button>
    </header>
    <div class="inbox-summary">
      <div><span>3</span><small>novidades</small></div><div><span>1</span><small>precisa revisar</small></div><div><span>0</span><small>conflitos críticos</small></div>
    </div>
    <div class="segmented-control inbox-filter"><button class="segment segment--active">Tudo</button><button class="segment">Reservas</button><button class="segment">Alterações</button></div>
    <div class="inbox-list">
      <article class="inbox-card inbox-card--new"><span class="inbox-symbol">✈</span><div><p class="card-kicker">Nova reserva</p><h3>Voo encontrado e associado à jornada</h3><p>O Voyage reconheceu o trecho, horário e localizador e o colocou na linha do tempo.</p><div class="inbox-meta"><span>Gmail</span><span>agora</span></div></div><button>›</button></article>
      <article class="inbox-card inbox-card--attention"><span class="inbox-symbol">!</span><div><p class="card-kicker">Revisar</p><h3>Documento precisa de confirmação</h3><p>O arquivo foi preservado, mas alguns campos não atingiram confiança suficiente para automação.</p><div class="inbox-meta"><span>PDF</span><span>2 min</span></div></div><button>›</button></article>
      <article class="inbox-card"><span class="inbox-symbol">↻</span><div><p class="card-kicker">Atualização</p><h3>Pedido de cancelamento recebido</h3><p>A reserva continua ativa até o fornecedor confirmar o cancelamento.</p><div class="inbox-meta"><span>Fornecedor</span><span>hoje</span></div></div><button>›</button></article>
    </div>`;
  return section;
}

function buildWalletScreen() {
  const section = document.createElement('section');
  section.className = 'screen product-screen';
  section.dataset.screen = 'wallet';
  section.innerHTML = `
    <header class="topbar product-topbar"><div><p class="mini-brand">VOYAGE WALLET</p><h1>Sua viagem no bolso</h1><p class="topbar-subtitle">Bilhetes, reservas e documentos essenciais, inclusive offline.</p></div><button class="icon-button" data-action="imports">＋</button></header>
    <article class="wallet-pass wallet-pass--flight">
      <div class="wallet-pass__brand"><span>VOYAGE</span><b>BOARDING</b></div>
      <div class="wallet-pass__route"><div><small>Origem</small><strong>GRU</strong></div><span>✈</span><div><small>Destino</small><strong>CDG</strong></div></div>
      <div class="wallet-pass__details"><span><small>Voo</small><b>AF 457</b></span><span><small>Portão</small><b>—</b></span><span><small>Assento</small><b>—</b></span></div>
      <div class="wallet-pass__footer"><span class="offline-badge">✓ disponível offline</span><button>Ver documento</button></div>
    </article>
    <div class="wallet-grid">
      <article class="wallet-tile"><span>▣</span><div><strong>Hotel</strong><small>Reserva confirmada</small></div><b>›</b></article>
      <article class="wallet-tile"><span>↝</span><div><strong>Carro</strong><small>Retirada sincronizada</small></div><b>›</b></article>
      <article class="wallet-tile"><span>◇</span><div><strong>Ingressos</strong><small>2 documentos</small></div><b>›</b></article>
      <article class="wallet-tile"><span>⌑</span><div><strong>Passeios</strong><small>1 voucher</small></div><b>›</b></article>
    </div>
    <article class="wallet-readiness"><span class="readiness-ring">92%</span><div><p class="card-kicker">Prontidão da viagem</p><h3>Quase tudo preparado</h3><p>Faltam apenas dois itens que podem exigir ação antes da partida.</p></div></article>`;
  return section;
}

function buildPlannerScreen() {
  const section = document.createElement('section');
  section.className = 'screen product-screen';
  section.dataset.screen = 'planner';
  section.innerHTML = `
    <header class="topbar product-topbar"><div><p class="mini-brand">PLANNER BRAIN</p><h1>Planejar sem desperdiçar tempo</h1><p class="topbar-subtitle">Horários, distância, refeições, trabalho, descanso e vontade do grupo.</p></div><button class="icon-button icon-button--gold">✦</button></header>
    <article class="planner-hero">
      <div class="planner-hero__glow"></div>
      <p class="card-kicker">Resumo inteligente</p>
      <h2>Seu roteiro está bom. Posso deixá-lo 23% mais leve em deslocamentos.</h2>
      <p>Vou preservar os compromissos fixos e reorganizar apenas o que for flexível.</p>
      <div class="planner-score"><span><b>8,7</b><small>qualidade</small></span><span><b>42 min</b><small>economia estimada</small></span><span><b>1h20</b><small>tempo livre</small></span></div>
      <button class="button button--gold">Otimizar meu dia</button>
    </article>
    <div class="planner-controls">
      <button class="planner-control planner-control--active"><span>☼</span><strong>Equilibrado</strong><small>ritmo da viagem</small></button>
      <button class="planner-control"><span>◷</span><strong>12:30</strong><small>almoço preferido</small></button>
      <button class="planner-control"><span>⌁</span><strong>Café flexível</strong><small>hotel ou cidade</small></button>
      <button class="planner-control"><span>◈</span><strong>Treino</strong><small>encaixar se fizer sentido</small></button>
    </div>
    <section class="planner-day">
      <div class="section-heading"><div><p class="card-kicker">Dia 2</p><h2>Roma · terça-feira</h2></div><span class="day-quality">Muito bom</span></div>
      <div class="day-plan">
        <article><time>08:30</time><span></span><div><strong>Café da manhã</strong><small>Hotel ou café recomendado a até 8 min</small></div><em>flexível</em></article>
        <article><time>10:00</time><span></span><div><strong>Coliseu + Fórum</strong><small>Âncora do dia · ingresso com horário</small></div><em class="locked">fixo</em></article>
        <article><time>12:40</time><span></span><div><strong>Almoço próximo</strong><small>4 opções compatíveis com preferências</small></div><em>sugestão</em></article>
        <article><time>15:10</time><span></span><div><strong>Trastevere</strong><small>Cluster de 3 lugares salvos no Maps</small></div><em>otimizado</em></article>
        <article><time>18:00</time><span></span><div><strong>Tempo livre</strong><small>Protegido para descanso, compras ou improviso</small></div><em>livre</em></article>
      </div>
    </section>`;
  return section;
}
