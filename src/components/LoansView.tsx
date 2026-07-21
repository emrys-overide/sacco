import React, { useEffect, useState } from 'react';
import { AlertCircle, CalendarDays, CheckCircle2, Landmark, XCircle } from 'lucide-react';
import type { Member, UserRole } from '../types';
import { fetchSaccoJson, postSaccoJson } from '../lib/api';

type LoanRow = {
  id: string; member_name: string; principal_amount: number; interest_rate: number; status: string;
  member_savings: number; membership_days: number; secretary_notes?: string; treasurer_notes?: string;
  due_date?: string; repayment_period_months?: number; loan_type?: string; repayment_method?: string;
  income_source?: string; monthly_income?: number; amount_paid?: number; total_payable?: number;
  outstanding_balance?: number; rejection_reason?: string; application_snapshot?: {
    fullName?: string; membershipNumber?: string; nationalId?: string; phone?: string; email?: string;
  };
};
type Policy = { default_interest_rate: number; maximum_principal: number | null; minimum_savings: number; minimum_membership_days: number; require_active_membership: boolean };
type RejectionAction = { url: string; title: string; loanId: string };

const repaymentPeriods = [1, 2, 3, 6, 9, 12, 18, 24, 36, 48, 60, 72, 84];
const loanTypes = ['General', 'Emergency', 'Development', 'Education', 'Business', 'Vehicle'];
const repaymentMethods = ['SACCO collection', 'Salary deduction', 'Bank standing order', 'Mobile money', 'Other'];

const kes = (value: number | undefined) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 2 }).format(Number(value || 0));
const period = (months?: number) => !months ? 'Not set' : months % 12 === 0 ? `${months / 12} ${months === 12 ? 'year' : 'years'}` : `${months} ${months === 1 ? 'month' : 'months'}`;

export default function LoansView({ role, token, members }: { role: UserRole; token: string; members: Member[] }) {
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [notice, setNotice] = useState(''); const [error, setError] = useState('');
  const [memberId, setMemberId] = useState(''); const [principal, setPrincipal] = useState('');
  const [loanType, setLoanType] = useState('General'); const [repaymentPeriodMonths, setRepaymentPeriodMonths] = useState('12');
  const [repaymentMethod, setRepaymentMethod] = useState('SACCO collection'); const [incomeSource, setIncomeSource] = useState('');
  const [monthlyIncome, setMonthlyIncome] = useState(''); const [applicationNotes, setApplicationNotes] = useState('');
  const [rejection, setRejection] = useState<RejectionAction | null>(null); const [rejectionReason, setRejectionReason] = useState('');

  const load = async () => {
    const [loanRows, loanPolicy] = await Promise.all([
      fetchSaccoJson<LoanRow[]>('/api/loans', {}, token), fetchSaccoJson<Policy>('/api/loans-policy', {}, token)
    ]);
    setLoans(loanRows); setPolicy(loanPolicy);
  };
  useEffect(() => { void load().catch(caught => setError(caught.message)); }, [token]);

  const act = async (url: string, payload: unknown, success = 'Loan workflow updated.') => {
    setError(''); setNotice('');
    try { await postSaccoJson(url, payload, token); await load(); setNotice(success); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Action failed.'); }
  };

  const submitRejection = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!rejection) return;
    await act(rejection.url, { reason: rejectionReason, notes: rejectionReason }, 'The loan has been rejected and the member can now view the reason and reapply.');
    setRejection(null); setRejectionReason('');
  };

  const savePolicy = async (event: React.FormEvent) => {
    event.preventDefault(); if (!policy) return; setError('');
    try {
      await fetchSaccoJson('/api/loans-policy', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultInterestRate: Number(policy.default_interest_rate), maximumPrincipal: policy.maximum_principal, minimumSavings: Number(policy.minimum_savings), minimumMembershipDays: Number(policy.minimum_membership_days), requireActiveMembership: policy.require_active_membership })
      }, token);
      setNotice('Loan policy saved.'); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Policy could not be saved.'); }
  };

  const addMemberLoan = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setNotice('');
    try {
      await postSaccoJson('/api/loans', {
        memberId, principalAmount: Number(principal), loanType, repaymentPeriodMonths: Number(repaymentPeriodMonths),
        repaymentMethod, incomeSource, monthlyIncome: monthlyIncome === '' ? null : Number(monthlyIncome), notes: applicationNotes
      }, token);
      setMemberId(''); setPrincipal(''); setIncomeSource(''); setMonthlyIncome(''); setApplicationNotes('');
      await load(); setNotice('Loan request recorded and sent to the Secretary for review.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Loan request could not be added.'); }
  };

  const selectedMember = members.find(member => member.id === memberId);
  return <main className="flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-8"><div className="mx-auto max-w-7xl space-y-6">
    <header><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Controlled credit workflow</p><h1 className="mt-1 text-2xl font-black text-slate-900">Loan applications and repayment oversight</h1><p className="mt-2 text-sm text-slate-500">Secretary eligibility review → Treasurer financial review → Chairman approval and disbursement.</p></header>

    {role === 'Chairman' && <form onSubmit={addMemberLoan} className="rounded-2xl border border-emerald-200 bg-white p-5"><h2 className="font-black text-slate-900">Record an application for a registered member</h2><p className="mt-1 text-xs leading-5 text-slate-500">Use this only when assisting a member. Their verified identity details are captured by the server from the member record; repayment is selected as a period, not a calendar date.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><label className="text-xs font-bold text-slate-600">Member<select value={memberId} onChange={event => setMemberId(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm" required><option value="">Select active member</option>{members.filter(member => member.status === 'Active').map(member => <option key={member.id} value={member.id}>{member.name} · ID {member.idNumber}</option>)}</select></label><label className="text-xs font-bold text-slate-600">Loan type<select value={loanType} onChange={event => setLoanType(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm">{loanTypes.map(type => <option key={type}>{type}</option>)}</select></label><label className="text-xs font-bold text-slate-600">Amount requested (KES)<input type="number" min="1" step="0.01" value={principal} onChange={event => setPrincipal(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm" required /></label><label className="text-xs font-bold text-slate-600">Repayment period<select value={repaymentPeriodMonths} onChange={event => setRepaymentPeriodMonths(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm">{repaymentPeriods.map(months => <option key={months} value={months}>{period(months)}</option>)}</select></label><label className="text-xs font-bold text-slate-600">Repayment method<select value={repaymentMethod} onChange={event => setRepaymentMethod(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm">{repaymentMethods.map(method => <option key={method}>{method}</option>)}</select></label><label className="text-xs font-bold text-slate-600">Income / business source <span className="font-medium text-slate-400">(optional)</span><input value={incomeSource} onChange={event => setIncomeSource(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm" /></label><label className="text-xs font-bold text-slate-600">Estimated monthly income <span className="font-medium text-slate-400">(optional)</span><input type="number" min="0" step="0.01" value={monthlyIncome} onChange={event => setMonthlyIncome(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm" /></label><label className="text-xs font-bold text-slate-600 sm:col-span-2">Purpose / notes <span className="font-medium text-slate-400">(optional)</span><textarea value={applicationNotes} onChange={event => setApplicationNotes(event.target.value)} className="mt-1.5 min-h-20 w-full rounded-xl border px-3 py-2.5 text-sm" /></label></div>{selectedMember && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">Verified applicant: <strong>{selectedMember.name}</strong> · {selectedMember.phoneNumber} · {selectedMember.email || 'No email recorded'}</p>}<button className="mt-4 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white">Record loan request</button></form>}

    {role === 'Chairman' && policy && <form onSubmit={savePolicy} className="rounded-2xl border bg-white p-5"><h2 className="font-black text-slate-900">Chairman loan policy</h2><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs font-bold text-slate-600">Interest rate (%)<input type="number" min="0" step="0.001" value={policy.default_interest_rate} onChange={event => setPolicy({ ...policy, default_interest_rate: Number(event.target.value) })} className="mt-2 w-full rounded-xl border px-3 py-2.5" /></label><label className="text-xs font-bold text-slate-600">Maximum principal<input type="number" min="1" step="1" value={policy.maximum_principal ?? ''} onChange={event => setPolicy({ ...policy, maximum_principal: event.target.value === '' ? null : Number(event.target.value) })} className="mt-2 w-full rounded-xl border px-3 py-2.5" /><span className="mt-1 block font-normal leading-4 text-slate-500">The highest original amount a member may request, before interest. Leave blank for no cap.</span></label><label className="text-xs font-bold text-slate-600">Minimum savings<input type="number" min="0" step="1" value={policy.minimum_savings} onChange={event => setPolicy({ ...policy, minimum_savings: Number(event.target.value) })} className="mt-2 w-full rounded-xl border px-3 py-2.5" /></label><label className="text-xs font-bold text-slate-600">Minimum membership days<input type="number" min="0" step="1" value={policy.minimum_membership_days} onChange={event => setPolicy({ ...policy, minimum_membership_days: Number(event.target.value) })} className="mt-2 w-full rounded-xl border px-3 py-2.5" /></label></div><button className="mt-4 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white">Save policy</button></form>}

    {(error || notice) && <p className={`rounded-xl p-3 text-sm ${error ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{error || notice}</p>}
    {rejection && <form onSubmit={submitRejection} className="rounded-2xl border-2 border-rose-200 bg-rose-50 p-5"><div className="flex items-center gap-2 text-rose-900"><AlertCircle className="h-5 w-5" /><h2 className="font-black">{rejection.title}</h2></div><p className="mt-2 text-sm text-rose-800">This reason is required and will be visible to the member, who can correct the issue and submit a new application.</p><textarea value={rejectionReason} onChange={event => setRejectionReason(event.target.value)} className="mt-4 min-h-24 w-full rounded-xl border border-rose-200 bg-white px-3 py-2.5 text-sm" placeholder="Explain clearly what the member needs to correct or meet." minLength={5} required /><div className="mt-3 flex gap-2"><button className="rounded-xl bg-rose-700 px-4 py-2.5 text-xs font-bold text-white">Reject loan and notify member</button><button type="button" onClick={() => { setRejection(null); setRejectionReason(''); }} className="rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-xs font-bold text-rose-800">Cancel</button></div></form>}

    <section className="overflow-x-auto rounded-2xl border bg-white"><table className="w-full min-w-[1280px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500"><tr><th className="p-4">Member & application</th><th>Period / due date</th><th>Requested</th><th>Paid</th><th>Outstanding</th><th>Eligibility</th><th>Stage / member message</th><th className="p-4">Action</th></tr></thead><tbody className="divide-y">{loans.map(loan => <tr key={loan.id} className={loan.status === 'Rejected' ? 'bg-rose-50/30' : ''}><td className="p-4"><p className="font-bold text-slate-900">{loan.member_name}</p><p className="mt-1 text-xs text-slate-500">{loan.loan_type || 'General'} · {loan.repayment_method || 'Not set'}</p>{loan.application_snapshot && <p className="mt-1 text-xs text-slate-500">{loan.application_snapshot.phone || ''} {loan.application_snapshot.email ? `· ${loan.application_snapshot.email}` : ''}</p>}</td><td><p className="font-medium">{period(loan.repayment_period_months)}</p><p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><CalendarDays className="h-3.5 w-3.5" />{loan.due_date || 'Set on approval'}</p></td><td>{kes(loan.principal_amount)}</td><td className="text-emerald-700">{kes(loan.amount_paid)}</td><td className="font-bold">{kes(loan.outstanding_balance)}</td><td><p>Savings {kes(loan.member_savings)}</p><p className="mt-1 text-xs text-slate-500">{loan.membership_days} membership days</p></td><td><span className={`rounded-full px-2 py-1 text-xs font-bold ${loan.status === 'Rejected' ? 'bg-rose-100 text-rose-800' : 'bg-amber-50 text-amber-800'}`}>{loan.status}</span>{loan.rejection_reason && <p className="mt-2 max-w-xs text-xs leading-5 text-rose-800"><strong>Reason:</strong> {loan.rejection_reason}</p>}</td><td className="p-4">{loan.status === 'SecretaryReview' && role === 'Secretary' && <div className="flex gap-3"><button onClick={() => void act(`/api/loans/${loan.id}/secretary-review`, { eligible: true, notes: 'Eligibility review completed.' })} className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Eligible</button><button onClick={() => setRejection({ url: `/api/loans/${loan.id}/secretary-review`, title: 'Reject at Secretary review', loanId: loan.id })} className="inline-flex items-center gap-1 text-xs font-bold text-rose-700"><XCircle className="h-3.5 w-3.5" /> Reject</button></div>}{loan.status === 'TreasurerReview' && role === 'Treasurer' && <div className="flex gap-3"><button onClick={() => void act(`/api/loans/${loan.id}/treasurer-review`, { approved: true, notes: 'Financial review completed.' })} className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Figures correct</button><button onClick={() => setRejection({ url: `/api/loans/${loan.id}/treasurer-review`, title: 'Reject at Treasurer review', loanId: loan.id })} className="inline-flex items-center gap-1 text-xs font-bold text-rose-700"><XCircle className="h-3.5 w-3.5" /> Reject</button></div>}{loan.status === 'ChairmanReview' && role === 'Chairman' && <div className="flex gap-3"><button onClick={() => void act(`/api/loans/${loan.id}/approve`, {}, 'Loan approved, disbursed, and due date calculated from its repayment period.')} className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Final approve</button><button onClick={() => setRejection({ url: `/api/loans/${loan.id}/reject`, title: 'Reject at Chairman review', loanId: loan.id })} className="inline-flex items-center gap-1 text-xs font-bold text-rose-700"><XCircle className="h-3.5 w-3.5" /> Reject</button></div>}</td></tr>)}{!loans.length && <tr><td colSpan={8} className="p-8 text-center text-slate-500">No loan applications yet.</td></tr>}</tbody></table></section>
  </div></main>;
}
