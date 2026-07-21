import React, { useEffect, useRef, useState } from 'react';
import {
  BadgeCheck, Bus, Camera, Download, KeyRound, Landmark, Mail, Phone,
  ReceiptText, RotateCcw, Settings, ShieldCheck, UserRound, WalletCards
} from 'lucide-react';
import type { MemberLoanSummary, MemberPortalData } from '../types';
import { fetchSaccoJson, postSaccoJson } from '../lib/api';

interface MemberPortalProps {
  data: MemberPortalData;
  token: string;
  onApplicationCreated: () => void | Promise<void>;
}

const repaymentPeriods = [1, 2, 3, 6, 9, 12, 18, 24, 36, 48, 60, 72, 84];
const loanTypes = ['General', 'Emergency', 'Development', 'Education', 'Business', 'Vehicle'];
const repaymentMethods = ['SACCO collection', 'Salary deduction', 'Bank standing order', 'Mobile money', 'Other'];

function formatKes(amount: number): string {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 2 }).format(amount);
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'M';
}

function formatPeriod(months?: number) {
  if (!months) return 'Not set';
  if (months % 12 === 0) return `${months / 12} ${months === 12 ? 'year' : 'years'}`;
  return `${months} ${months === 1 ? 'month' : 'months'}`;
}

function loanIsOpen(status: string) {
  return ['Applied', 'SecretaryReview', 'TreasurerReview', 'ChairmanReview', 'Approved', 'Active', 'Defaulted'].includes(status);
}

export default function MemberPortal({ data, token, onApplicationCreated }: MemberPortalProps) {
  const [amount, setAmount] = useState('');
  const [loanType, setLoanType] = useState('General');
  const [repaymentPeriodMonths, setRepaymentPeriodMonths] = useState('12');
  const [repaymentMethod, setRepaymentMethod] = useState('SACCO collection');
  const [incomeSource, setIncomeSource] = useState('');
  const [monthlyIncome, setMonthlyIncome] = useState('');
  const [guarantorDetails, setGuarantorDetails] = useState('');
  const [collateralDetails, setCollateralDetails] = useState('');
  const [notes, setNotes] = useState('');
  const [loanMessage, setLoanMessage] = useState('');
  const [settingsEmail, setSettingsEmail] = useState(data.profile.email);
  const [profilePhotoData, setProfilePhotoData] = useState<string | undefined>(data.profile.profilePhotoData);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSettingsEmail(data.profile.email);
    setProfilePhotoData(data.profile.profilePhotoData);
  }, [data.profile.email, data.profile.profilePhotoData]);

  const refresh = async () => { await onApplicationCreated(); };

  const applyForLoan = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoanMessage('');
    try {
      await postSaccoJson('/api/loans', {
        principalAmount: Number(amount), loanType, repaymentPeriodMonths: Number(repaymentPeriodMonths),
        repaymentMethod, incomeSource, monthlyIncome: monthlyIncome === '' ? null : Number(monthlyIncome),
        guarantorDetails, collateralDetails, notes
      }, token);
      setAmount(''); setIncomeSource(''); setMonthlyIncome(''); setGuarantorDetails(''); setCollateralDetails(''); setNotes('');
      setLoanMessage('Application submitted. The Secretary will review eligibility first, then the Treasurer and Chairman.');
      await refresh();
    } catch (error) {
      setLoanMessage(error instanceof Error ? error.message : 'Application could not be submitted.');
    }
  };

  const prepareReapplication = (loan: MemberLoanSummary) => {
    setAmount(String(loan.principalAmount));
    setLoanType(loan.loanType || 'General');
    setRepaymentPeriodMonths(String(loan.repaymentPeriodMonths || 12));
    setRepaymentMethod(loan.repaymentMethod || 'SACCO collection');
    setIncomeSource(loan.incomeSource || '');
    setMonthlyIncome(loan.monthlyIncome == null ? '' : String(loan.monthlyIncome));
    setGuarantorDetails(loan.guarantorDetails || '');
    setCollateralDetails(loan.collateralDetails || '');
    setNotes(loan.notes || '');
    setLoanMessage('The rejected application details have been copied below. Update anything that has changed, then submit a new application.');
    document.getElementById('member-loan-application')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setSettingsMessage('');
    try {
      await fetchSaccoJson('/api/member-portal/profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: settingsEmail, profilePhotoData: profilePhotoData || null })
      }, token);
      setSettingsMessage('Your contact email and profile photo have been updated.');
      await refresh();
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : 'Profile could not be updated.');
    }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setSettingsMessage('');
    if (newPassword !== confirmPassword) {
      setSettingsMessage('The new password and confirmation do not match.');
      return;
    }
    try {
      await postSaccoJson('/api/member-portal/change-password', { currentPassword, newPassword }, token);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setSettingsMessage('Your password has been changed.');
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : 'Password could not be changed.');
    }
  };

  const choosePhoto = (file?: File) => {
    setSettingsMessage('');
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 180 * 1024) {
      setSettingsMessage('Choose a PNG, JPEG, or WebP image that is 180 KB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setProfilePhotoData(typeof reader.result === 'string' ? reader.result : undefined);
    reader.readAsDataURL(file);
  };

  const downloadStatement = () => {
    const lines = [
      'SACCO MEMBER STATEMENT', `Member: ${data.member.name}`,
      `Membership number: ${data.member.membershipNumber || 'Not assigned'}`, '',
      'Date,Reference,Category,Type,Amount,Vehicle',
      ...data.transactions.map(transaction => [
        transaction.timestamp.slice(0, 10), transaction.refCode, transaction.category, transaction.type,
        transaction.amount, transaction.vehiclePlate || ''
      ].map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `member-statement-${data.member.membershipNumber || 'account'}.csv`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };

  const downloadReceipt = (transaction: MemberPortalData['transactions'][number]) => {
    const receipt = [
      'SOWETAMU SACCO — MEMBER TRANSACTION RECEIPT', '', `Receipt reference: ${transaction.refCode}`,
      `Date: ${transaction.timestamp.slice(0, 10)}`, `Member: ${data.profile.fullName}`,
      `Description: ${transaction.description}`, `Category: ${transaction.category}`,
      `Transaction: ${transaction.type}`, `Amount: ${formatKes(transaction.amount)}`,
      `Vehicle: ${transaction.vehiclePlate || 'Not linked'}`
    ].join('\n');
    const blob = new Blob([receipt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `receipt-${transaction.refCode || transaction.id}.txt`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };

  const hasOpenLoan = data.loans.some(loan => loanIsOpen(loan.status));

  return (
    <main className="flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-950 via-emerald-800 to-teal-700 p-6 text-white shadow-xl shadow-emerald-950/15 sm:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <button type="button" onClick={() => photoInput.current?.click()} className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-3xl border-2 border-white/30 bg-white/15 text-xl font-black text-white">
                {profilePhotoData ? <img src={profilePhotoData} alt="Your profile" className="h-full w-full object-cover" /> : initials(data.profile.fullName)}
                <span className="absolute bottom-0 right-0 rounded-tl-xl bg-white p-1.5 text-emerald-800"><Camera className="h-3.5 w-3.5" /></span>
              </button>
              <input ref={photoInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => choosePhoto(event.target.files?.[0])} />
              <div>
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-emerald-200"><ShieldCheck className="h-4 w-4" /> My SACCO account</p>
                <h1 className="mt-2 text-2xl font-black sm:text-3xl">Welcome back, {data.profile.fullName}</h1>
                <p className="mt-1 text-sm text-emerald-100">Membership no. {data.profile.membershipNumber || 'Pending assignment'} · {data.member.status}</p>
              </div>
            </div>
            <button type="button" onClick={downloadStatement} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-xs font-bold uppercase tracking-wider text-emerald-950 hover:bg-emerald-50"><Download className="h-4 w-4" /> Download statement</button>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            ['Savings', data.member.savingsAmount, WalletCards],
            ['Shares', data.member.sharesAmount, BadgeCheck],
            ['Outstanding loan', data.member.loanBalance || 0, Landmark]
          ].map(([label, amount, Icon]) => {
            const MetricIcon = Icon as typeof WalletCards;
            return <article key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p><MetricIcon className="h-4 w-4 text-emerald-700" /></div><p className="mt-3 text-2xl font-black text-slate-900">{formatKes(Number(amount))}</p></article>;
          })}
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-1"><div className="flex items-center gap-2"><UserRound className="h-4 w-4 text-emerald-700" /><h2 className="font-black text-slate-900">My profile</h2></div><dl className="mt-4 space-y-3 text-sm"><div><dt className="text-xs font-bold uppercase tracking-wider text-slate-400">National ID</dt><dd className="mt-1 font-semibold text-slate-800">{data.profile.nationalId || 'Not recorded'}</dd></div><div><dt className="text-xs font-bold uppercase tracking-wider text-slate-400">Phone</dt><dd className="mt-1 flex items-center gap-2 font-semibold text-slate-800"><Phone className="h-3.5 w-3.5 text-emerald-700" />{data.profile.phone || 'Not recorded'}</dd></div><div><dt className="text-xs font-bold uppercase tracking-wider text-slate-400">Email</dt><dd className="mt-1 flex items-center gap-2 break-all font-semibold text-slate-800"><Mail className="h-3.5 w-3.5 shrink-0 text-emerald-700" />{data.profile.email || 'Not recorded'}</dd></div></dl></article>
          <article className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-2"><div className="flex items-center gap-2"><Bus className="h-4 w-4 text-emerald-700" /><h2 className="font-black text-slate-900">My vehicles and drivers</h2></div><div className="mt-4 grid gap-3 md:grid-cols-2">{data.vehicles.length ? data.vehicles.map(vehicle => { const assignment = data.driverAssignments.find(item => item.vehicleId === vehicle.id && item.status === 'Active'); return <article key={vehicle.id} className="rounded-xl border border-slate-200 p-4 text-sm"><div className="flex items-center justify-between gap-3"><strong className="font-mono text-slate-900">{vehicle.plateNumber}</strong><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{vehicle.status}</span></div><p className="mt-2 text-slate-600">{vehicle.route || 'Route not recorded'}</p><p className="mt-3 text-xs text-slate-500">Current driver: {assignment?.driverName || vehicle.driverName || 'Not assigned'}</p></article>; }) : <p className="text-sm text-slate-500">No vehicles are registered to this account.</p>}</div></article>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><Landmark className="h-4 w-4 text-emerald-700" /><h2 className="font-black text-slate-900">Loan progress</h2></div><div className="mt-4 grid gap-3 lg:grid-cols-2">{data.loans.length ? data.loans.map(loan => <article key={loan.id} className={`rounded-xl border p-4 text-sm ${loan.status === 'Rejected' ? 'border-rose-200 bg-rose-50/40' : 'border-slate-200'}`}><div className="flex flex-wrap items-center justify-between gap-2"><strong>{loan.loanType || 'Loan'} loan</strong><span className={`rounded-full px-2 py-1 text-xs font-bold ${loan.status === 'Rejected' ? 'bg-rose-100 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>{loan.status}</span></div><div className="mt-3 grid grid-cols-2 gap-3 text-xs"><p><span className="block text-slate-500">Principal</span><strong>{formatKes(loan.principalAmount)}</strong></p><p><span className="block text-slate-500">Paid so far</span><strong>{formatKes(loan.amountPaid || 0)}</strong></p><p><span className="block text-slate-500">Outstanding</span><strong>{formatKes(loan.outstandingBalance)}</strong></p><p><span className="block text-slate-500">Repayment period</span><strong>{formatPeriod(loan.repaymentPeriodMonths)}</strong></p></div><p className="mt-3 text-xs text-slate-500">{loan.dueDate ? `Due ${loan.dueDate}` : 'Due date will be set when the Chairman approves and disburses the loan.'}</p>{loan.rejectionReason && <div className="mt-3 rounded-lg border border-rose-200 bg-white p-3 text-xs text-rose-900"><strong>Reason for rejection:</strong> {loan.rejectionReason}</div>}{loan.status === 'Rejected' && <button type="button" onClick={() => prepareReapplication(loan)} className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700"><RotateCcw className="h-3.5 w-3.5" /> Reapply using these details</button>}</article>) : <p className="text-sm text-slate-500">No loan records are linked to this account.</p>}</div></section>

        <section id="member-loan-application" className="rounded-2xl border border-emerald-200 bg-white p-5"><h2 className="font-black text-slate-900">{hasOpenLoan ? 'Loan application unavailable' : 'Apply for a loan'}</h2><p className="mt-1 text-xs leading-5 text-slate-500">Your registered personal details are included from your SACCO record. The purpose is optional; the amount, loan type, repayment period, and repayment method are required.</p><div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 text-xs text-slate-600 sm:grid-cols-2 lg:grid-cols-4"><p><strong className="block text-slate-800">Applicant</strong>{data.profile.fullName}</p><p><strong className="block text-slate-800">National ID</strong>{data.profile.nationalId || 'Not recorded'}</p><p><strong className="block text-slate-800">Phone</strong>{data.profile.phone || 'Not recorded'}</p><p><strong className="block text-slate-800">Email</strong>{data.profile.email || 'Not recorded'}</p></div>{hasOpenLoan ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">You already have a pending or active loan. Once a loan is rejected or cleared, you may submit another application.</p> : <form onSubmit={applyForLoan} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><label className="text-xs font-bold text-slate-600">Loan type<select value={loanType} onChange={event => setLoanType(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm">{loanTypes.map(type => <option key={type}>{type}</option>)}</select></label><label className="text-xs font-bold text-slate-600">Amount requested (KES)<input type="number" min="1" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm" required /></label><label className="text-xs font-bold text-slate-600">Repayment period<select value={repaymentPeriodMonths} onChange={event => setRepaymentPeriodMonths(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm">{repaymentPeriods.map(months => <option key={months} value={months}>{formatPeriod(months)}</option>)}</select></label><label className="text-xs font-bold text-slate-600">Repayment method<select value={repaymentMethod} onChange={event => setRepaymentMethod(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm">{repaymentMethods.map(method => <option key={method}>{method}</option>)}</select></label><label className="text-xs font-bold text-slate-600">Income / business source <span className="font-medium text-slate-400">(optional)</span><input value={incomeSource} onChange={event => setIncomeSource(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm" placeholder="e.g. vehicle operations" /></label><label className="text-xs font-bold text-slate-600">Estimated monthly income <span className="font-medium text-slate-400">(optional)</span><input type="number" min="0" step="0.01" value={monthlyIncome} onChange={event => setMonthlyIncome(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm" /></label><label className="text-xs font-bold text-slate-600 sm:col-span-2 lg:col-span-3">Guarantor details <span className="font-medium text-slate-400">(optional — names, member numbers, and contact details)</span><textarea value={guarantorDetails} onChange={event => setGuarantorDetails(event.target.value)} className="mt-1.5 min-h-20 w-full rounded-xl border px-3 py-2.5 text-sm" placeholder="List proposed guarantors if SACCO policy requires them. This does not replace their formal consent." /></label><label className="text-xs font-bold text-slate-600 sm:col-span-2 lg:col-span-3">Additional security / collateral <span className="font-medium text-slate-400">(optional)</span><textarea value={collateralDetails} onChange={event => setCollateralDetails(event.target.value)} className="mt-1.5 min-h-20 w-full rounded-xl border px-3 py-2.5 text-sm" placeholder="Describe any proposed security for review." /></label><label className="text-xs font-bold text-slate-600 sm:col-span-2 lg:col-span-3">Purpose / additional notes <span className="font-medium text-slate-400">(optional)</span><textarea value={notes} onChange={event => setNotes(event.target.value)} className="mt-1.5 min-h-20 w-full rounded-xl border px-3 py-2.5 text-sm" placeholder="Briefly explain the loan purpose or any helpful details." /></label><button className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white sm:col-span-2 lg:col-span-3">Submit loan application</button></form>}{loanMessage && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">{loanMessage}</p>}</section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-5"><article className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-3"><div className="flex items-center gap-2"><WalletCards className="h-4 w-4 text-emerald-700" /><h2 className="font-black text-slate-900">My transactions and receipts</h2></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[660px] text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500"><tr><th className="pb-3">Date</th><th className="pb-3">Reference</th><th className="pb-3">Description</th><th className="pb-3 text-right">Amount</th><th className="pb-3"></th></tr></thead><tbody className="divide-y divide-slate-100">{data.transactions.map(transaction => <tr key={transaction.id}><td className="py-3 text-slate-600">{transaction.timestamp.slice(0, 10)}</td><td className="py-3 font-mono text-xs">{transaction.refCode}</td><td className="py-3 text-slate-700">{transaction.description}</td><td className={`py-3 text-right font-bold ${transaction.type === 'Credit' ? 'text-emerald-700' : 'text-rose-700'}`}>{transaction.type === 'Credit' ? '+' : '-'}{formatKes(transaction.amount)}</td><td className="py-3 text-right"><button type="button" onClick={() => downloadReceipt(transaction)} className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><ReceiptText className="h-3.5 w-3.5" /> Receipt</button></td></tr>)}{!data.transactions.length && <tr><td colSpan={5} className="py-8 text-center text-slate-500">No transactions are linked to this account yet.</td></tr>}</tbody></table></div></article>
          <aside className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-2"><div className="flex items-center gap-2"><Settings className="h-4 w-4 text-emerald-700" /><h2 className="font-black text-slate-900">Account settings</h2></div><form className="mt-4 space-y-3" onSubmit={saveProfile}><label className="block text-xs font-bold text-slate-600">Contact email<input type="email" value={settingsEmail} onChange={event => setSettingsEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm" required /></label><div><p className="text-xs font-bold text-slate-600">Profile photo</p><div className="mt-1.5 flex gap-2"><button type="button" onClick={() => photoInput.current?.click()} className="rounded-xl border px-3 py-2 text-xs font-bold text-slate-700">Choose photo</button>{profilePhotoData && <button type="button" onClick={() => setProfilePhotoData(undefined)} className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700">Remove</button>}</div></div><button className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-bold text-emerald-800">Save profile</button></form><form className="mt-6 space-y-3 border-t border-slate-100 pt-5" onSubmit={changePassword}><div className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-emerald-700" /><h3 className="text-sm font-black text-slate-900">Change password</h3></div><input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} className="w-full rounded-xl border px-3 py-2.5 text-sm" placeholder="Current password" required /><input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} className="w-full rounded-xl border px-3 py-2.5 text-sm" placeholder="New password (at least 8 characters)" minLength={8} required /><input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} className="w-full rounded-xl border px-3 py-2.5 text-sm" placeholder="Confirm new password" minLength={8} required /><button className="w-full rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-bold text-white">Change password</button></form>{settingsMessage && <p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">{settingsMessage}</p>}</aside></section>
      </div>
    </main>
  );
}
