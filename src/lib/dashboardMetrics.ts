import type { Member, Transaction, Vehicle } from '../types';

export function getRecentDailySeries(
  transactions: Transaction[],
  include: (transaction: Transaction) => boolean,
  days: number
) {
  const latestTimestamp = transactions.reduce<string | null>((latest, transaction) => {
    return !latest || transaction.timestamp > latest ? transaction.timestamp : latest;
  }, null);
  const baseDate = latestTimestamp ? new Date(latestTimestamp) : new Date();
  const series: { dateString: string; label: string; amount: number }[] = [];

  for (let index = days - 1; index >= 0; index--) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() - index);
    const dateString = date.toISOString().slice(0, 10);
    series.push({
      dateString,
      label: date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' }),
      amount: transactions
        .filter(transaction => include(transaction) && transaction.timestamp.slice(0, 10) === dateString)
        .reduce((sum, transaction) => sum + transaction.amount, 0)
    });
  }
  return series;
}

export function calculateDashboardMetrics(transactions: Transaction[], vehicles: Vehicle[], members: Member[]) {
  const recentWeekDates = new Set(getRecentDailySeries(transactions, () => true, 7).map(day => day.dateString));
  const weeklyCreditTotal = getRecentDailySeries(transactions, transaction => transaction.type === 'Credit', 7)
    .reduce((sum, day) => sum + day.amount, 0);
  const weeklySavings = transactions
    .filter(transaction => transaction.type === 'Credit' && (transaction.savingsContribution !== undefined || transaction.category === 'Savings Contribution'))
    .filter(transaction => recentWeekDates.has(transaction.timestamp.slice(0, 10)))
    .reduce((sum, transaction) => sum + (transaction.category === 'Savings Contribution' ? transaction.amount : Number(transaction.savingsContribution || 0)), 0);
  const weeklyLoanRepayments = transactions
    .filter(transaction => transaction.type === 'Credit' && transaction.loanRepay !== undefined)
    .filter(transaction => recentWeekDates.has(transaction.timestamp.slice(0, 10)))
    .reduce((sum, transaction) => sum + Number(transaction.loanRepay || 0), 0);

  return {
    totalCredits: transactions.filter(transaction => transaction.type === 'Credit').reduce((sum, transaction) => sum + transaction.amount, 0),
    activeFleetCount: vehicles.filter(vehicle => vehicle.status === 'Active').length,
    pendingMembersCount: members.filter(member => member.status === 'Pending').length,
    totalMpesaDeposits: transactions
      .filter(transaction => transaction.type === 'Credit' && transaction.refCode.toUpperCase().startsWith('Q'))
      .reduce((sum, transaction) => sum + transaction.amount, 0),
    fleetSparkData: getRecentDailySeries(transactions, transaction => transaction.type === 'Credit' && transaction.tillNumber === 'VehicleTill', 6).map(day => day.amount),
    utilitySparkData: getRecentDailySeries(transactions, transaction => transaction.type === 'Credit' && transaction.tillNumber === 'UtilityTill', 6).map(day => day.amount),
    weeklySavings,
    weeklyLoanRepayments,
    savingsShare: weeklyCreditTotal > 0 ? Math.min(100, (weeklySavings / weeklyCreditTotal) * 100) : 0,
    loanRepaymentShare: weeklyCreditTotal > 0 ? Math.min(100, (weeklyLoanRepayments / weeklyCreditTotal) * 100) : 0,
    ledgerEntryCount: transactions.length
  };
}
