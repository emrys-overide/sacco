import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Building2, CheckCircle2, Database, Eye, RefreshCw, ShieldCheck } from 'lucide-react';
import type { CoopBankEvent, Member, TransactionCategory } from '../types';
import { fetchSaccoJson, postSaccoJson } from '../lib/api';

interface CoopBankViewProps { fallbackAuthToken: string; }
type Counts = { total: number; receivedToday: number; unmatched: number; ambiguous: number; pendingAllocation: number; posted: number; failed: number; quarantined: number; duplicates: number; lastSuccessfulCallbackAt: string | null };
type CoopBankConfig = {
  provider: string; enabled: boolean; webhookPath: string; webhookUrl: string; authMode: 'Token' | 'Basic';
  authenticationConfigured: boolean; configuredAccountCount: number; observeOnly: boolean; autoPostingEnabled: boolean; counts: Counts;
};

const categories: TransactionCategory[] = ['Daily Contribution', 'Savings Contribution', 'Registration Fee', 'Management Fee', 'Penalty'];
const inputClass = 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

export default function CoopBankView({ fallbackAuthToken }: CoopBankViewProps) {
  const [config, setConfig] = useState<CoopBankConfig | null>(null);
  const [events, setEvents] = useState<CoopBankEvent[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [status, setStatus] = useState('');
  const [eventType, setEventType] = useState('');
  const [reference, setReference] = useState('');
  const [memberId, setMemberId] = useState('');
  const [category, setCategory] = useState<TransactionCategory>('Daily Contribution');
  const [note, setNote] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selected = useMemo(() => events.find(event => event.id === selectedId) || null, [events, selectedId]);

  const load = async () => {
    setIsLoading(true);
    setError('');
    try {
      const query = new URLSearchParams();
      if (status) query.set('status', status);
      if (eventType) query.set('eventType', eventType);
      if (reference) query.set('reference', reference);
      const [configData, eventsData, memberData] = await Promise.all([
        fetchSaccoJson<CoopBankConfig>('/api/coop-bank/config', {}, fallbackAuthToken),
        fetchSaccoJson<CoopBankEvent[]>(`/api/coop-bank/events${query.size ? `?${query}` : ''}`, {}, fallbackAuthToken),
        fetchSaccoJson<Member[]>('/api/members', {}, fallbackAuthToken)
      ]);
      setConfig(configData);
      setEvents(eventsData);
      setMembers(memberData.filter(member => member.status === 'Active'));
      if (selectedId && !eventsData.some(event => event.id === selectedId)) setSelectedId('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load Co-op Bank events.');
    } finally { setIsLoading(false); }
  };

  useEffect(() => { void load(); }, [fallbackAuthToken]);

  const runAction = async (action: 'reprocess' | 'reconcile' | 'quarantine') => {
    if (!selected) return;
    setError(''); setNotice(''); setIsSaving(true);
    try {
      if (action === 'reconcile') {
        if (!memberId) throw new Error('Choose the member who made this payment.');
        await postSaccoJson(`/api/coop-bank/events/${selected.id}/reconcile`, {
          memberId, category, tillNumber: category === 'Savings Contribution' ? 'UtilityTill' : 'VehicleTill', note
        }, fallbackAuthToken);
        setNotice('The bank event was posted once and linked to the ledger.');
      } else if (action === 'quarantine') {
        if (!note.trim()) throw new Error('Add a short reason before quarantining this event.');
        await postSaccoJson(`/api/coop-bank/events/${selected.id}/quarantine`, { reason: note }, fallbackAuthToken);
        setNotice('The event was quarantined for review.');
      } else {
        await postSaccoJson(`/api/coop-bank/events/${selected.id}/reprocess`, {}, fallbackAuthToken);
        setNotice('Matching was run again without changing the raw bank payload.');
      }
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The action could not be completed.'); }
    finally { setIsSaving(false); }
  };

  return (
    <main className="flex-1 overflow-auto bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3"><div className="rounded-xl bg-blue-600 p-3 text-white"><Building2 className="h-6 w-6" /></div><div><p className="text-xs font-bold uppercase tracking-widest text-blue-600">Bank integration</p><h2 className="text-2xl font-black text-slate-900">Co-op Bank event reconciliation</h2><p className="mt-1 text-sm text-slate-500">Durable bank notifications, exact matching suggestions, and controlled ledger allocation.</p></div></div>
          <button type="button" onClick={() => void load()} disabled={isLoading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />Refresh</button>
        </header>

        {config?.observeOnly && <div className="flex gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"><Eye className="h-5 w-5 shrink-0" /><div><p className="font-bold">Observe-only mode is active</p><p className="mt-1 text-blue-700">Events are stored and matched, but ledger posting and member balance changes are disabled.</p></div></div>}
        {error && <div className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><AlertCircle className="h-5 w-5 shrink-0" />{error}</div>}
        {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{notice}</div>}

        <section className="grid gap-4 md:grid-cols-4">
          <Metric icon={<ShieldCheck className="h-4 w-4 text-blue-600" />} label="Authentication" value={config?.authMode || '—'} detail={config?.authenticationConfigured ? 'Configured on server' : 'Credentials required'} />
          <Metric icon={<Database className="h-4 w-4 text-blue-600" />} label="Received today" value={String(config?.counts.receivedToday ?? '—')} detail={`${config?.counts.duplicates || 0} duplicate deliveries`} />
          <Metric icon={<AlertCircle className="h-4 w-4 text-amber-600" />} label="Needs review" value={String((config?.counts.unmatched || 0) + (config?.counts.ambiguous || 0) + (config?.counts.pendingAllocation || 0))} detail="Unmatched, ambiguous, or unallocated" />
          <Metric icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} label="Posted" value={String(config?.counts.posted ?? '—')} detail="Atomically linked ledger entries" />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_2fr_auto]">
            <select value={status} onChange={event => setStatus(event.target.value)} className={inputClass}><option value="">All statuses</option>{['UNMATCHED','AMBIGUOUS','PENDING_ALLOCATION','IGNORED_DEBIT','MANUALLY_RECONCILED'].map(value => <option key={value}>{value}</option>)}</select>
            <select value={eventType} onChange={event => setEventType(event.target.value)} className={inputClass}><option value="">Credits and debits</option><option>CREDIT</option><option>DEBIT</option></select>
            <input value={reference} onChange={event => setReference(event.target.value)} placeholder="Payment or transaction reference" className={inputClass} />
            <button type="button" onClick={() => void load()} className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white">Filter</button>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.45fr_0.8fr]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-6 py-4"><h3 className="text-sm font-black uppercase tracking-wide text-slate-800">Received events</h3></div>
            {isLoading ? <div className="p-8 text-sm text-slate-500">Loading events…</div> : events.length === 0 ? <div className="p-8 text-sm text-slate-500">No matching bank events.</div> : <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Received</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{events.map(event => <tr key={event.id} onClick={() => { setSelectedId(event.id); setMemberId(event.matchedMemberId || ''); }} className={`cursor-pointer ${selectedId === event.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}><td className="whitespace-nowrap px-4 py-4 text-slate-500">{new Date(event.receivedAt).toLocaleString()}</td><td className="px-4 py-4"><p className="font-mono text-xs font-bold text-slate-700">{event.paymentRef || event.transactionId}</p><p className={event.eventType === 'CREDIT' ? 'text-emerald-700' : 'text-rose-700'}>{event.eventType}</p></td><td className="whitespace-nowrap px-4 py-4 text-right font-bold">{event.currency} {event.amount.toLocaleString()}</td><td className="px-4 py-4"><StatusBadge value={event.reconciliationStatus} /></td></tr>)}</tbody></table></div>}
          </div>

          <aside className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-800">Event detail</h3>
            {!selected ? <p className="mt-5 text-sm text-slate-500">Select an event to inspect and reconcile it.</p> : <div className="mt-5 space-y-5">
              <dl className="grid grid-cols-2 gap-3 text-xs"><Detail label="Bank transaction" value={selected.transactionId} /><Detail label="Account" value={selected.accountNumber} /><Detail label="Processing" value={selected.processingStatus} /><Detail label="Member match" value={selected.matchedMemberName || 'Not matched'} /><Detail label="Narration" value={selected.narration || '—'} wide /><Detail label="Review reason" value={selected.manualReviewReason || '—'} wide /></dl>
              {!['MANUALLY_RECONCILED','POSTED','IGNORED_DEBIT'].includes(selected.reconciliationStatus) && selected.eventType === 'CREDIT' && <div className="space-y-3 border-t border-slate-100 pt-5">
                <select value={memberId} onChange={event => setMemberId(event.target.value)} className={`${inputClass} w-full`}><option value="">Choose member</option>{members.map(member => <option key={member.id} value={member.id}>{member.membershipNumber ? `${member.membershipNumber} · ` : ''}{member.name}</option>)}</select>
                <select value={category} onChange={event => setCategory(event.target.value as TransactionCategory)} className={`${inputClass} w-full`}>{categories.map(value => <option key={value}>{value}</option>)}</select>
                <textarea value={note} onChange={event => setNote(event.target.value)} placeholder="Reconciliation note" className={`${inputClass} min-h-20 w-full`} />
                <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">Confirming will post <strong>{selected.currency} {selected.amount.toLocaleString()}</strong> once to the selected member as <strong>{category}</strong>.</div>
                <button type="button" disabled={isSaving || config?.observeOnly} onClick={() => void runAction('reconcile')} className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-45">Confirm and post</button>
                <div className="grid grid-cols-2 gap-2"><button type="button" disabled={isSaving} onClick={() => void runAction('reprocess')} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700">Reprocess</button><button type="button" disabled={isSaving} onClick={() => void runAction('quarantine')} className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700">Quarantine</button></div>
              </div>}
            </div>}
          </aside>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm"><p className="font-bold text-slate-800">Bank onboarding callback</p><code className="mt-2 block break-all rounded-lg bg-slate-50 p-3 text-xs">{config?.webhookUrl || `Set APP_URL, then use ${config?.webhookPath || '/api/integrations/coop/ipn'}`}</code><p className="mt-2 text-xs">Credentials and full raw payloads never enter the browser. Automatic posting is {config?.autoPostingEnabled ? 'enabled by server configuration' : 'disabled'}.</p></section>
      </div>
    </main>
  );
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) { return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">{icon}{label}</div><p className="mt-3 text-lg font-black text-slate-900">{value}</p><p className="mt-1 text-sm text-slate-500">{detail}</p></div>; }
function Detail({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) { return <div className={wide ? 'col-span-2' : ''}><dt className="font-bold uppercase tracking-wide text-slate-400">{label}</dt><dd className="mt-1 break-words text-slate-700">{value}</dd></div>; }
function StatusBadge({ value }: { value: string }) { const safe = value.replace(/_/g, ' '); const color = value.includes('RECONCILED') || value === 'POSTED' ? 'bg-emerald-50 text-emerald-700' : value === 'IGNORED_DEBIT' ? 'bg-slate-100 text-slate-600' : value === 'AMBIGUOUS' || value === 'QUARANTINED' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'; return <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${color}`}>{safe}</span>; }
