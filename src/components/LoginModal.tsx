import React, { useState } from 'react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { User } from '../types';
import { firebaseAuth } from '../lib/firebase';
import { CheckCircle2, LogIn, ShieldCheck, UserPlus } from 'lucide-react';

interface LoginModalProps {
  onLoginSuccess: (user: User, token: string) => void;
}

type AuthMode = 'signin' | 'bootstrap';

function getAuthenticationErrorMessage(error: any): string {
  if (error?.code === 'auth/operation-not-allowed') {
    return 'Email/password authentication is disabled for this Firebase project. Enable the Email/Password provider in Firebase Authentication, then try again.';
  }
  if (error?.code === 'auth/weak-password') {
    return 'Use a password with at least 6 characters.';
  }
  if (error?.code === 'auth/wrong-password' || error?.code === 'auth/invalid-credential') {
    return 'The email or password is incorrect.';
  }
  return error?.message || 'Authentication failed.';
}

export default function LoginModal({ onLoginSuccess }: LoginModalProps) {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const completeDevLogin = async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Development login failed.');
    }

    onLoginSuccess(data.user, data.token);
  };

  const handleSignIn = async () => {
    if (!email.trim() || !password) {
      throw new Error('Email and password are required.');
    }

    if (!firebaseAuth) {
      await completeDevLogin();
      return;
    }

    const credential = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
    const idToken = await credential.user.getIdToken();
    const response = await fetch('/api/auth/session', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`
      }
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Could not open SACCO session.');
    }

    onLoginSuccess(data.user, idToken);
  };

  const handleBootstrap = async () => {
    if (!fullName.trim() || !email.trim() || !password) {
      throw new Error('Full name, email, and password are required for first-admin setup.');
    }

    let idToken = '';
    if (firebaseAuth) {
      let credential;
      try {
        credential = await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
      } catch (error: any) {
        // The Firebase identity may have been created by an earlier bootstrap
        // attempt before the SACCO profile request failed. Resume that attempt
        // by proving ownership with the same email and password.
        if (error?.code !== 'auth/email-already-in-use') {
          throw error;
        }
        credential = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      }

      if (credential.user.displayName !== fullName.trim()) {
        await updateProfile(credential.user, { displayName: fullName.trim() });
      }
      idToken = await credential.user.getIdToken();
    }

    const response = await fetch('/api/auth/bootstrap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
      },
      body: JSON.stringify({
        fullName: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        password
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'First-admin setup failed.');
    }

    onLoginSuccess(data.user, idToken || data.token);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      if (mode === 'bootstrap') {
        await handleBootstrap();
      } else {
        await handleSignIn();
      }
    } catch (err: any) {
      setError(getAuthenticationErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-shell min-h-screen flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="w-14 h-14 bg-emerald-950 flex items-center justify-center rounded-2xl shadow-md border border-emerald-800">
            <span className="text-xl font-bold font-display text-emerald-400 tracking-wider">M</span>
          </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-black text-slate-800 font-display tracking-tight">
          MatatuSacco <span className="text-emerald-600">Pro</span>
        </h2>
        <p className="mt-2 text-center text-xs text-slate-400 uppercase tracking-[2px] font-mono">
          Clean SACCO setup
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="auth-card bg-white py-8 px-6 border border-white/70 rounded-3xl shadow-2xl sm:px-10">
          <div className="mb-5 grid grid-cols-2 gap-2 bg-slate-100 border border-slate-200 rounded-2xl p-1">
            <button
              type="button"
              onClick={() => setMode('signin')}
              className={`py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                mode === 'signin' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setMode('bootstrap')}
              className={`py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                mode === 'bootstrap' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              First Admin
            </button>
          </div>

          <div className="mb-6 p-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl">
            <div className="flex space-x-2.5 items-start text-xs text-slate-600">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-slate-800">
                  {mode === 'bootstrap' ? 'Create your first SACCO admin' : 'Secure SACCO sign in'}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed">
                  {mode === 'bootstrap'
                    ? 'Use this once on a fresh install. The account becomes Chairman and can add members, vehicles, and other officials.'
                    : 'Firebase verifies identity. The SACCO users table controls role, status, and audit traceability.'}
                </p>
                <div className="mt-2 text-[10px] font-mono bg-white/60 p-2 rounded-lg space-y-1 border border-emerald-100">
                  <p className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-emerald-600" /> Identity: Firebase Auth</p>
                  <p className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-emerald-600" /> Role: PostgreSQL users table</p>
                  <p className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-emerald-600" /> Audit: API authorization logs</p>
                </div>
              </div>
            </div>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            {mode === 'bootstrap' && (
              <>
                <div>
                  <label htmlFor="full-name" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Full Name
                  </label>
                  <input
                    id="full-name"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-600 shadow-xs"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="phone" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Phone
                  </label>
                  <input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-600 shadow-xs"
                  />
                </div>
              </>
            )}

            <div>
              <label htmlFor="email" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-600 shadow-xs"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-600 shadow-xs"
                required
              />
            </div>

            {error && (
              <p className="text-xs text-rose-600 font-medium" id="login-error-message">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              id="login-submit-button"
              className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-xs transition-all flex items-center justify-center space-x-2 cursor-pointer"
            >
              {mode === 'bootstrap' ? <UserPlus className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
              <span>{isSubmitting ? 'Working...' : mode === 'bootstrap' ? 'Create First Admin' : 'Sign In'}</span>
            </button>
          </form>

          <div className="mt-6 border-t border-slate-100 pt-6">
            <div className="text-center">
              <span className="text-[9px] text-slate-400 uppercase tracking-widest font-mono">
                New installs start empty
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
