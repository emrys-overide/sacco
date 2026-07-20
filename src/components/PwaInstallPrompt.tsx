import { useEffect, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { PWA_UPDATE_EVENT } from '../lib/pwa';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function PwaInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => setInstallPrompt(null);
    const onUpdate = () => setUpdateAvailable(true);
    window.addEventListener('beforeinstallprompt', onInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener(PWA_UPDATE_EVENT, onUpdate);
    return () => {
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener(PWA_UPDATE_EVENT, onUpdate);
    };
  }, []);

  if (dismissed || (!installPrompt && !updateAvailable)) return null;

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const update = async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    window.location.reload();
  };

  return (
    <aside className="fixed z-[70] bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-sm rounded-2xl border border-emerald-200 bg-white p-4 shadow-2xl" aria-live="polite">
      <button onClick={() => setDismissed(true)} className="absolute right-3 top-3 text-slate-400 hover:text-slate-700" aria-label="Dismiss application notice">
        <X className="h-4 w-4" />
      </button>
      <div className="pr-7">
        <p className="text-sm font-black text-slate-900">{updateAvailable ? 'Update available' : 'Install Sowetamu Sacco'}</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          {updateAvailable ? 'Reload to use the newest secure application version.' : 'Add the SACCO application to this device. Financial records still require a secure internet connection.'}
        </p>
      </div>
      <button onClick={updateAvailable ? update : install} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-900">
        {updateAvailable ? <RefreshCw className="h-4 w-4" /> : <Download className="h-4 w-4" />}
        {updateAvailable ? 'Update now' : 'Install application'}
      </button>
    </aside>
  );
}
