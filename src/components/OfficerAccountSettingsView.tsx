import { useState, type FormEvent } from 'react';
import { KeyRound, ShieldCheck, UserRound } from 'lucide-react';
import type { User } from '../types';
import { postSaccoJson } from '../lib/api';

interface OfficerAccountSettingsViewProps {
  currentUser: User;
  token: string;
}

export default function OfficerAccountSettingsView({ currentUser, token }: OfficerAccountSettingsViewProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (newPassword !== confirmPassword) {
      setError('The new password and confirmation do not match.');
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      setError('Choose a password containing 8 to 128 characters.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('The new password must be different from your current password.');
      return;
    }

    setIsSaving(true);
    try {
      await postSaccoJson<{ passwordUpdated: boolean }, { currentPassword: string; newPassword: string }>(
        '/api/auth/change-password',
        { currentPassword, newPassword },
        token
      );
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice('Your password has been changed. Use the new password the next time you sign in.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Your password could not be changed.');
    } finally {
      setIsSaving(false);
    }
  };

  const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100';

  return (
    <main className="flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="rounded-3xl bg-gradient-to-br from-slate-950 to-emerald-900 p-6 text-white sm:p-8">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">
            <ShieldCheck className="h-4 w-4" />
            Private officer security
          </p>
          <h1 className="mt-3 text-3xl font-black">Account settings</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-emerald-50">
            Change your own password without giving it to the Chairman or another officer.
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-5">
          <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="flex items-center gap-2">
              <UserRound className="h-5 w-5 text-emerald-700" />
              <h2 className="font-black text-slate-900">Officer profile</h2>
            </div>
            <dl className="mt-5 space-y-4 text-sm">
              <div><dt className="text-xs font-bold uppercase tracking-wider text-slate-400">Name</dt><dd className="mt-1 font-bold text-slate-800">{currentUser.name}</dd></div>
              <div><dt className="text-xs font-bold uppercase tracking-wider text-slate-400">Role</dt><dd className="mt-1 font-bold text-emerald-700">{currentUser.role}</dd></div>
              <div><dt className="text-xs font-bold uppercase tracking-wider text-slate-400">Email</dt><dd className="mt-1 break-words text-slate-700">{currentUser.email || 'Not recorded'}</dd></div>
              <div><dt className="text-xs font-bold uppercase tracking-wider text-slate-400">Phone</dt><dd className="mt-1 text-slate-700">{currentUser.phone || 'Not recorded'}</dd></div>
            </dl>
          </aside>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 lg:col-span-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-emerald-700" />
              <h2 className="font-black text-slate-900">Change password</h2>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">Your current password is required. The change affects only your own account and is recorded in the security audit log.</p>

            <form className="mt-5 space-y-4" onSubmit={changePassword}>
              <label className="block text-xs font-bold text-slate-600">
                Current password
                <input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" className={inputClass} required />
              </label>
              <label className="block text-xs font-bold text-slate-600">
                New password
                <input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} className={inputClass} required />
              </label>
              <label className="block text-xs font-bold text-slate-600">
                Confirm new password
                <input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} className={inputClass} required />
              </label>
              {error && <p className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-700">{error}</p>}
              {notice && <p className="rounded-xl bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800">{notice}</p>}
              <button type="submit" disabled={isSaving} className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">
                {isSaving ? 'Changing password...' : 'Change my password'}
              </button>
            </form>
          </section>
        </section>
      </div>
    </main>
  );
}
