import { apiUrl, fetchApi, setSessionToken, getSessionToken, clearSessionToken } from './api-origin.js?v=operational-1';
const $ = (id) => document.getElementById(id);
let pendingImport = null;
const notice = (text) => { $('notice').textContent = text; };
async function request(path, options) {
  const response = await fetchApi(path, options);
  if (response.status === 401) { clearSessionToken(); setSignedIn(false); throw new Error('Sua sessão terminou. Entre novamente.'); }
  if (!response.ok) throw new Error('Não foi possível concluir. Seus dados não foram confirmados; tente novamente.');
  return response.json();
}
function setSignedIn(value) {
  $('signed-in').hidden = !value; $('signed-out').hidden = value;
  if (!value) { pendingImport = null; $('review').hidden = true; $('facts').replaceChildren(); $('journeys').replaceChildren(); $('detail').replaceChildren(); $('detail').hidden = true; }
}
async function listJourneys() {
  const { journeys } = await request('/api/v1/journeys');
  $('journeys').replaceChildren();
  if (!journeys.length) $('journeys').textContent = 'Nenhuma jornada salva ainda.';
  for (const journey of journeys) {
    const button = document.createElement('button'); button.textContent = journey.title;
    button.addEventListener('click', () => run(button, async () => {
      const record = await request(`/api/v1/journeys/${journey.id}`);
      const heading = document.createElement('h3'); heading.textContent = record.title;
      const list = document.createElement('dl');
      for (const [key, value] of Object.entries(record.facts)) {
        const dt = document.createElement('dt'); dt.textContent = key;
        const dd = document.createElement('dd'); dd.textContent = value; list.append(dt, dd);
      }
      $('detail').replaceChildren(heading, list); $('detail').hidden = false;
      notice('Jornada recuperada da sua conta.');
    }));
    $('journeys').append(button);
  }
}
async function run(button, action) {
  button.disabled = true;
  try { await action(); } catch (error) { notice(error.message); } finally { button.disabled = false; }
}
$('login').addEventListener('click', () => location.assign(apiUrl('/api/v1/auth/google/start?purpose=login')));
$('logout').addEventListener('click', () => run($('logout'), async () => {
  await request('/api/v1/auth/logout', { method: 'POST' }); clearSessionToken(); setSignedIn(false); notice('Você saiu. Suas jornadas continuam salvas na conta.');
}));
$('upload').addEventListener('submit', (event) => {
  event.preventDefault(); run(event.submitter, async () => {
    const file = $('pdf').files[0];
    if (!file || file.size > 15 * 1024 * 1024) throw new Error('Selecione um PDF de até 15 MB.');
    pendingImport = null; $('review').hidden = true;
    const result = await request('/api/v1/journeys/imports/pdf', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
    pendingImport = result.importId; $('facts').replaceChildren(); $('confirmed').checked = false; $('notes').value = ''; $('title').value = '';
    for (const [key, value] of Object.entries(result.facts)) {
      if (value == null || typeof value === 'object') continue;
      const label = document.createElement('label'); label.textContent = key;
      const input = document.createElement('input'); input.dataset.fact = key; input.value = String(value); input.maxLength = 2000; label.append(input); $('facts').append(label);
    }
    $('review-note').textContent = result.review.required ? 'Extração incompleta: confira o documento original e complete ou corrija os campos. Nada será confirmado automaticamente.' : 'Compare todos os campos com o documento original e corrija o que for necessário.';
    $('review').hidden = false; notice('Documento recebido. Revise os dados para criar a jornada.');
  });
});
$('review').addEventListener('submit', (event) => {
  event.preventDefault(); run(event.submitter, async () => {
    const facts = Object.fromEntries([...$('facts').querySelectorAll('input')].map((input) => [input.dataset.fact, input.value]));
    if ($('notes').value.trim()) facts.notes = $('notes').value;
    await request('/api/v1/journeys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ importId: pendingImport, title: $('title').value, confirmed: $('confirmed').checked, facts }) });
    pendingImport = null; $('review').hidden = true; $('upload').reset(); await listJourneys(); notice('Jornada salva na sua conta. Você poderá recuperá-la ao entrar novamente.');
  });
});
async function initialize() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has('voyage_session')) setSessionToken(params.get('voyage_session'));
  const failed = params.has('oauth_error');
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  const status = await request('/api/v1/auth/google/status'); $('login').hidden = !status.enabled;
  if (!getSessionToken()) { setSignedIn(false); notice(failed ? 'A autorização não foi concluída. Tente entrar novamente.' : status.enabled ? 'Entre para acessar suas jornadas.' : 'Login temporariamente indisponível. A configuração de acesso ainda precisa ser concluída.'); return; }
  await request('/api/v1/auth/session'); setSignedIn(true); await listJourneys(); notice('Sua sessão está ativa.');
}
initialize().catch((error) => notice(error.message));

// Version the session helper to avoid stale pre-login PWA exports during upgrade.
if ('serviceWorker' in navigator) {
  const worker = location.pathname.startsWith('/voyage/') ? '/voyage/service-worker.js' : '/service-worker.js';
  navigator.serviceWorker.register(worker).catch(() => {});
}
