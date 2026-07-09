import React, { useState } from 'react';
import { User, UserRole } from '../types';
import { mockUsers } from '../data/mockData';
import { ShieldCheck, LogIn, Sparkles, UserCheck } from 'lucide-react';

interface LoginModalProps {
  onLoginSuccess: (user: User) => void;
}

export default function LoginModal({ onLoginSuccess }: LoginModalProps) {
  const [selectedEmail, setSelectedEmail] = useState(mockUsers[0].email);
  const [password, setPassword] = useState('treasurer@sacco');
  const [error, setError] = useState('');

  // Automatically update pre-populated password on profile change to make user testing seamless
  React.useEffect(() => {
    const user = mockUsers.find(u => u.email === selectedEmail);
    if (user) {
      if (user.role === 'Treasurer') setPassword('treasurer@sacco');
      else if (user.role === 'Secretary') setPassword('secretary@sacco');
      else if (user.role === 'Chairman') setPassword('chairman@sacco');
      else if (user.role === 'Auditor') setPassword('auditor@sacco');
    }
  }, [selectedEmail]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const user = mockUsers.find(u => u.email === selectedEmail);
    if (user) {
      let expectedPass = 'saccopass123';
      if (user.role === 'Treasurer') expectedPass = 'treasurer@sacco';
      else if (user.role === 'Secretary') expectedPass = 'secretary@sacco';
      else if (user.role === 'Chairman') expectedPass = 'chairman@sacco';
      else if (user.role === 'Auditor') expectedPass = 'auditor@sacco';

      if (password === expectedPass) {
        onLoginSuccess(user);
      } else {
        setError(`Incorrect password for ${user.role}. Secure systems require the correct role-specific key.`);
      }
    } else {
      setError('Invalid user selected.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
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
          Financial Management OS &bull; Phase 1
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 border border-slate-200 rounded-3xl shadow-[0_12px_40px_rgba(0,0,0,0.03)] sm:px-10">
          <div className="mb-6 p-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl">
            <div className="flex space-x-2.5 items-start text-xs text-slate-600">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-slate-800">Role-Based Secure Firewalls:</p>
                <p className="mt-1 text-[11px] leading-relaxed">
                  Select a Sacco profile below. For compliance, each role uses a strict key:
                </p>
                <div className="mt-2 text-[10px] font-mono bg-white/60 p-2 rounded-lg space-y-1 border border-emerald-100">
                  <p>&bull; Treasurer: <span className="font-bold text-emerald-700">treasurer@sacco</span></p>
                  <p>&bull; Secretary: <span className="font-bold text-emerald-700">secretary@sacco</span></p>
                  <p>&bull; Chairman: <span className="font-bold text-emerald-700">chairman@sacco</span></p>
                  <p>&bull; Auditor: <span className="font-bold text-emerald-700">auditor@sacco</span></p>
                </div>
              </div>
            </div>
          </div>

          <form className="space-y-5" onSubmit={handleLogin}>
            <div>
              <label htmlFor="user-select" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Choose Sacco Official Profile
              </label>
              <select
                id="user-select"
                value={selectedEmail}
                onChange={(e) => {
                  setSelectedEmail(e.target.value);
                  setError('');
                }}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-600 bg-white shadow-xs"
              >
                {mockUsers.map((user) => (
                  <option key={user.id} value={user.email}>
                    {user.name} ({user.role})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Security Password
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

            <div>
              <button
                type="submit"
                id="login-submit-button"
                className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-xs transition-all flex items-center justify-center space-x-2 cursor-pointer"
              >
                <LogIn className="w-4 h-4" />
                <span>Log In Securely</span>
              </button>
            </div>
          </form>

          <div className="mt-6 border-t border-slate-100 pt-6">
            <div className="text-center">
              <span className="text-[9px] text-slate-400 uppercase tracking-widest font-mono">
                CBK Sacco Compliance &bull; JWT Auth
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
