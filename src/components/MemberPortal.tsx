import { Download, ShieldCheck, WalletCards } from 'lucide-react';
import type { MemberPortalData } from '../types';

interface MemberPortalProps {
  data: MemberPortalData;
}

function formatKes(amount: number): string {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 2 }).format(amount);
}

export default function MemberPortal({ data }: MemberPortalProps) {
  const downloadStatement = () => {
    const lines = [
      'SACCO MEMBER STATEMENT',
      `Member: ${data.member.name}`,
      `Membership number: ${data.member.membershipNumber || 'Not assigned'}`,
      '',
      'Date,Reference,Category,Type,Amount,Vehicle',
      ...data.transactions.map(transaction => [
        transaction.timestamp.slice(0, 10),
        transaction.refCode,
        transaction.category,
        transaction.type,
        transaction.amount,
        transaction.vehiclePlate || ''
      ].map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `member-statement-${data.member.membershipNumber || 'account'}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-8 space-y-6">
      <section className="rounded-2xl bg-emerald-950 text-white p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-emerald-200 text-xs font-bold uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4" /> Read-only member account
            </div>
            <h1 className="mt-2 text-2xl font-black">Welcome, {data.member.name}</h1>
            <p className="mt-1 text-sm text-emerald-100">
              Membership no. {data.member.membershipNumber || 'Pending assignment'} · {data.member.status}
            </p>
          </div>
          <button
            type="button"
            onClick={downloadStatement}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-emerald-950 hover:bg-emerald-50"
          >
            <Download className="w-4 h-4" /> Download my statement
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          ['Savings', data.member.savingsAmount],
          ['Shares', data.member.sharesAmount],
          ['Outstanding loan', data.member.loanBalance || 0]
        ].map(([label, amount]) => (
          <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
            <p className="mt-2 text-xl font-black text-slate-900">{formatKes(Number(amount))}</p>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-black text-slate-900">My vehicles and drivers</h2>
          <div className="mt-4 space-y-3">
            {data.vehicles.length ? data.vehicles.map(vehicle => {
              const assignment = data.driverAssignments.find(item => item.vehicleId === vehicle.id && item.status === 'Active');
              return (
                <article key={vehicle.id} className="rounded-xl border border-slate-200 p-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <strong className="font-mono text-slate-900">{vehicle.plateNumber}</strong>
                    <span className="text-xs text-slate-500">{vehicle.status}</span>
                  </div>
                  <p className="mt-1 text-slate-600">{vehicle.route || 'Route not recorded'}</p>
                  <p className="mt-2 text-xs text-slate-500">Current driver: {assignment?.driverName || vehicle.driverName || 'Not assigned'}</p>
                </article>
              );
            }) : <p className="text-sm text-slate-500">No vehicles are registered to this account.</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-black text-slate-900">Loan progress</h2>
          <div className="mt-4 space-y-3">
            {data.loans.length ? data.loans.map(loan => (
              <article key={loan.id} className="rounded-xl border border-slate-200 p-4 text-sm">
                <div className="flex justify-between gap-3"><span>Principal</span><strong>{formatKes(loan.principalAmount)}</strong></div>
                <div className="mt-1 flex justify-between gap-3 text-slate-600"><span>Outstanding</span><strong>{formatKes(loan.outstandingBalance)}</strong></div>
                <p className="mt-2 text-xs text-slate-500">Issued {loan.issueDate} · {loan.status}</p>
              </article>
            )) : <p className="text-sm text-slate-500">No loan records are linked to this account.</p>}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2"><WalletCards className="w-4 h-4 text-emerald-700" /><h2 className="text-sm font-black text-slate-900">My transaction history</h2></div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[580px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500"><tr><th className="pb-3">Date</th><th className="pb-3">Reference</th><th className="pb-3">Description</th><th className="pb-3 text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.transactions.map(transaction => <tr key={transaction.id}><td className="py-3 text-slate-600">{transaction.timestamp.slice(0, 10)}</td><td className="py-3 font-mono text-xs">{transaction.refCode}</td><td className="py-3 text-slate-700">{transaction.description}</td><td className={`py-3 text-right font-bold ${transaction.type === 'Credit' ? 'text-emerald-700' : 'text-rose-700'}`}>{transaction.type === 'Credit' ? '+' : '-'}{formatKes(transaction.amount)}</td></tr>)}
              {!data.transactions.length && <tr><td colSpan={4} className="py-8 text-center text-slate-500">No transactions are linked to this account yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
