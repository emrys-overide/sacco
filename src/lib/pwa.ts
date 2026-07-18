export const PWA_UPDATE_EVENT = 'sacco-pwa-update-available';

export function registerSaccoServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
      .then(registration => {
        if (registration.waiting) window.dispatchEvent(new Event(PWA_UPDATE_EVENT));
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new Event(PWA_UPDATE_EVENT));
            }
          });
        });
      })
      .catch(error => console.warn('[PWA] Service worker registration failed.', error));
  });
}
