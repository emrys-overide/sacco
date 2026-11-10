import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, LockKeyhole } from 'lucide-react';
import { fetchSaccoJson, postSaccoJson } from '../lib/api';

type Closing = {
  id: string; closing_month: string; total_credit: number; total_debit: number; net_balance: number;
  closed_at: string; closed_by_name?: string; notes?: string;
};

const formatKes = (amount: number) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 2 }).format(Number(amount || 0));

function previousMonth() {
  const date = new Date();
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export default function MonthEndCloseView({ token }: { token: string }) {
  const [closings, setClosings] = useState<Closing[]>([]);
  const [closingMonth, setClosingMonth] = useState(previousMonth());
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const load = async () => setClosings(await fetchSaccoJson<Closing[]>('/api/monthly-closings', {}, token));
  useEffect(() => { void load().catch(caught => setError(caught.message)); }, [token]);
  const selectedMonth = useMemo(() => new Intl.DateTimeFormat('en-KE', { month: 'long', year: 'numeric' }).format(new Date(`${closingMonth}-01T00:00:00`)), [closingMonth]);
  const closeMonth = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setMessage('');
    if (!confirmed) { setError('Confirm that the ledger, payments, and bank reconciliation for this month are complete.'); return; }
    try {
      await postSaccoJson('/api/monthly-closings', { closingMonth, notes }, token);
      setNotes(''); setConfirmed(false); setMessage(`${selectedMonth} is closed. Ordinary ledger changes dated in that month are now blocked.`); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Month could not be closed.'); }
  };
  return <main className="flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-8"><div className="mx-auto max-w-5xl space-y-6"><header><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Financial control</p><h1 className="mt-1 text-2xl font-black text-slate-900">Month-end closing</h1><p className="mt-2 text-sm text-slate-500">A closed month stores its ledger totals and prevents ordinary entries, corrections, and reversals in that period.</p></header><form onSubmit={closeMonth} className="rounded-2xl border border-amber-200 bg-white p-5"><div className="flex gap-3"><AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" /><div><h2 className="font-black text-slate-900">Close a completed month</h2><p className="mt-1 text-sm leading-6 text-slate-600">Reconcile bank events and payment records first. This creates an internal accounting snapshot; it is not an external audit certificate or regulatory filing.</p></div></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600">Completed month<input type="month" max={previousMonth()} value={closingMonth} onChange={event => setClosingMonth(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm" required /></label><label className="text-xs font-bold text-slate-600">Closing notes <span className="font-medium text-slate-400">(optional)</span><input value={notes} onChange={event => setNotes(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm" placeholder="Reconciliation reference or approval note" /></label></div><label className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-0.5" />I confirm that {selectedMonth} is complete and reconciled. I understand normal ledger changes for this month will be blocked.</label><button className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white"><CalendarClock className="h-4 w-4" /> Close {selectedMonth}</button>{(error || message) && <p className={`mt-4 rounded-xl p-3 text-sm ${error ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{error || message}</p>}</form><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><LockKeyhole className="h-4 w-4 text-emerald-700" /><h2 className="font-black text-slate-900">Closed months</h2></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500"><tr><th className="pb-3">Month</th><th className="pb-3 text-right">Credits</th><th className="pb-3 text-right">Debits</th><th className="pb-3 text-right">Net</th><th className="pb-3">Closed by</th></tr></thead><tbody className="divide-y divide-slate-100">{closings.map(closing => <tr key={closing.id}><td className="py-3 font-bold">{String(closing.closing_month).slice(0, 10)}</td><td className="py-3 text-right text-emerald-700">{formatKes(closing.total_credit)}</td><td className="py-3 text-right text-rose-700">{formatKes(closing.total_debit)}</td><td className="py-3 text-right font-bold">{formatKes(closing.net_balance)}</td><td className="py-3 text-slate-600">{closing.closed_by_name || 'SACCO record'}</td></tr>)}{!closings.length && <tr><td colSpan={5} className="py-8 text-center text-slate-500">No accounting month has been closed yet.</td></tr>}</tbody></table></div></section></div></main>;
}
