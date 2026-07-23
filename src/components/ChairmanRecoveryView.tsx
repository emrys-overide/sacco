import React, { useEffect, useState } from 'react';
import { KeyRound, ShieldAlert, UserRoundCheck } from 'lucide-react';
import { fetchSaccoJson, postSaccoJson } from '../lib/api';

type ChairmanRecoveryRequest = {
  id: string;
  user_id: string;
  full_name: string;
  email?: string;
  phone?: string;
  created_at: string;
};

export default function ChairmanRecoveryView({ token }: { token: string }) {
  const [requests, setRequests] = useState<ChairmanRecoveryRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<ChairmanRecoveryRequest | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    fetchSaccoJson<ChairmanRecoveryRequest[]>('/api/chairman-recovery-requests', {}, token)
      .then(data => { if (active) setRequests(data); })
      .catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Chairman recovery requests could not be loaded.'); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [token]);

  const approve = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedRequest) return;
    if (temporaryPassword.length < 8) {
      setError('The temporary recovery password must contain at least 8 characters.');
      return;
    }
    if (temporaryPassword !== confirmPassword) {
      setError('The recovery password and confirmation do not match.');
      return;
    }

    setError('');
    setNotice('');
    setIsSaving(true);
    try {
      await postSaccoJson(`/api/chairman-recovery-requests/${selectedRequest.id}/approve`, { password: temporaryPassword }, token);
      setRequests(current => current.filter(item => item.id !== selectedRequest.id));
      setNotice(`Temporary recovery access is ready for ${selectedRequest.full_name}. Share it privately; they must change it immediately after signing in.`);
      setSelectedRequest(null);
      setTemporaryPassword('');
      setConfirmPassword('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Chairman recovery could not be approved.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-800"><KeyRound className="h-6 w-6" /></div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Exceptional Secretary authority</p>
              <h2 className="mt-1 font-display text-2xl font-bold text-slate-900">Chairman recovery</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">This page exists only when the Chairman cannot sign in. You may issue a temporary recovery password only for a pending Chairman request. You cannot reset any other account here.</p>
            </div>
          </div>

          <div className="mt-6 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-950">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <p>Verify the Chairman using the SACCO’s agreed process before approving: for example, in-person ID confirmation and a trusted registered phone contact. Do not send the temporary password by email, WhatsApp, or a group message. This action is audit-logged.</p>
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-display text-xl font-bold text-slate-900">Pending requests</h3>
              <p className="mt-1 text-xs text-slate-500">Only active Chairman recovery requests appear here.</p>
            </div>
            <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-black text-amber-800">{requests.length} pending</span>
          </div>

          {error && <p className="mt-5 rounded-xl bg-rose-50 px-3 py-2.5 text-xs font-medium leading-5 text-rose-700">{error}</p>}
          {notice && <p className="mt-5 rounded-xl bg-emerald-50 px-3 py-2.5 text-xs font-medium leading-5 text-emerald-700">{notice}</p>}

          <div className="mt-6 space-y-3">
            {isLoading ? <p className="text-sm text-slate-500">Loading recovery requests...</p> : requests.map(request => (
              <div key={request.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800">{request.full_name}</p>
                  <p className="mt-1 truncate text-xs text-slate-500">{request.email || request.phone || 'Registered Chairman account'}</p>
                  <p className="mt-1 text-[10px] text-slate-400">Requested {new Date(request.created_at).toLocaleString('en-KE')}</p>
                </div>
                <button type="button" disabled={isSaving} onClick={() => { setSelectedRequest(request); setTemporaryPassword(''); setConfirmPassword(''); setError(''); setNotice(''); }} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-emerald-700 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"><UserRoundCheck className="h-4 w-4" />Verify &amp; set recovery password</button>
              </div>
            ))}
            {!isLoading && requests.length === 0 && <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">No Chairman recovery requests are waiting.</p>}
          </div>
        </section>

        {selectedRequest && (
          <section className="rounded-[2rem] border border-emerald-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700"><UserRoundCheck className="h-5 w-5" /></div>
              <div><h3 className="font-display text-xl font-bold text-slate-900">Verify and issue recovery access</h3><p className="mt-1 text-xs leading-5 text-slate-500">Create a temporary password for {selectedRequest.full_name} only after completing identity verification. It expires after 24 hours.</p></div>
            </div>
            <form className="mt-6 space-y-4" onSubmit={approve}>
              <div><label className="mb-2 block text-xs font-bold text-slate-600">Temporary recovery password</label><input type="password" value={temporaryPassword} onChange={event => setTemporaryPassword(event.target.value)} autoComplete="new-password" minLength={8} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100" required /></div>
              <div><label className="mb-2 block text-xs font-bold text-slate-600">Confirm temporary recovery password</label><input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100" required /></div>
              <div className="flex flex-wrap gap-3"><button type="submit" disabled={isSaving} className="rounded-xl bg-emerald-700 px-4 py-3 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">{isSaving ? 'Issuing recovery access...' : 'Issue temporary recovery password'}</button><button type="button" disabled={isSaving} onClick={() => { setSelectedRequest(null); setTemporaryPassword(''); setConfirmPassword(''); }} className="rounded-xl border border-slate-200 px-4 py-3 text-xs font-bold text-slate-600 transition hover:bg-slate-50">Cancel</button></div>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
