import type { Member, Transaction } from '../types';

export const SOWETAMU_AUDIT_REFERENCE = {
  saccoName: 'SOWETAMU SAVINGS & CREDIT',
  regNo: 'CS/NO. 22239',
  year: '2024',
  auditFee: 25500,
  members: { active: 17, dormant: 11, total: 28 },
  financials: {
    membersDeposits: 194250,
    statutoryReserve: -10483.85,
    retainedEarnings: -41935.40,
    totalAssets: 621830.75,
    loansToMembers: 171740,
    cashAndEquiv: 138990.75,
    otherReceivables: 138850,
    ppeCarrying: 172250,
    tradePayables: 45000,
    totalLiabilities: 239250,
    netSurplus: -52419.25,
    revenue: 6977416
  }
} as const;

function tillSummary(transactions: Transaction[], tillNumber: Transaction['tillNumber']) {
  const entries = transactions.filter(transaction => transaction.tillNumber === tillNumber);
  const credits = entries.filter(transaction => transaction.type === 'Credit').reduce((sum, transaction) => sum + transaction.amount, 0);
  const debits = entries.filter(transaction => transaction.type === 'Debit').reduce((sum, transaction) => sum + transaction.amount, 0);
  return { entries, credits, debits, net: credits - debits };
}

export function calculateReportFinancials(transactions: Transaction[], members: Member[]) {
  const totalCredits = transactions.filter(transaction => transaction.type === 'Credit').reduce((sum, transaction) => sum + transaction.amount, 0);
  const totalDebits = transactions.filter(transaction => transaction.type === 'Debit').reduce((sum, transaction) => sum + transaction.amount, 0);
  const netBalance = totalCredits - totalDebits;
  const vehicle = tillSummary(transactions, 'VehicleTill');
  const utility = tillSummary(transactions, 'UtilityTill');
  const cash = tillSummary(transactions, 'None');
  const categorySummary = transactions.reduce<Record<string, number>>((summary, transaction) => {
    summary[transaction.category] = (summary[transaction.category] || 0) + transaction.amount;
    return summary;
  }, {});
  const activeCount = members.filter(member => member.status === 'Active').length;
  const memberDeposits = members.reduce((sum, member) => sum + Number(member.savingsAmount || 0), 0);
  const ppeCarrying = transactions
    .filter(transaction => transaction.category === 'Equipment')
    .reduce((sum, transaction) => sum + (transaction.type === 'Debit' ? transaction.amount : -transaction.amount), 0);

  return {
    totalCredits,
    totalDebits,
    netBalance,
    vehicle,
    utility,
    cash,
    categorySummary,
    liveMembers: { active: activeCount, dormant: members.length - activeCount, total: members.length },
    liveFinancials: {
      membersDeposits: memberDeposits,
      statutoryReserve: 0,
      retainedEarnings: 0,
      totalAssets: netBalance + ppeCarrying,
      loansToMembers: 0,
      cashAndEquiv: netBalance,
      otherReceivables: 0,
      ppeCarrying,
      tradePayables: 0,
      totalLiabilities: memberDeposits,
      netSurplus: netBalance,
      revenue: totalCredits
    }
  };
}
