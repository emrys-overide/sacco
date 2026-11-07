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
  const todayDateString = new Date().toISOString().slice(0, 10);

  // Find latest operational date with transactions
  const latestTimestamp = transactions.reduce<string | null>((latest, t) => {
    return !latest || t.timestamp > latest ? t.timestamp : latest;
  }, null);
  const latestDateString = latestTimestamp ? latestTimestamp.slice(0, 10) : todayDateString;

  // Determine active operational date: if today has entries use today, otherwise use latest recorded day
  const hasTodayTransactions = transactions.some(t => t.timestamp.slice(0, 10) === todayDateString);
  const activeOperationalDate = hasTodayTransactions ? todayDateString : latestDateString;

  // Format label for UI display: "Today" if today, or "Nov 6" if showing latest day
  const activeDateObj = new Date(activeOperationalDate + 'T00:00:00');
  const operationalDateLabel = hasTodayTransactions
    ? 'Today'
    : activeDateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Today / Active Day credits
  const todayCredits = transactions
    .filter(t => t.type === 'Credit' && t.timestamp.slice(0, 10) === activeOperationalDate)
    .reduce((sum, t) => sum + t.amount, 0);

  // Previous operational day credits for real comparison
  const distinctDates = [...new Set(transactions.map(t => t.timestamp.slice(0, 10)))].sort();
  const activeIdx = distinctDates.indexOf(activeOperationalDate);
  const prevDate = activeIdx > 0 ? distinctDates[activeIdx - 1] : null;
  const yesterdayCredits = prevDate
    ? transactions.filter(t => t.type === 'Credit' && t.timestamp.slice(0, 10) === prevDate).reduce((sum, t) => sum + t.amount, 0)
    : 0;

  const dailyPercentChange = yesterdayCredits > 0
    ? ((todayCredits - yesterdayCredits) / yesterdayCredits) * 100
    : 0;

  // Current month credits and debits
  const currentMonthPrefix = activeOperationalDate.slice(0, 7);
  const monthToDateCredits = transactions
    .filter(t => t.type === 'Credit' && t.timestamp.slice(0, 7) === currentMonthPrefix)
    .reduce((sum, t) => sum + t.amount, 0);

  const monthToDateDebits = transactions
    .filter(t => t.type === 'Debit' && t.timestamp.slice(0, 7) === currentMonthPrefix)
    .reduce((sum, t) => sum + t.amount, 0);

  // All-time totals across entire ledger
  const allTimeCredits = transactions
    .filter(t => t.type === 'Credit')
    .reduce((sum, t) => sum + t.amount, 0);

  const allTimeDebits = transactions
    .filter(t => t.type === 'Debit')
    .reduce((sum, t) => sum + t.amount, 0);

  // Operations account (VehicleTill) net balance: Credits minus Debits
  const operationsAccountBalance = transactions
    .filter(t => t.tillNumber === 'VehicleTill')
    .reduce((sum, t) => sum + (t.type === 'Credit' ? t.amount : -t.amount), 0);

  const utilityTillCredits = transactions
    .filter(t => t.tillNumber === 'UtilityTill' && t.type === 'Credit')
    .reduce((sum, t) => sum + t.amount, 0);

  // Recent 7-day weekly metrics
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
    todayCredits,
    operationalDateLabel,
    activeOperationalDate,
    yesterdayCredits,
    dailyPercentChange,
    monthToDateCredits,
    monthToDateDebits,
    allTimeCredits,
    allTimeDebits,
    operationsAccountBalance,
    utilityTillCredits,
    totalCredits: allTimeCredits, // Backwards compatibility
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
