import React, { useState } from 'react';
import { CheckCircle2, KeyRound, LogIn, ShieldCheck, Smartphone, UserPlus } from 'lucide-react';
import type { User } from '../types';
import { sanitizePersonName, sanitizePhoneNumber } from '../lib/inputValidation';

interface LoginModalProps {
  onLoginSuccess: (user: User, token: string) => void;
}

type AuthMode = 'login' | 'activate' | 'reset' | 'bootstrap' | 'totp';
type Audience = 'member' | 'officer';

type TotpEnrollment = { manualKey: string; otpauthUri: string };

async function api(path: string, body: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}

export default function LoginModal({ onLoginSuccess }: LoginModalProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [audience, setAudience] = useState<Audience>('member');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [requestId, setRequestId] = useState('');
  const [code, setCode] = useState('');
  const [totpEnrollment, setTotpEnrollment] = useState<TotpEnrollment | null>(null);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetChallenge = () => {
    setRequestId('');
    setCode('');
    setTotpEnrollment(null);
  };

  const chooseMode = (next: AuthMode) => {
    setMode(next);
    setError('');
    resetChallenge();
  };

  const completeAuthentication = (data: any) => {
    if (data.requiresTotp) {
      setRequestId(data.challengeId);
      setTotpEnrollment(data.enrollment || null);
      setCode('');
      setMode('totp');
      return;
    }
    if (!data.token || !data.user) throw new Error('The server did not create a SACCO session.');
    onLoginSuccess(data.user as User, data.token);
  };

  const handleLogin = async () => {
    const identifier = audience === 'member' ? phone : (email || phone);
    if (!identifier || !password) throw new Error('Enter your sign-in details and password.');
    completeAuthentication(await api('/api/auth/login', { identifier, password }));
  };

  const handleActivation = async () => {
    if (!phone) throw new Error('Enter the mobile number registered with the SACCO.');
    if (!requestId) {
      const data = await api('/api/member-activation/request', { phone });
      setRequestId(data.requestId);
      return;
    }
    if (!/^\d{6}$/.test(code) || password.length < 8) {
      throw new Error('Enter the six-digit SMS code and a new password of at least 8 characters.');
    }
    completeAuthentication(await api('/api/member-activation/verify', { requestId, code, password }));
  };

  const handlePasswordReset = async () => {
    if (!phone) throw new Error('Enter the mobile number registered with the SACCO.');
    if (!requestId) {
      const data = await api('/api/auth/member-password-reset/request', { phone });
      setRequestId(data.requestId);
      return;
    }
    if (!/^\d{6}$/.test(code) || password.length < 8) {
      throw new Error('Enter the six-digit SMS code and a new password of at least 8 characters.');
    }
    await api('/api/auth/member-password-reset/verify', { requestId, code, password });
    setPassword('');
    chooseMode('login');
    setAudience('member');
    setError('Password updated. You can now sign in.');
  };

  const handleBootstrap = async () => {
    if (!fullName || !email || password.length < 8) throw new Error('Full name, email, and a password of at least 8 characters are required.');
    completeAuthentication(await api('/api/auth/bootstrap', { fullName, email, phone, password }));
  };

  const handleTotp = async () => {
    if (!/^\d{6}$/.test(code)) throw new Error('Enter the six-digit code from Google Authenticator.');
    completeAuthentication(await api('/api/auth/totp/verify', { challengeId: requestId, code }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      if (mode === 'login') await handleLogin();
      else if (mode === 'activate') await handleActivation();
      else if (mode === 'reset') await handlePasswordReset();
      else if (mode === 'bootstrap') await handleBootstrap();
      else await handleTotp();
    } catch (caught: any) {
      setError(caught?.message || 'Authentication failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isSmsFlow = mode === 'activate' || mode === 'reset';
  const title = mode === 'totp'
    ? 'Google Authenticator verification'
    : mode === 'activate'
      ? 'Create your member account'
      : mode === 'reset'
        ? 'Reset member password'
        : mode === 'bootstrap'
          ? 'Create the first Chairman account'
          : audience === 'member' ? 'Member sign in' : 'Officer sign in';

  return (
    <div className="auth-shell min-h-screen flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center"><div className="w-14 h-14 bg-emerald-950 flex items-center justify-center rounded-2xl shadow-md border border-emerald-800"><span className="text-xl font-bold font-display text-emerald-400 tracking-wider">M</span></div></div>
        <h2 className="mt-6 text-center text-3xl font-black text-slate-800 font-display tracking-tight">MatatuSacco <span className="text-emerald-600">Pro</span></h2>
        <p className="mt-2 text-center text-xs text-slate-400 uppercase tracking-[2px] font-mono">Secure SACCO access</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="auth-card bg-white py-8 px-6 border border-white/70 rounded-3xl shadow-2xl sm:px-10">
          {mode !== 'totp' && (
            <div className="mb-5 grid grid-cols-3 gap-2 bg-slate-100 border border-slate-200 rounded-2xl p-1">
              <button type="button" onClick={() => chooseMode('login')} className={`py-2 rounded-xl text-xs font-black uppercase tracking-wider ${mode === 'login' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500'}`}>Sign in</button>
              <button type="button" onClick={() => chooseMode('activate')} className={`py-2 rounded-xl text-xs font-black uppercase tracking-wider ${mode === 'activate' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500'}`}>New member</button>
              <button type="button" onClick={() => chooseMode('bootstrap')} className={`py-2 rounded-xl text-xs font-black uppercase tracking-wider ${mode === 'bootstrap' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500'}`}>First admin</button>
            </div>
          )}

          <div className="mb-6 p-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl">
            <div className="flex space-x-2.5 items-start text-xs text-slate-600"><ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /><div><p className="font-bold text-slate-800">{title}</p><p className="mt-1 text-[11px] leading-relaxed">{mode === 'totp' ? 'Open Google Authenticator and enter the current six-digit code.' : isSmsFlow ? 'A one-time SMS code is sent only to the phone already in the SACCO register.' : audience === 'officer' || mode === 'bootstrap' ? 'Chairman, Treasurer, Secretary, Auditor, and Accountant accounts require Google Authenticator after their password.' : 'Members sign in with their registered phone number and password.'}</p></div></div>
          </div>

          {mode === 'login' && (
            <div className="mb-5 grid grid-cols-2 gap-2 bg-slate-100 border border-slate-200 rounded-2xl p-1">
              <button type="button" onClick={() => setAudience('member')} className={`py-2 rounded-xl text-xs font-black uppercase tracking-wider ${audience === 'member' ? 'bg-blue-600 text-white' : 'text-slate-500'}`}>Member</button>
              <button type="button" onClick={() => setAudience('officer')} className={`py-2 rounded-xl text-xs font-black uppercase tracking-wider ${audience === 'officer' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>Officer</button>
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            {mode === 'bootstrap' && <><div><label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Full name</label><input value={fullName} onChange={event => setFullName(sanitizePersonName(event.target.value))} pattern="[A-Za-z .'-]+" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-600" required /></div><div><label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Email</label><input type="email" value={email} onChange={event => setEmail(event.target.value)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-600" required /></div></>}

            {(isSmsFlow || (mode === 'login' && audience === 'member') || mode === 'bootstrap' || (mode === 'login' && audience === 'officer')) && mode !== 'totp' && <div><label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{mode === 'login' && audience === 'officer' ? 'Phone (optional if using email)' : 'Phone'}</label><input type="tel" value={phone} onChange={event => setPhone(sanitizePhoneNumber(event.target.value))} inputMode="tel" pattern="[+]?[0-9]{9,15}" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-600" required={isSmsFlow || (mode === 'login' && audience === 'member')} /></div>}

            {mode === 'login' && audience === 'officer' && <div><label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Email (optional if using phone)</label><input type="email" value={email} onChange={event => setEmail(event.target.value)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-600" /></div>}

            {(mode === 'totp' || (isSmsFlow && requestId)) && <div><label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Six-digit code</label><input value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-600" required /><p className="mt-1 text-[11px] text-slate-500">{mode === 'totp' ? 'Authenticator codes refresh every 30 seconds.' : 'SMS codes expire after 10 minutes and can be used once.'}</p></div>}

            {mode !== 'totp' && (mode === 'login' || mode === 'bootstrap' || (isSmsFlow && requestId)) && <div><label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{isSmsFlow ? 'New password' : 'Password'}</label><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={isSmsFlow ? 'new-password' : 'current-password'} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-600" required /></div>}

            {mode === 'totp' && totpEnrollment && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-slate-700"><p className="font-bold">Set up Google Authenticator first</p><p className="mt-1">Add a new account and enter this setup key:</p><code className="mt-2 block break-all rounded bg-white p-2 text-[10px]">{totpEnrollment.manualKey}</code><p className="mt-2">Setup URI (for a compatible authenticator):</p><code className="mt-1 block break-all rounded bg-white p-2 text-[9px]">{totpEnrollment.otpauthUri}</code></div>}

            {error && <p className={`text-xs font-medium ${error.startsWith('Password updated') ? 'text-emerald-600' : 'text-rose-600'}`}>{error}</p>}
            <button type="submit" disabled={isSubmitting} className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-xs transition-all flex items-center justify-center space-x-2 cursor-pointer">
              {mode === 'bootstrap' ? <UserPlus className="w-4 h-4" /> : mode === 'totp' ? <ShieldCheck className="w-4 h-4" /> : isSmsFlow ? <Smartphone className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}<span>{isSubmitting ? 'Working...' : mode === 'totp' ? 'Verify authenticator' : mode === 'bootstrap' ? 'Create Chairman account' : mode === 'activate' ? requestId ? 'Confirm member account' : 'Send SMS code' : mode === 'reset' ? requestId ? 'Set new password' : 'Send SMS code' : 'Sign in'}</span>
            </button>
          </form>

          {mode === 'login' && audience === 'member' && <div className="mt-5 flex justify-between text-xs"><button type="button" onClick={() => chooseMode('activate')} className="text-blue-700 font-semibold">New phone / new member?</button><button type="button" onClick={() => chooseMode('reset')} className="text-blue-700 font-semibold">Forgot password?</button></div>}
          {mode === 'totp' && <button type="button" onClick={() => chooseMode('login')} className="mt-5 w-full text-xs text-slate-500">Back to sign in</button>}
          <div className="mt-6 border-t border-slate-100 pt-5 text-center text-[9px] text-slate-400 uppercase tracking-widest font-mono"><CheckCircle2 className="inline h-3 w-3 mr-1 text-emerald-600" />Password and MFA access control</div>
        </div>
      </div>
    </div>
  );
}
