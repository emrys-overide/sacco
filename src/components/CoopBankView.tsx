import React, { useEffect, useState } from 'react';
import { AlertCircle, Building2, CheckCircle2, Database, RefreshCw, ShieldCheck } from 'lucide-react';
import type { CoopBankEvent } from '../types';
import { getSaccoAccessToken } from '../lib/api';

interface CoopBankViewProps {
  fallbackAuthToken: string;
}

type CoopBankConfig = {
  provider: string;
  webhookPath: string;
  webhookUrl: string;
  authMode: 'Token' | 'Basic';
  authenticationConfigured: boolean;
  configuredAccountCount: number;
};

export default function CoopBankView({ fallbackAuthToken }: CoopBankViewProps) {
  const [config, setConfig] = useState<CoopBankConfig | null>(null);
  const [events, setEvents] = useState<CoopBankEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setIsLoading(true);
    setError('');
    try {
      const token = await getSaccoAccessToken(fallbackAuthToken);
      const headers = { Authorization: `Bearer ${token}` };
      const [configResponse, eventsResponse] = await Promise.all([
        fetch('/api/coop-bank/config', { headers }),
        fetch('/api/coop-bank/events', { headers })
      ]);
      const configData = await configResponse.json();
      const eventsData = await eventsResponse.json();
      if (!configResponse.ok) throw new Error(configData.error || 'Could not load the Co-op Bank integration status.');
      if (!eventsResponse.ok) throw new Error(eventsData.error || 'Could not load Co-op Bank events.');
      setConfig(configData);
      setEvents(eventsData);
    } catch (caught: any) {
      setError(caught?.message || 'Could not load Co-op Bank integration data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void load(); }, [fallbackAuthToken]);

  return (
    <main className="flex-1 overflow-auto bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-blue-600 p-3 text-white"><Building2 className="h-6 w-6" /></div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-blue-600">Bank integration</p>
              <h2 className="text-2xl font-black text-slate-900">Co-op Bank B2B Event Inbox</h2>
              <p className="mt-1 text-sm text-slate-500">Authenticated account events are retained before an officer reconciles them. They do not auto-post to the member ledger.</p>
            </div>
          </div>
          <button type="button" onClick={() => void load()} disabled={isLoading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </header>

        {error && <div className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><AlertCircle className="h-5 w-5 shrink-0" />{error}</div>}

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500"><ShieldCheck className="h-4 w-4 text-blue-600" /> Bank authentication</div><p className="mt-3 text-lg font-black text-slate-900">{config?.authMode || '—'}</p><p className={`mt-1 text-sm ${config?.authenticationConfigured ? 'text-emerald-600' : 'text-amber-600'}`}>{config?.authenticationConfigured ? 'Configured on the server' : 'Credentials still required'}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500"><Database className="h-4 w-4 text-blue-600" /> Approved bank accounts</div><p className="mt-3 text-lg font-black text-slate-900">{config?.configuredAccountCount ?? '—'}</p><p className="mt-1 text-sm text-slate-500">Only configured Co-op accounts may send events.</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500"><CheckCircle2 className="h-4 w-4 text-blue-600" /> Pending review</div><p className="mt-3 text-lg font-black text-slate-900">{events.filter(event => event.status === 'PendingReview').length}</p><p className="mt-1 text-sm text-slate-500">Credits and debits awaiting controlled reconciliation.</p></div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-black uppercase tracking-wide text-slate-800">Onboarding handoff</h3>
          <p className="mt-2 text-sm text-slate-600">Give this HTTPS receiver and the separately agreed {config?.authMode || 'Token'} credentials to Co-operative Bank after the B2B onboarding form is authorised.</p>
          <code className="mt-3 block break-all rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">{config?.webhookUrl || `Set APP_URL, then use ${config?.webhookPath || '/api/webhooks/coop-bank/b2b-ipn'}`}</code>
          <p className="mt-3 text-xs text-slate-500">The browser never receives the bank credential or raw bank payload. Duplicate Transaction IDs are acknowledged without creating another event.</p>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4"><h3 className="text-sm font-black uppercase tracking-wide text-slate-800">Received bank events</h3></div>
          {isLoading ? <div className="p-8 text-sm text-slate-500">Loading integration events…</div> : events.length === 0 ? <div className="p-8 text-sm text-slate-500">No Co-op Bank B2B events have been received yet.</div> : <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Received</th><th className="px-5 py-3">Event</th><th className="px-5 py-3">Reference</th><th className="px-5 py-3">Narration</th><th className="px-5 py-3 text-right">Amount</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{events.map(event => <tr key={event.id}><td className="whitespace-nowrap px-5 py-4 text-slate-500">{new Date(event.receivedAt).toLocaleString()}</td><td className={`px-5 py-4 font-bold ${event.eventType === 'CREDIT' ? 'text-emerald-700' : 'text-rose-700'}`}>{event.eventType}</td><td className="px-5 py-4 font-mono text-xs text-slate-700">{event.paymentRef || event.transactionId}</td><td className="max-w-md px-5 py-4 text-slate-600">{event.narration || event.customerMemoLine1 || '—'}</td><td className="whitespace-nowrap px-5 py-4 text-right font-bold text-slate-800">{event.currency} {event.amount.toLocaleString()}</td><td className="px-5 py-4"><span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">{event.status}</span></td></tr>)}</tbody></table></div>}
        </section>
      </div>
    </main>
  );
}
