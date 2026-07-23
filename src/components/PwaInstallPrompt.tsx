import { useEffect, useState } from 'react';
import { Download, MoreVertical, RefreshCw, X } from 'lucide-react';
import {
  clearInstallPrompt,
  isSaccoInstalled,
  PWA_UPDATE_EVENT,
  SaccoInstallPromptEvent,
  subscribeToInstallPrompt
} from '../lib/pwa';

export default function PwaInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<SaccoInstallPromptEvent | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [installed, setInstalled] = useState(isSaccoInstalled);

  useEffect(() => {
    const unsubscribe = subscribeToInstallPrompt(setInstallPrompt);
    const onInstalled = () => {
      setInstalled(true);
      setShowInstructions(false);
    };
    const onUpdate = () => setUpdateAvailable(true);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener(PWA_UPDATE_EVENT, onUpdate);
    return () => {
      unsubscribe();
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener(PWA_UPDATE_EVENT, onUpdate);
    };
  }, []);

  if (installed && !updateAvailable) return null;

  const install = async () => {
    if (!installPrompt) {
      setShowInstructions(true);
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    clearInstallPrompt();
    if (choice.outcome === 'accepted') setInstalled(true);
  };

  const update = async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    window.location.reload();
  };

  if (!updateAvailable) {
    return (
      <>
        <button
          type="button"
          onClick={install}
          className="fixed z-[70] bottom-4 right-4 flex items-center gap-2 rounded-full bg-emerald-800 px-4 py-3 text-xs font-black text-white shadow-2xl hover:bg-emerald-900 focus:outline-none focus:ring-4 focus:ring-emerald-200"
          aria-label="Install Sowetamu Sacco application"
        >
          <Download className="h-4 w-4" />
          Install app
        </button>

        {showInstructions && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="install-help-title">
            <div className="relative w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
              <button
                type="button"
                onClick={() => setShowInstructions(false)}
                className="absolute right-4 top-4 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close installation instructions"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800">
                <MoreVertical className="h-6 w-6" />
              </div>
              <h2 id="install-help-title" className="mt-4 text-lg font-black text-slate-900">Install on Chrome</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Chrome has not offered its automatic installation window yet. You can still install the SACCO application:
              </p>
              <ol className="mt-4 space-y-3 text-sm font-semibold text-slate-800">
                <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-800 text-xs text-white">1</span><span>Tap Chrome&apos;s three-dot menu at the top-right.</span></li>
                <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-800 text-xs text-white">2</span><span>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</span></li>
                <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-800 text-xs text-white">3</span><span>Confirm by tapping <strong>Install</strong> or <strong>Add</strong>.</span></li>
              </ol>
              <button
                type="button"
                onClick={() => setShowInstructions(false)}
                className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800"
              >
                I understand
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <aside className="fixed z-[70] bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-sm rounded-2xl border border-emerald-200 bg-white p-4 shadow-2xl" aria-live="polite">
      <div className="pr-7">
        <p className="text-sm font-black text-slate-900">Update available</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          Reload to use the newest secure application version.
        </p>
      </div>
      <button onClick={update} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-900">
        <RefreshCw className="h-4 w-4" />
        Update now
      </button>
    </aside>
  );
}
