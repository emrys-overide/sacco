import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, HelpCircle, LogIn, ShieldCheck, UserPlus } from 'lucide-react';
import type { User } from '../types';
import { sanitizePersonName, sanitizePhoneNumber } from '../lib/inputValidation';

interface LoginModalProps {
  onLoginSuccess: (user: User, token: string) => void;
}

type AuthScreen = 'welcome' | 'help' | 'login' | 'register' | 'reset' | 'force-change' | 'bootstrap' | 'totp';
type TotpEnrollment = { manualKey: string; otpauthUri: string };

const inputClass = 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100';
const isStaticHostingPreview = import.meta.env.VITE_STATIC_HOSTING_PREVIEW === 'true';

async function api(path: string, body: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    if (isStaticHostingPreview) {
      throw new Error('This no-cost preview hosts the interface only. Sign-in and account actions need the secure backend deployment.');
    }
    throw new Error(data.error || 'The request could not be completed.');
  }
  return data;
}

export default function LoginModal({ onLoginSuccess }: LoginModalProps) {
  const [screen, setScreen] = useState<AuthScreen>('welcome');
  const [needsFirstAdmin, setNeedsFirstAdmin] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [totpEnrollment, setTotpEnrollment] = useState<TotpEnrollment | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resetRequestId, setResetRequestId] = useState('');
  const [temporaryToken, setTemporaryToken] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/onboarding-status')
      .then(async response => response.ok ? response.json() : { needsFirstAdmin: false })
      .then(data => { if (!cancelled) setNeedsFirstAdmin(data.needsFirstAdmin === true); })
      .catch(() => { if (!cancelled) setNeedsFirstAdmin(false); });
    return () => { cancelled = true; };
  }, []);

  const chooseScreen = (next: AuthScreen) => {
    setScreen(next);
    setError('');
    setNotice('');
    setChallengeId('');
    setCode('');
    setTotpEnrollment(null);
  };

  const completeAuthentication = (data: any) => {
    if (data.requiresTotp) {
      setChallengeId(data.challengeId);
      setTotpEnrollment(data.enrollment || null);
      setScreen('totp');
      return;
    }
    if (data.passwordChangeRequired) {
      setTemporaryToken(data.token || '');
      setPassword('');
      setScreen('force-change');
      return;
    }
    if (!data.token || !data.user) throw new Error('The server did not create a SACCO session.');
    onLoginSuccess(data.user as User, data.token);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setIsSubmitting(true);
    try {
      if (screen === 'login') {
        if (!identifier || !password) throw new Error('Enter your phone or email and password.');
        completeAuthentication(await api('/api/auth/login', { identifier, password }));
      } else if (screen === 'register') {
        if (!fullName || !phone || !email || password.length < 8) {
          throw new Error('Enter your registered name, phone, email, and a password of at least 8 characters.');
        }
        await api('/api/auth/member-registration', { fullName, phone, email, password });
        setIdentifier(email);
        setPassword('');
        setScreen('login');
        setNotice('Account created. You can now sign in with your email or phone number.');
      } else if (screen === 'bootstrap') {
        if (!fullName || !email || password.length < 8) throw new Error('Enter a name, email, and password of at least 8 characters.');
        completeAuthentication(await api('/api/auth/bootstrap', { fullName, email, phone, password }));
      } else if (screen === 'totp') {
        if (!/^\d{6}$/.test(code)) throw new Error('Enter the six-digit code from your authenticator app.');
        completeAuthentication(await api('/api/auth/totp/verify', { challengeId, code }));
      } else if (screen === 'reset') {
        if (!resetRequestId) {
          if (!email) throw new Error('Enter the email saved on your SACCO member record.');
          const result = await api('/api/auth/member-password-reset/request', { email });
          setResetRequestId(result.requestId);
          setNotice(result.message);
        } else {
          if (!/^\d{6}$/.test(code) || password.length < 8) throw new Error('Enter the six-digit email code and a new password of at least 8 characters.');
          await api('/api/auth/member-password-reset/verify', { requestId: resetRequestId, code, password });
          setIdentifier(email); setPassword(''); setCode(''); setResetRequestId(''); setScreen('login');
          setNotice('Password updated. You can now sign in.');
        }
      } else if (screen === 'force-change') {
        if (password.length < 8) throw new Error('Choose a private password of at least 8 characters.');
        const response = await fetch('/api/auth/change-temporary-password', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${temporaryToken}` }, body: JSON.stringify({ password }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'The password could not be changed.');
        completeAuthentication({ ...data, token: data.token, user: data.user });
      }
    } catch (caught: any) {
      setError(caught?.message || 'Authentication failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const title = screen === 'login' ? 'Welcome back'
    : screen === 'register' ? 'Create your account'
      : screen === 'bootstrap' ? 'Set up your SACCO'
        : screen === 'totp' ? 'Confirm your secure code'
          : screen === 'reset' ? 'Reset your password'
            : screen === 'force-change' ? 'Create a private password'
            : 'Getting started';
  const subtitle = screen === 'login' ? 'Sign in to access your SACCO account.'
    : screen === 'register' ? 'Use the same details already saved on your active member record.'
      : screen === 'bootstrap' ? 'This private setup is available only while no Chairman exists.'
        : screen === 'totp' ? 'This extra step is enabled by your SACCO administrator.'
          : screen === 'reset' ? 'We will send a free recovery code to your registered email.'
            : screen === 'force-change' ? 'Replace the temporary password before continuing.'
            : 'Choose the option that matches your account.';

  return (
    <div className="auth-shell min-h-screen px-4 py-10 font-sans sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-md flex-col justify-center">
        <div className="mb-7 flex items-center justify-center gap-3 text-white">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-300/30 bg-emerald-400/15 shadow-lg"><span className="font-display text-lg font-bold text-emerald-300">M</span></div>
          <div><p className="font-display text-xl font-bold tracking-tight">MatatuSacco</p><p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-200/80">Member access</p></div>
        </div>

        <main className="auth-card rounded-[2rem] px-6 py-7 sm:px-9 sm:py-9">
          {screen === 'welcome' ? (
            <section className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700"><ShieldCheck className="h-7 w-7" /></div>
              <h1 className="mt-6 font-display text-3xl font-bold tracking-tight text-slate-900">Welcome to your SACCO</h1>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500">One account for members and officers, protected by your password and server-side access rules.</p>
              {isStaticHostingPreview && <p className="mx-auto mt-4 max-w-sm rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">Static Hosting preview: you can review the interface and navigation, but secure sign-in, data, and payments are unavailable until the backend is deployed.</p>}
              <div className="mt-8 space-y-3">
                <button type="button" onClick={() => chooseScreen('login')} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-900/15"><LogIn className="h-4 w-4" />Log in</button>
                <button type="button" onClick={() => chooseScreen('register')} className="w-full rounded-2xl border border-emerald-200 bg-white px-4 py-3.5 text-sm font-bold text-emerald-700">Create member account</button>
              </div>
              <button type="button" onClick={() => chooseScreen('help')} className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500"><HelpCircle className="h-3.5 w-3.5" />First-time help</button>
              {needsFirstAdmin && <button type="button" onClick={() => chooseScreen('bootstrap')} className="mt-6 block w-full text-xs font-semibold text-slate-500 underline decoration-slate-300 underline-offset-4">Set up the first Chairman</button>}
            </section>
          ) : (
            <section>
              <button type="button" onClick={() => chooseScreen(screen === 'totp' ? 'login' : 'welcome')} className="mb-6 inline-flex items-center gap-1.5 text-xs font-bold text-slate-500"><ArrowLeft className="h-3.5 w-3.5" />Back</button>
              <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
              <p className="mt-2 text-sm leading-6 text-slate-500">{subtitle}</p>

              {screen === 'help' && (
                <div className="mt-7 space-y-4 text-sm leading-6 text-slate-600">
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4"><p className="font-bold text-slate-800">New member</p><p>Your name, phone, and email must match one active member record. Then choose your password and sign in.</p></div>
                  <div className="rounded-2xl border border-slate-200 p-4"><p className="font-bold text-slate-800">Officer</p><p>The Chairman creates your account. Use the work email or phone and password they give you on the same login screen.</p></div>
                </div>
              )}

              {screen === 'reset' && (
                <form className="mt-7 space-y-4" onSubmit={handleSubmit}>
                  {!resetRequestId && <div><label className="mb-2 block text-xs font-bold text-slate-600">Registered email</label><input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" className={inputClass} required /></div>}
                  {resetRequestId && <><div><label className="mb-2 block text-xs font-bold text-slate-600">Six-digit email code</label><input value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" className={inputClass} required /></div><div><label className="mb-2 block text-xs font-bold text-slate-600">New password</label><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" className={inputClass} required /></div></>}
                  {error && <p className="rounded-xl bg-rose-50 px-3 py-2.5 text-xs text-rose-700">{error}</p>}{notice && <p className="rounded-xl bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700">{notice}</p>}
                  <button type="submit" disabled={isSubmitting} className="w-full rounded-2xl bg-emerald-600 px-4 py-3.5 text-sm font-bold text-white">{resetRequestId ? 'Verify code and reset password' : 'Email recovery code'}</button>
                </form>
              )}

              {screen === 'force-change' && <form className="mt-7 space-y-4" onSubmit={handleSubmit}><div><label className="mb-2 block text-xs font-bold text-slate-600">New private password</label><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" className={inputClass} required /></div>{error && <p className="rounded-xl bg-rose-50 px-3 py-2.5 text-xs text-rose-700">{error}</p>}<button type="submit" disabled={isSubmitting} className="w-full rounded-2xl bg-emerald-600 px-4 py-3.5 text-sm font-bold text-white">Change password and continue</button></form>}

              {!['help', 'reset', 'force-change'].includes(screen) && (
                <form className="mt-7 space-y-4" onSubmit={handleSubmit}>
                  {(screen === 'register' || screen === 'bootstrap') && <div><label className="mb-2 block text-xs font-bold text-slate-600">Full name</label><input value={fullName} onChange={event => setFullName(sanitizePersonName(event.target.value))} autoComplete="name" className={inputClass} required /></div>}
                  {screen === 'login' && <div><label className="mb-2 block text-xs font-bold text-slate-600">Phone or email</label><input value={identifier} onChange={event => setIdentifier(event.target.value)} autoComplete="username" className={inputClass} required /></div>}
                  {screen === 'register' && <div><label className="mb-2 block text-xs font-bold text-slate-600">Registered phone</label><input type="tel" value={phone} onChange={event => setPhone(sanitizePhoneNumber(event.target.value))} autoComplete="tel" inputMode="tel" pattern="[+]?[0-9]{9,15}" className={inputClass} required /></div>}
                  {(screen === 'register' || screen === 'bootstrap') && <div><label className="mb-2 block text-xs font-bold text-slate-600">Email address</label><input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" className={inputClass} required /></div>}
                  {screen === 'bootstrap' && <div><label className="mb-2 block text-xs font-bold text-slate-600">Phone <span className="font-medium text-slate-400">(optional)</span></label><input type="tel" value={phone} onChange={event => setPhone(sanitizePhoneNumber(event.target.value))} pattern="[+]?[0-9]{9,15}" className={inputClass} /></div>}
                  {(screen === 'login' || screen === 'register' || screen === 'bootstrap') && <div><label className="mb-2 block text-xs font-bold text-slate-600">Password</label><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={screen === 'login' ? 'current-password' : 'new-password'} className={inputClass} required /></div>}
                  {screen === 'totp' && <div>{totpEnrollment && <div className="mb-4 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-xs text-slate-600"><p className="font-bold text-slate-800">Optional authenticator setup</p><code className="mt-3 block break-all rounded-xl bg-white px-3 py-2 text-[11px]">{totpEnrollment.manualKey}</code></div>}<label className="mb-2 block text-xs font-bold text-slate-600">Six-digit code</label><input value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" pattern="[0-9]{6}" className={inputClass} required /></div>}
                  {error && <p className="rounded-xl bg-rose-50 px-3 py-2.5 text-xs font-medium leading-5 text-rose-700">{error}</p>}
                  {notice && <p className="rounded-xl bg-emerald-50 px-3 py-2.5 text-xs font-medium leading-5 text-emerald-700">{notice}</p>}
                  <button type="submit" disabled={isSubmitting} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-900/15 disabled:opacity-60">{screen === 'register' || screen === 'bootstrap' ? <UserPlus className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}{isSubmitting ? 'Please wait...' : screen === 'register' ? 'Create account' : screen === 'bootstrap' ? 'Create Chairman account' : screen === 'totp' ? 'Confirm code' : 'Sign in'}</button>
                </form>
              )}

              {screen === 'login' && <div className="mt-5 flex items-center justify-between text-xs"><button type="button" onClick={() => chooseScreen('reset')} className="font-semibold text-slate-500">Forgot password?</button><button type="button" onClick={() => chooseScreen('register')} className="font-semibold text-emerald-700">Create account</button></div>}
              {screen === 'register' && <p className="mt-5 text-center text-xs text-slate-500">Already have an account? <button type="button" onClick={() => chooseScreen('login')} className="font-bold text-emerald-700">Log in</button></p>}
            </section>
          )}

          <div className="mt-7 border-t border-slate-100 pt-5 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />Protected with secure account verification</div>
        </main>
      </div>
    </div>
  );
}
