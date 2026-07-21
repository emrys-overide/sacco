import React, { useEffect, useState } from 'react';
import { Bug, CheckCircle2, ChevronDown, RefreshCw, ShieldAlert } from 'lucide-react';
import { fetchSaccoJson } from '../lib/api';

type ErrorLog = {
  id: string;
  occurred_at: string;
  source: 'server' | 'client';
  severity: 'warning' | 'error' | 'critical';
  request_id?: string;
  method?: string;
  path?: string;
  status_code?: number;
  error_code?: string;
  message: string;
  stack_trace?: string;
  context?: Record<string, string>;
  resolved_at?: string;
  resolved_by_name?: string;
  resolution_note?: string;
};

export default function DeveloperErrorLogView({ token }: { token: string }) {
  const [entries, setEntries] = useState<ErrorLog[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true); setError('');
    try {
      setEntries(await fetchSaccoJson<ErrorLog[]>(`/api/developer-errors?status=${showAll ? 'all' : 'open'}`, {}, token));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load developer diagnostics.');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [token, showAll]);

  const updateResolution = async (entry: ErrorLog, resolved: boolean) => {
    try {
      const updated = await fetchSaccoJson<ErrorLog>(`/api/developer-errors/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved, resolutionNote: resolutionNotes[entry.id] || '' })
      }, token);
      setEntries(current => current.map(item => item.id === entry.id ? { ...item, ...updated } : item).filter(item => showAll || !item.resolved_at));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The diagnostic entry could not be updated.'); }
  };

  return <main className="flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-8"><div className="mx-auto max-w-6xl space-y-6"><header className="rounded-3xl bg-gradient-to-br from-slate-950 to-slate-800 p-6 text-white sm:p-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-amber-200"><ShieldAlert className="h-4 w-4" /> Restricted developer area</p><h1 className="mt-3 text-3xl font-black">Application error log</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-200">Unexpected server failures and authenticated browser crashes are recorded here. Secrets, passwords, tokens, request bodies, and query strings are redacted before storage.</p></div><button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold hover:bg-white/20"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button></div></header><section className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-black text-slate-900">{showAll ? 'All diagnostics' : 'Open diagnostics'}</h2><p className="mt-1 text-xs text-slate-500">Resolve an entry only after its cause is understood or fixed.</p></div><label className="flex items-center gap-2 text-xs font-bold text-slate-700"><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} /> Show resolved entries</label></div>{error && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<div className="mt-4 space-y-3">{entries.map(entry => <article key={entry.id} className={`rounded-xl border p-4 ${entry.resolved_at ? 'border-slate-200 bg-slate-50' : entry.severity === 'critical' ? 'border-rose-200 bg-rose-50/40' : 'border-amber-200 bg-amber-50/30'}`}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wider ${entry.resolved_at ? 'bg-slate-200 text-slate-600' : entry.severity === 'critical' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>{entry.resolved_at ? 'Resolved' : entry.severity}</span><span className="text-xs font-bold text-slate-700">{entry.source === 'client' ? 'Browser' : 'Server'}</span><time className="text-xs text-slate-500">{new Date(entry.occurred_at).toLocaleString('en-KE')}</time></div><p className="mt-2 break-words font-bold text-slate-900">{entry.message}</p><p className="mt-1 font-mono text-xs text-slate-500">{entry.method || 'CLIENT'} {entry.path || '—'} {entry.status_code ? `· ${entry.status_code}` : ''} {entry.error_code ? `· ${entry.error_code}` : ''}</p></div><button onClick={() => setExpanded(current => current === entry.id ? null : entry.id)} className="inline-flex items-center gap-1 text-xs font-bold text-slate-600"><ChevronDown className={`h-4 w-4 transition-transform ${expanded === entry.id ? 'rotate-180' : ''}`} /> Details</button></div>{expanded === entry.id && <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Request ID: <code>{entry.request_id || 'not available'}</code></p>{entry.context && Object.keys(entry.context).length > 0 && <dl className="grid gap-2 text-xs sm:grid-cols-3">{Object.entries(entry.context).filter(([, value]) => value).map(([key, value]) => <div key={key}><dt className="font-bold uppercase tracking-wider text-slate-400">{key}</dt><dd className="mt-1 break-words text-slate-700">{value}</dd></div>)}</dl>}{entry.stack_trace && <pre className="max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-100">{entry.stack_trace}</pre>}{entry.resolved_at ? <p className="text-xs text-emerald-700">Resolved {new Date(entry.resolved_at).toLocaleString('en-KE')}{entry.resolved_by_name ? ` by ${entry.resolved_by_name}` : ''}{entry.resolution_note ? ` — ${entry.resolution_note}` : ''}</p> : <div className="flex flex-wrap gap-2"><input value={resolutionNotes[entry.id] || ''} onChange={event => setResolutionNotes(current => ({ ...current, [entry.id]: event.target.value }))} placeholder="Resolution note (optional)" className="min-w-64 flex-1 rounded-lg border px-3 py-2 text-sm" /><button onClick={() => void updateResolution(entry, true)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white"><CheckCircle2 className="h-4 w-4" /> Mark resolved</button></div>}</div>}</article>)}{!loading && !entries.length && <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500"><Bug className="mx-auto mb-3 h-7 w-7 text-emerald-600" />No {showAll ? '' : 'open '}application errors recorded.</div>}</div></section></div></main>;
}
