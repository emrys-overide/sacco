import React, { useEffect, useState } from 'react';
import { CheckCircle2, ShieldCheck, Trash2, UserPlus, UsersRound } from 'lucide-react';
import type { User, UserRole } from '../types';
import { fetchSaccoJson, postSaccoJson } from '../lib/api';
import { sanitizePersonName, sanitizePhoneNumber } from '../lib/inputValidation';

type OfficerRole = Exclude<UserRole, 'Chairman' | 'Member'>;
type OfficerCreation = { fullName: string; email: string; phone: string; role: OfficerRole; password: string };
type OfficerCreationResponse = { user: User; requiresTotpEnrollment: boolean };
type PasswordResetRequest = { id: string; user_id: string; full_name: string; email?: string; phone?: string; member_number?: string; created_at: string };

const officerRoles: Array<{ value: OfficerRole; label: string }> = [
  { value: 'Secretary', label: 'Secretary' },
  { value: 'Treasurer', label: 'Treasurer' },
  { value: 'Accountant', label: 'Accountant' },
  { value: 'Auditor', label: 'Auditor' }
];
const deletableOfficerRoles: readonly UserRole[] = ['Secretary', 'Treasurer', 'Accountant', 'Auditor'];

const inputClass = 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100';

export default function OfficerAccountsView({ fallbackAuthToken }: { fallbackAuthToken: string }) {
  const [officers, setOfficers] = useState<User[]>([]);
  const [passwordResetRequests, setPasswordResetRequests] = useState<PasswordResetRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingOfficerId, setDeletingOfficerId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<OfficerCreation>({
    fullName: '',
    email: '',
    phone: '',
    role: 'Secretary',
    password: ''
  });

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchSaccoJson<User[]>('/api/users', {}, fallbackAuthToken),
      fetchSaccoJson<PasswordResetRequest[]>('/api/password-reset-requests', {}, fallbackAuthToken)
    ])
      .then(([users, resetRequests]) => {
        if (active) {
          setOfficers(users);
          setPasswordResetRequests(resetRequests);
        }
      })
      .catch(caught => {
        if (active) setError(caught instanceof Error ? caught.message : 'Account access could not be loaded.');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, [fallbackAuthToken]);

  const update = <Key extends keyof OfficerCreation>(key: Key, value: OfficerCreation[Key]) => {
    setForm(current => ({ ...current, [key]: value }));
  };

  const createOfficer = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!form.fullName || !form.email || form.password.length < 8) {
      setError('Enter the officer’s full name, email, and a password of at least 8 characters.');
      return;
    }

    setIsSaving(true);
    try {
      const result = await postSaccoJson<OfficerCreationResponse, OfficerCreation>('/api/users', form, fallbackAuthToken);
      setOfficers(current => [...current, result.user].sort((left, right) => left.name.localeCompare(right.name)));
      setForm({ fullName: '', email: '', phone: '', role: 'Secretary', password: '' });
      setNotice(`${result.user.name} can now sign in with their work email or phone and password.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Officer account could not be created.');
    } finally {
      setIsSaving(false);
    }
  };

  const resetPassword = async (officer: Pick<User, 'id' | 'name'>, requestId?: string) => {
    const password = window.prompt(`Set a new temporary password for ${officer.name} (at least 8 characters). Share it with them privately:`);
    if (password === null) return;
    if (password.length < 8) { setError('The temporary password must contain at least 8 characters.'); return; }
    setError(''); setNotice(''); setIsSaving(true);
    try {
      await postSaccoJson(`/api/users/${officer.id}/password`, { password, ...(requestId ? { resetRequestId: requestId } : {}) }, fallbackAuthToken);
      if (requestId) setPasswordResetRequests(current => current.filter(request => request.id !== requestId));
      setNotice(`${officer.name}'s temporary password is ready. Share it privately; they must replace it immediately after sign-in.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The password could not be reset.');
    } finally { setIsSaving(false); }
  };

  const deleteOfficer = async (officer: Pick<User, 'id' | 'name' | 'role'>) => {
    const confirmed = window.confirm(
      `Delete ${officer.name}'s ${officer.role} account?\n\nThey will immediately lose access and will no longer be able to sign in. This action cannot be undone.`
    );
    if (!confirmed) return;
    setError('');
    setNotice('');
    setDeletingOfficerId(officer.id);
    try {
      await fetchSaccoJson<{ deleted: true; userId: string; role: UserRole }>(
        `/api/users/${officer.id}`,
        { method: 'DELETE' },
        fallbackAuthToken
      );
      setOfficers(current => current.filter(item => item.id !== officer.id));
      setNotice(`${officer.name}'s ${officer.role} account has been deleted and can no longer sign in.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The officer account could not be deleted.');
    } finally {
      setDeletingOfficerId('');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-8">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700"><UserPlus className="h-6 w-6" /></div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Chairman controls</p>
              <h2 className="mt-1 font-display text-2xl font-bold text-slate-900">Create an officer account</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">Give a trusted officer the right role and a temporary password they can use on the normal login screen.</p>
            </div>
          </div>

          <form className="mt-8 space-y-4" onSubmit={createOfficer}>
            <div>
              <label className="mb-2 block text-xs font-bold text-slate-600">Full name</label>
              <input value={form.fullName} onChange={event => update('fullName', sanitizePersonName(event.target.value))} autoComplete="name" className={inputClass} required />
            </div>
            <div>
              <label className="mb-2 block text-xs font-bold text-slate-600">Work email</label>
              <input type="email" value={form.email} onChange={event => update('email', event.target.value)} autoComplete="email" className={inputClass} required />
            </div>
            <div>
              <label className="mb-2 block text-xs font-bold text-slate-600">Phone number <span className="font-medium text-slate-400">(optional)</span></label>
              <input type="tel" value={form.phone} onChange={event => update('phone', sanitizePhoneNumber(event.target.value))} inputMode="tel" autoComplete="tel" pattern="[+]?[0-9]{9,15}" className={inputClass} />
            </div>
            <div>
              <label className="mb-2 block text-xs font-bold text-slate-600">Role</label>
              <select value={form.role} onChange={event => update('role', event.target.value as OfficerRole)} className={inputClass}>
                {officerRoles.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-xs font-bold text-slate-600">Temporary password</label>
              <input type="password" value={form.password} onChange={event => update('password', event.target.value)} autoComplete="new-password" className={inputClass} required />
            </div>

            {error && <p className="rounded-xl bg-rose-50 px-3 py-2.5 text-xs font-medium leading-5 text-rose-700">{error}</p>}
            {notice && <p className="rounded-xl bg-emerald-50 px-3 py-2.5 text-xs font-medium leading-5 text-emerald-700">{notice}</p>}

            <button type="submit" disabled={isSaving} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-900/15 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
              <UserPlus className="h-4 w-4" />
              {isSaving ? 'Creating account...' : 'Create officer account'}
            </button>
          </form>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-600"><UsersRound className="h-5 w-5" /></div>
            <div>
              <h2 className="font-display text-xl font-bold text-slate-900">Account access</h2>
              <p className="text-xs text-slate-500">Active officer and member profiles</p>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-amber-950">Member reset requests</h3><p className="mt-1 text-xs leading-5 text-amber-900">Approve only after confirming the member’s identity through your normal SACCO process.</p></div><span className="rounded-full bg-amber-200 px-2 py-1 text-[10px] font-black text-amber-950">{passwordResetRequests.length} pending</span></div>
              <div className="mt-3 space-y-2">{passwordResetRequests.map(request => <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-100 bg-white p-3"><div><p className="text-sm font-bold text-slate-800">{request.full_name}</p><p className="text-xs text-slate-500">{request.member_number ? `Member ${request.member_number} · ` : ''}{request.email || request.phone || 'Registered member'}</p><p className="mt-1 text-[10px] text-slate-400">Requested {new Date(request.created_at).toLocaleString('en-KE')}</p></div><button type="button" disabled={isSaving} onClick={() => void resetPassword({ id: request.user_id, name: request.full_name }, request.id)} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-60">Confirm & set temporary password</button></div>)}{!passwordResetRequests.length && <p className="py-2 text-xs text-amber-900">No member password reset requests are waiting.</p>}</div>
            </div>
            {isLoading ? <p className="text-sm text-slate-500">Loading officer accounts...</p> : officers.map(officer => (
              <div key={officer.id} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-800">{officer.name}</p>
                  <p className="truncate text-xs text-slate-500">{officer.email}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700">{officer.role}</span>
                  <div className="flex items-center gap-3">
                    <button type="button" disabled={isSaving || Boolean(deletingOfficerId)} onClick={() => void resetPassword(officer)} className="text-[10px] font-bold text-slate-500 hover:text-emerald-700 disabled:opacity-50">Reset password</button>
                    {deletableOfficerRoles.includes(officer.role) && (
                      <button
                        type="button"
                        disabled={isSaving || Boolean(deletingOfficerId)}
                        onClick={() => void deleteOfficer(officer)}
                        className="flex items-center gap-1 text-[10px] font-black text-rose-600 hover:text-rose-800 disabled:opacity-50"
                        aria-label={`Delete ${officer.name}'s ${officer.role} account`}
                      >
                        <Trash2 className="h-3 w-3" />
                        {deletingOfficerId === officer.id ? 'Deleting...' : 'Delete account'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {!isLoading && officers.length === 0 && <p className="text-sm text-slate-500">No officer accounts are active yet.</p>}
          </div>

          <div className="mt-7 flex gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-xs leading-5 text-slate-600">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <p>Each officer’s access is limited by server-side role permissions. An optional authenticator step can be enabled for the whole SACCO later.</p>
          </div>
          <p className="mt-4 text-[11px] text-slate-400"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />The Chairman account cannot be duplicated here.</p>
        </section>
      </div>
    </div>
  );
}
