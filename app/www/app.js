const themeOverrides = document.createElement('link');
themeOverrides.rel = 'stylesheet';
themeOverrides.href = './themes.css';
document.head.appendChild(themeOverrides);

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

  screens.forEach((screen) => {
    screen.classList.toggle('screen--active', screen.dataset.screen === name);
  });

  const showNav = name !== 'welcome' && name !== 'availability';
  nav.hidden = !showNav;

  document.querySelectorAll('[data-nav]').forEach((item) => {
    item.classList.toggle('nav-item--active', item.dataset.nav === name || (name === 'journeys' && item.dataset.nav === 'journeys'));
  });

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
    case 'back':
      showScreen(previousScreen || 'journeys', false);
      break;
  }
});

applyTheme(getStoredTheme());
showScreen('welcome', false);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
}
