import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Download,
  FileSignature,
  Landmark,
  Printer,
  XCircle
} from 'lucide-react';
import type { Member, UserRole } from '../types';
import { fetchSaccoJson, postSaccoJson } from '../lib/api';
import {
  downloadLoanAgreementWord,
  isLoanAgreementAvailable,
  printLoanAgreement,
  type LoanAgreementData
} from '../lib/loanAgreement';

type LoanRow = {
  id: string;
  member_name: string;
  principal_amount: number;
  interest_rate: number;
  status: string;
  member_savings: number;
  membership_days: number;
  application_date?: string;
  issue_date?: string;
  created_at?: string;
  approved_at?: string;
  disbursed_at?: string;
  due_date?: string;
  repayment_period_months?: number;
  loan_type?: string;
  repayment_method?: string;
  income_source?: string;
  monthly_income?: number;
  guarantor_details?: string;
  collateral_details?: string;
  notes?: string;
  secretary_reviewed_by_name?: string;
  secretary_reviewed_at?: string;
  secretary_notes?: string;
  treasurer_reviewed_by_name?: string;
  treasurer_reviewed_at?: string;
  treasurer_notes?: string;
  approved_by_name?: string;
  amount_paid?: number;
  total_payable?: number;
  outstanding_balance?: number;
  rejection_reason?: string;
  application_snapshot?: {
    fullName?: string;
    membershipNumber?: string;
    nationalId?: string;
    phone?: string;
    email?: string;
  };
};

type Policy = {
  default_interest_rate: number;
  maximum_principal: number | null;
  minimum_savings: number;
  minimum_membership_days: number;
  require_active_membership: boolean;
};

type RejectionAction = { url: string; title: string; loanId: string };

const repaymentPeriods = [1, 2, 3, 6, 9, 12, 18, 24, 36, 48, 60, 72, 84];
const loanTypes = ['General', 'Emergency', 'Development', 'Education', 'Business', 'Vehicle'];
const repaymentMethods = ['SACCO collection', 'Salary deduction', 'Bank standing order', 'Mobile money', 'Other'];

const kes = (value: number | undefined) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 2 }).format(Number(value || 0));

const period = (months?: number) => {
  if (!months) return 'Not set';
  if (months % 12 === 0) return `${months / 12} ${months === 12 ? 'year' : 'years'}`;
  return `${months} ${months === 1 ? 'month' : 'months'}`;
};

function useWideLoanLayout() {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1280px)');
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

function agreementData(loan: LoanRow): LoanAgreementData {
  const snapshot = loan.application_snapshot || {};
  return {
    id: loan.id,
    status: loan.status,
    memberName: snapshot.fullName || loan.member_name,
    membershipNumber: snapshot.membershipNumber,
    nationalId: snapshot.nationalId,
    phone: snapshot.phone,
    email: snapshot.email,
    loanType: loan.loan_type,
    applicationDate: loan.application_date || loan.created_at,
    principalAmount: Number(loan.principal_amount),
    interestRate: Number(loan.interest_rate),
    totalPayable: Number(loan.total_payable || 0) || undefined,
    repaymentPeriodMonths: loan.repayment_period_months,
    repaymentMethod: loan.repayment_method,
    incomeSource: loan.income_source,
    monthlyIncome: loan.monthly_income == null ? undefined : Number(loan.monthly_income),
    guarantorDetails: loan.guarantor_details,
    collateralDetails: loan.collateral_details,
    purposeNotes: loan.notes,
    issueDate: loan.issue_date,
    dueDate: loan.due_date,
    approvedAt: loan.approved_at,
    disbursedAt: loan.disbursed_at,
    memberSavings: Number(loan.member_savings),
    membershipDays: Number(loan.membership_days),
    secretaryName: loan.secretary_reviewed_by_name,
    secretaryReviewedAt: loan.secretary_reviewed_at,
    secretaryNotes: loan.secretary_notes,
    treasurerName: loan.treasurer_reviewed_by_name,
    treasurerReviewedAt: loan.treasurer_reviewed_at,
    treasurerNotes: loan.treasurer_notes,
    chairmanName: loan.approved_by_name
  };
}

export default function LoansView({ role, token, members }: { role: UserRole; token: string; members: Member[] }) {
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [memberId, setMemberId] = useState('');
  const [principal, setPrincipal] = useState('');
  const [loanType, setLoanType] = useState('General');
  const [repaymentPeriodMonths, setRepaymentPeriodMonths] = useState('12');
  const [repaymentMethod, setRepaymentMethod] = useState('SACCO collection');
  const [incomeSource, setIncomeSource] = useState('');
  const [monthlyIncome, setMonthlyIncome] = useState('');
  const [guarantorDetails, setGuarantorDetails] = useState('');
  const [collateralDetails, setCollateralDetails] = useState('');
  const [applicationNotes, setApplicationNotes] = useState('');
  const [rejection, setRejection] = useState<RejectionAction | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const wideLayout = useWideLoanLayout();

  const load = async () => {
    const [loanRows, loanPolicy] = await Promise.all([
      fetchSaccoJson<LoanRow[]>('/api/loans', {}, token),
      fetchSaccoJson<Policy>('/api/loans-policy', {}, token)
    ]);
    setLoans(loanRows);
    setPolicy(loanPolicy);
  };

  useEffect(() => {
    void load().catch(caught => setError(caught instanceof Error ? caught.message : 'Loan records could not be loaded.'));
  }, [token]);

  const act = async (url: string, payload: unknown, success = 'Loan workflow updated.') => {
    setError('');
    setNotice('');
    try {
      await postSaccoJson(url, payload, token);
      await load();
      setNotice(success);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed.');
    }
  };

  const submitRejection = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!rejection) return;
    await act(
      rejection.url,
      { reason: rejectionReason, notes: rejectionReason },
      'The loan has been rejected and the member can now view the reason and reapply.'
    );
    setRejection(null);
    setRejectionReason('');
  };

  const savePolicy = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!policy) return;
    setError('');
    try {
      await fetchSaccoJson('/api/loans-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultInterestRate: Number(policy.default_interest_rate),
          maximumPrincipal: policy.maximum_principal,
          minimumSavings: Number(policy.minimum_savings),
          minimumMembershipDays: Number(policy.minimum_membership_days),
          requireActiveMembership: policy.require_active_membership
        })
      }, token);
      setNotice('Loan policy saved.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Policy could not be saved.');
    }
  };

  const addMemberLoan = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      await postSaccoJson('/api/loans', {
        memberId,
        principalAmount: Number(principal),
        loanType,
        repaymentPeriodMonths: Number(repaymentPeriodMonths),
        repaymentMethod,
        incomeSource,
        monthlyIncome: monthlyIncome === '' ? null : Number(monthlyIncome),
        guarantorDetails,
        collateralDetails,
        notes: applicationNotes
      }, token);
      setMemberId('');
      setPrincipal('');
      setIncomeSource('');
      setMonthlyIncome('');
      setGuarantorDetails('');
      setCollateralDetails('');
      setApplicationNotes('');
      await load();
      setNotice('Loan request recorded and sent to the Secretary for review.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Loan request could not be added.');
    }
  };

  const selectedMember = members.find(member => member.id === memberId);

  const openAgreement = (loan: LoanRow) => {
    if (!printLoanAgreement(agreementData(loan))) {
      setError('The browser blocked the printable agreement. Allow pop-ups for this SACCO site, then try again.');
    }
  };

  const renderActions = (loan: LoanRow) => (
    <div className="flex flex-wrap items-center gap-3">
      {loan.status === 'SecretaryReview' && role === 'Secretary' && (
        <>
          <button type="button" onClick={() => void act(`/api/loans/${loan.id}/secretary-review`, { eligible: true, notes: 'Eligibility review completed.' })} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-bold text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Eligible
          </button>
          <button type="button" onClick={() => setRejection({ url: `/api/loans/${loan.id}/secretary-review`, title: 'Reject at Secretary review', loanId: loan.id })} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-bold text-rose-700">
            <XCircle className="h-3.5 w-3.5" /> Reject
          </button>
        </>
      )}
      {loan.status === 'TreasurerReview' && role === 'Treasurer' && (
        <>
          <button type="button" onClick={() => void act(`/api/loans/${loan.id}/treasurer-review`, { approved: true, notes: 'Financial review completed.' })} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-bold text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Figures correct
          </button>
          <button type="button" onClick={() => setRejection({ url: `/api/loans/${loan.id}/treasurer-review`, title: 'Reject at Treasurer review', loanId: loan.id })} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-bold text-rose-700">
            <XCircle className="h-3.5 w-3.5" /> Reject
          </button>
        </>
      )}
      {loan.status === 'ChairmanReview' && role === 'Chairman' && (
        <>
          <button type="button" onClick={() => void act(`/api/loans/${loan.id}/approve`, {}, 'Loan approved, disbursed, and due date calculated. The agreement is now ready for signatures.')} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-bold text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Final approve
          </button>
          <button type="button" onClick={() => setRejection({ url: `/api/loans/${loan.id}/reject`, title: 'Reject at Chairman review', loanId: loan.id })} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-bold text-rose-700">
            <XCircle className="h-3.5 w-3.5" /> Reject
          </button>
        </>
      )}
      {isLoanAgreementAvailable(loan.status) && (
        <div className="flex w-full flex-wrap gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={() => openAgreement(loan)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white">
            <Printer className="h-3.5 w-3.5" /> Print / Save PDF
          </button>
          <button type="button" onClick={() => downloadLoanAgreementWord(agreementData(loan))} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
            <Download className="h-3.5 w-3.5" /> Download Word
          </button>
        </div>
      )}
    </div>
  );

  return (
    <main className="flex-1 overflow-y-auto bg-slate-50 p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-5 sm:space-y-6">
        <header>
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Controlled credit workflow</p>
          <h1 className="mt-1 text-xl font-black leading-tight text-slate-900 sm:text-2xl">Loan applications and repayment oversight</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">Secretary eligibility review → Treasurer financial review → Chairman approval → printable agreement and manual signatures.</p>
        </header>

        {role === 'Chairman' && (
          <form onSubmit={addMemberLoan} className="rounded-2xl border border-emerald-200 bg-white p-4 sm:p-5">
            <h2 className="font-black text-slate-900">Record an application for a registered member</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">The server captures verified identity details. Security and guarantor entries remain proposals until verification and signature.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs font-bold text-slate-600">Member
                <select value={memberId} onChange={event => setMemberId(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm" required>
                  <option value="">Select active member</option>
                  {members.filter(member => member.status === 'Active').map(member => <option key={member.id} value={member.id}>{member.name} · ID {member.idNumber}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-slate-600">Loan type
                <select value={loanType} onChange={event => setLoanType(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm">{loanTypes.map(type => <option key={type}>{type}</option>)}</select>
              </label>
              <label className="text-xs font-bold text-slate-600">Amount requested (KES)
                <input type="number" min="1" step="0.01" value={principal} onChange={event => setPrincipal(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm" required />
              </label>
              <label className="text-xs font-bold text-slate-600">Repayment period
                <select value={repaymentPeriodMonths} onChange={event => setRepaymentPeriodMonths(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm">{repaymentPeriods.map(months => <option key={months} value={months}>{period(months)}</option>)}</select>
              </label>
              <label className="text-xs font-bold text-slate-600">Repayment method
                <select value={repaymentMethod} onChange={event => setRepaymentMethod(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm">{repaymentMethods.map(method => <option key={method}>{method}</option>)}</select>
              </label>
              <label className="text-xs font-bold text-slate-600">Income / business source <span className="font-medium text-slate-400">(optional)</span>
                <input value={incomeSource} onChange={event => setIncomeSource(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm" />
              </label>
              <label className="text-xs font-bold text-slate-600">Estimated monthly income <span className="font-medium text-slate-400">(optional)</span>
                <input type="number" min="0" step="0.01" value={monthlyIncome} onChange={event => setMonthlyIncome(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm" />
              </label>
              <label className="text-xs font-bold text-slate-600 sm:col-span-2 lg:col-span-3">Guarantor details <span className="font-medium text-slate-400">(optional)</span>
                <textarea value={guarantorDetails} onChange={event => setGuarantorDetails(event.target.value)} className="mt-1.5 min-h-20 w-full rounded-xl border px-3 py-2.5 text-sm" placeholder="Names, member numbers and contacts. Formal liability begins only after signature." />
              </label>
              <label className="text-xs font-bold text-slate-600 sm:col-span-2 lg:col-span-3">Security / collateral <span className="font-medium text-slate-400">(optional)</span>
                <textarea value={collateralDetails} onChange={event => setCollateralDetails(event.target.value)} className="mt-1.5 min-h-20 w-full rounded-xl border px-3 py-2.5 text-sm" placeholder="Describe proposed security for verification." />
              </label>
              <label className="text-xs font-bold text-slate-600 sm:col-span-2 lg:col-span-3">Purpose / notes <span className="font-medium text-slate-400">(optional)</span>
                <textarea value={applicationNotes} onChange={event => setApplicationNotes(event.target.value)} className="mt-1.5 min-h-20 w-full rounded-xl border px-3 py-2.5 text-sm" />
              </label>
            </div>
            {selectedMember && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">Verified applicant: <strong>{selectedMember.name}</strong> · {selectedMember.phoneNumber} · {selectedMember.email || 'No email recorded'}</p>}
            <button className="mt-4 min-h-11 w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white sm:w-auto">Record loan request</button>
          </form>
        )}

        {role === 'Chairman' && policy && (
          <form onSubmit={savePolicy} className="rounded-2xl border bg-white p-4 sm:p-5">
            <h2 className="font-black text-slate-900">Chairman loan policy</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs font-bold text-slate-600">Flat interest rate (%)
                <input type="number" min="0" step="0.001" value={policy.default_interest_rate} onChange={event => setPolicy({ ...policy, default_interest_rate: Number(event.target.value) })} className="mt-2 w-full rounded-xl border px-3 py-2.5" />
                <span className="mt-1 block font-normal leading-4 text-slate-500">Applied once to the original principal for the selected term.</span>
              </label>
              <label className="text-xs font-bold text-slate-600">Maximum principal
                <input type="number" min="1" step="1" value={policy.maximum_principal ?? ''} onChange={event => setPolicy({ ...policy, maximum_principal: event.target.value === '' ? null : Number(event.target.value) })} className="mt-2 w-full rounded-xl border px-3 py-2.5" />
                <span className="mt-1 block font-normal leading-4 text-slate-500">Highest original amount before interest. Leave blank for no cap.</span>
              </label>
              <label className="text-xs font-bold text-slate-600">Minimum savings
                <input type="number" min="0" step="1" value={policy.minimum_savings} onChange={event => setPolicy({ ...policy, minimum_savings: Number(event.target.value) })} className="mt-2 w-full rounded-xl border px-3 py-2.5" />
              </label>
              <label className="text-xs font-bold text-slate-600">Minimum membership days
                <input type="number" min="0" step="1" value={policy.minimum_membership_days} onChange={event => setPolicy({ ...policy, minimum_membership_days: Number(event.target.value) })} className="mt-2 w-full rounded-xl border px-3 py-2.5" />
              </label>
            </div>
            <button className="mt-4 min-h-11 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white sm:w-auto">Save policy</button>
          </form>
        )}

        {(error || notice) && <p className={`rounded-xl p-3 text-sm ${error ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{error || notice}</p>}

        {rejection && (
          <form onSubmit={submitRejection} className="rounded-2xl border-2 border-rose-200 bg-rose-50 p-4 sm:p-5">
            <div className="flex items-center gap-2 text-rose-900"><AlertCircle className="h-5 w-5" /><h2 className="font-black">{rejection.title}</h2></div>
            <p className="mt-2 text-sm text-rose-800">This reason is required and will be visible to the member.</p>
            <textarea value={rejectionReason} onChange={event => setRejectionReason(event.target.value)} className="mt-4 min-h-24 w-full rounded-xl border border-rose-200 bg-white px-3 py-2.5 text-sm" placeholder="Explain clearly what the member needs to correct or meet." minLength={5} required />
            <div className="mt-3 grid gap-2 sm:flex">
              <button className="min-h-11 rounded-xl bg-rose-700 px-4 py-2.5 text-xs font-bold text-white">Reject loan and notify member</button>
              <button type="button" onClick={() => { setRejection(null); setRejectionReason(''); }} className="min-h-11 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-xs font-bold text-rose-800">Cancel</button>
            </div>
          </form>
        )}

        <section className="rounded-2xl border bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4">
            <div>
              <h2 className="flex items-center gap-2 font-black text-slate-900"><Landmark className="h-4 w-4 text-emerald-700" /> Loan register</h2>
              <p className="mt-1 text-xs text-slate-500">{loans.length} application{loans.length === 1 ? '' : 's'} shown</p>
            </div>
            <FileSignature className="h-5 w-5 text-slate-300" />
          </div>

          {!loans.length ? (
            <p className="p-8 text-center text-sm text-slate-500">No loan applications yet.</p>
          ) : wideLayout ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr><th className="p-4">Member & application</th><th>Period / due date</th><th>Requested</th><th>Paid</th><th>Outstanding</th><th>Eligibility</th><th>Stage / message</th><th className="p-4">Action</th></tr>
                </thead>
                <tbody className="divide-y">
                  {loans.map(loan => (
                    <tr key={loan.id} className={loan.status === 'Rejected' ? 'bg-rose-50/30' : ''}>
                      <td className="p-4">
                        <p className="font-bold text-slate-900">{loan.member_name}</p>
                        <p className="mt-1 text-xs text-slate-500">{loan.loan_type || 'General'} · {loan.repayment_method || 'Not set'}</p>
                        {loan.application_snapshot && <p className="mt-1 text-xs text-slate-500">{loan.application_snapshot.phone || ''}{loan.application_snapshot.email ? ` · ${loan.application_snapshot.email}` : ''}</p>}
                      </td>
                      <td><p className="font-medium">{period(loan.repayment_period_months)}</p><p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><CalendarDays className="h-3.5 w-3.5" />{loan.due_date || 'Set on approval'}</p></td>
                      <td>{kes(loan.principal_amount)}</td>
                      <td className="text-emerald-700">{kes(loan.amount_paid)}</td>
                      <td className="font-bold">{kes(loan.outstanding_balance)}</td>
                      <td><p>Savings {kes(loan.member_savings)}</p><p className="mt-1 text-xs text-slate-500">{loan.membership_days} membership days</p></td>
                      <td><span className={`rounded-full px-2 py-1 text-xs font-bold ${loan.status === 'Rejected' ? 'bg-rose-100 text-rose-800' : 'bg-amber-50 text-amber-800'}`}>{loan.status}</span>{loan.rejection_reason && <p className="mt-2 max-w-xs text-xs leading-5 text-rose-800"><strong>Reason:</strong> {loan.rejection_reason}</p>}</td>
                      <td className="p-4">{renderActions(loan)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4">
              {loans.map(loan => (
                <article key={loan.id} className={`min-w-0 rounded-xl border p-4 ${loan.status === 'Rejected' ? 'border-rose-200 bg-rose-50/40' : 'border-slate-200 bg-white'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0"><h3 className="break-words font-black text-slate-900">{loan.member_name}</h3><p className="mt-1 text-xs text-slate-500">{loan.loan_type || 'General'} · {loan.repayment_method || 'Not set'}</p></div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-black ${loan.status === 'Rejected' ? 'bg-rose-100 text-rose-800' : isLoanAgreementAvailable(loan.status) ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{loan.status}</span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div><dt className="text-slate-500">Requested</dt><dd className="mt-1 font-bold text-slate-900">{kes(loan.principal_amount)}</dd></div>
                    <div><dt className="text-slate-500">Outstanding</dt><dd className="mt-1 font-bold text-slate-900">{kes(loan.outstanding_balance)}</dd></div>
                    <div><dt className="text-slate-500">Repayment term</dt><dd className="mt-1 font-semibold">{period(loan.repayment_period_months)}</dd></div>
                    <div><dt className="text-slate-500">Due date</dt><dd className="mt-1 font-semibold">{loan.due_date || 'After approval'}</dd></div>
                    <div><dt className="text-slate-500">Savings</dt><dd className="mt-1 font-semibold">{kes(loan.member_savings)}</dd></div>
                    <div><dt className="text-slate-500">Membership</dt><dd className="mt-1 font-semibold">{loan.membership_days} days</dd></div>
                  </dl>
                  {loan.rejection_reason && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-xs leading-5 text-rose-800"><strong>Reason:</strong> {loan.rejection_reason}</p>}
                  <div className="mt-4">{renderActions(loan)}</div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
