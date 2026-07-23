export const PWA_UPDATE_EVENT = 'sacco-pwa-update-available';

export interface SaccoInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type InstallPromptListener = (prompt: SaccoInstallPromptEvent | null) => void;

let pendingInstallPrompt: SaccoInstallPromptEvent | null = null;
const installPromptListeners = new Set<InstallPromptListener>();

function publishInstallPrompt(prompt: SaccoInstallPromptEvent | null) {
  pendingInstallPrompt = prompt;
  installPromptListeners.forEach(listener => listener(prompt));
}

// Capture this browser event as soon as the PWA module loads. Chrome may emit it
// before React finishes mounting the install control.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    publishInstallPrompt(event as SaccoInstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => publishInstallPrompt(null));
}

export function subscribeToInstallPrompt(listener: InstallPromptListener) {
  installPromptListeners.add(listener);
  listener(pendingInstallPrompt);
  return () => installPromptListeners.delete(listener);
}

export function clearInstallPrompt() {
  publishInstallPrompt(null);
}

export function isSaccoInstalled() {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches;
}

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
