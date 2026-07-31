const RUNTIME_VERSION = 'akari-crm-runtime-v7';

async function resetStaleRuntime() {
  const previous = localStorage.getItem('akari-crm-runtime-version');
  if (previous === RUNTIME_VERSION) return;

  localStorage.setItem('akari-crm-runtime-version', RUNTIME_VERSION);

  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
  }

  if ('caches' in window) {
    const keys = await caches.keys().catch(() => []);
    await Promise.all(keys.map((key) => caches.delete(key).catch(() => false)));
  }

  const url = new URL(location.href);
  if (url.searchParams.get('runtime') !== 'v7') {
    url.searchParams.set('runtime', 'v7');
    location.replace(url.toString());
  }
}

resetStaleRuntime().catch(() => undefined);

window.addEventListener('error', (event) => {
  console.error('AKARI CRM runtime error', event.error || event.message);
  document.documentElement.dataset.akariRuntimeError = 'true';
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('AKARI CRM unhandled rejection', event.reason);
  document.documentElement.dataset.akariRuntimeError = 'true';
});
