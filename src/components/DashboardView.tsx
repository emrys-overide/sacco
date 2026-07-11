import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Transaction, Vehicle, Member, UserRole, VehicleClass } from '../types';
import { PlusCircle, Search, FileDown, ShieldCheck, DollarSign, Activity, AlertCircle, ArrowUpRight, CheckCircle2, Sparkles, Minimize2, Maximize2, LayoutDashboard } from 'lucide-react';
import { sanitizeDecimalInput, sanitizePersonName, sanitizeVehiclePlate } from '../lib/inputValidation';
import { isExpenseTransactionCategory, requiresRegisteredMember } from '../lib/transactionPolicy';

interface SparklineProps {
  data: number[];
  color: string;
}

function Sparkline({ data, color }: SparklineProps) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * 100;
    const y = 28 - ((val - min) / range) * 20; // 30px height bounding box
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg className="w-16 h-8 overflow-visible shrink-0 opacity-80" viewBox="0 0 100 30">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

interface SaccoAnalyticsChartProps {
  transactions: Transaction[];
}

function getRecentDailySeries(
  transactions: Transaction[],
  include: (transaction: Transaction) => boolean,
  days: number
) {
  const latestTimestamp = transactions.reduce<string | null>((latest, transaction) => {
    return !latest || transaction.timestamp > latest ? transaction.timestamp : latest;
  }, null);
  const baseDate = latestTimestamp ? new Date(latestTimestamp) : new Date();
  const series = [] as { dateString: string; label: string; amount: number }[];

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

function SaccoAnalyticsChart({ transactions }: SaccoAnalyticsChartProps) {
  const chartData = getRecentDailySeries(transactions, transaction => transaction.type === 'Credit', 7);
  const hasActivity = chartData.some(day => day.amount > 0);
  const maxVal = Math.max(...chartData.map(day => day.amount), 1) * 1.15;
  const minVal = 0;
  const range = maxVal - minVal;

  const width = 800;
  const height = 240;
  const paddingLeft = 55;
  const paddingRight = 30;
  const paddingTop = 20;
  const paddingBottom = 40;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const points = chartData.map((d, i) => {
    const x = paddingLeft + (i / (chartData.length - 1)) * chartWidth;
    const y = paddingTop + chartHeight - ((d.amount - minVal) / range) * chartHeight;
    return { x, y, label: d.label, amount: d.amount };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = points.length > 0 
    ? `${linePath} L ${points[points.length - 1].x} ${paddingTop + chartHeight} L ${points[0].x} ${paddingTop + chartHeight} Z`
    : '';

  return (
    <div className="dashboard-panel bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-[0_4px_30px_rgba(0,0,0,0.015)] flex flex-col justify-between h-full hover:shadow-md transition-all duration-300">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider font-display">Sacco Cash Collection Flow</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">Recorded credit collections for the most recent 7-day period</p>
        </div>
        <div className="flex items-center space-x-4 text-[10px] font-mono">
          <span className="flex items-center text-blue-600 font-bold">
            <span className="w-2 h-2 rounded-full bg-blue-500 mr-1.5 animate-pulse"></span>
            Recorded collections
          </span>
        </div>
      </div>

      <div className="relative flex-1 w-full min-h-[220px]">
        <svg className="w-full h-full min-h-[220px]" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Dotted horizontal grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
            const y = paddingTop + ratio * chartHeight;
            const labelValue = Math.round(maxVal - ratio * range);
            return (
              <g key={idx}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={width - paddingRight}
                  y2={y}
                  stroke="#f1f5f9"
                  strokeDasharray="4 4"
                  strokeWidth="1.5"
                />
                <text
                  x={paddingLeft - 10}
                  y={y + 3}
                  fill="#94a3b8"
                  fontSize="9"
                  fontFamily="monospace"
                  textAnchor="end"
                >
                  {labelValue >= 1000 ? `${(labelValue / 1000).toFixed(1)}k` : labelValue}
                </text>
              </g>
            );
          })}

          {/* Area under curve with gradient fill */}
          {areaPath && <path d={areaPath} fill="url(#chartGlow)" />}

          {/* Core Curve Line */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="#2563eb"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Data Points on Curve */}
          {points.map((p, idx) => (
            <g key={idx} className="group cursor-pointer">
              <circle
                cx={p.x}
                cy={p.y}
                r="4.5"
                fill="#ffffff"
                stroke="#2563eb"
                strokeWidth="2.5"
              />
              <circle
                cx={p.x}
                cy={p.y}
                r="10"
                fill="#2563eb"
                fillOpacity="0"
                className="hover:fill-opacity-15 transition-all duration-200"
              />
            </g>
          ))}

          {/* X Axis Labels */}
          {points.map((p, idx) => (
            <text
              key={idx}
              x={p.x}
              y={height - paddingBottom + 18}
              fill="#94a3b8"
              fontSize="9"
              fontFamily="monospace"
              fontWeight="medium"
              textAnchor="middle"
            >
              {p.label}
            </text>
          ))}
        </svg>
        {!hasActivity && (
          <div className="absolute inset-0 flex items-center justify-center text-center pointer-events-none">
            <span className="rounded-full bg-white/80 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">No recorded collections yet</span>
          </div>
        )}
      </div>
    </div>
  );
}

interface DashboardViewProps {
  transactions: Transaction[];
  vehicles: Vehicle[];
  members: Member[];
  onAddTransaction: (newTx: Omit<Transaction, 'id' | 'timestamp' | 'recorderName'>) => void;
  currentUserRole: UserRole;
  currentUserName: string;
  onNavigateToTab: (tab: string) => void;
}

export default function DashboardView({
  transactions,
  vehicles,
  members,
  onAddTransaction,
  currentUserRole,
  currentUserName,
  onNavigateToTab
}: DashboardViewProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [error, setError] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);

  // Form State
  const [memberId, setMemberId] = useState('');
  const [personName, setPersonName] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [category, setCategory] = useState<'Daily Contribution' | 'Registration Fee' | 'Management Fee' | 'Office Expenses' | 'Petty Cash' | 'Penalty' | 'Utilities' | 'Equipment'>('Daily Contribution');
  const [type, setType] = useState<'Credit' | 'Debit'>('Credit');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [tillNumber, setTillNumber] = useState<'VehicleTill' | 'UtilityTill' | 'None'>('VehicleTill');
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>('Nissan');
  const [operationAmount, setOperationAmount] = useState('');
  const [entranceFee, setEntranceFee] = useState('');
  const [loanRepay, setLoanRepay] = useState('');
  const [savingsContribution, setSavingsContribution] = useState('');
  const [sTicket, setSTicket] = useState('');
  const [legalFee, setLegalFee] = useState('');
  const [expenseDeduction, setExpenseDeduction] = useState('');

  const dailyGrossAmount = [operationAmount, entranceFee, loanRepay, savingsContribution, sTicket, legalFee]
    .reduce((sum, value) => sum + (Number(value) || 0), 0);
  const dailyNetAmount = Math.max(0, dailyGrossAmount - (Number(expenseDeduction) || 0));
  const isExpenseEntry = isExpenseTransactionCategory(category);
  const activeVehicles = vehicles.filter(vehicle => vehicle.status === 'Active');

  // Calculations
  const todayCredits = transactions
    .filter(t => t.type === 'Credit')
    .reduce((acc, t) => acc + t.amount, 0);

  const activeFleetCount = vehicles.filter(v => v.status === 'Active').length;
  const pendingMembersCount = members.filter(m => m.status === 'Pending').length;

  const totalMpesaDeposits = transactions
    .filter(t => t.type === 'Credit' && t.refCode.toUpperCase().startsWith('Q'))
    .reduce((acc, t) => acc + t.amount, 0);

  const fleetSparkData = getRecentDailySeries(transactions, transaction => transaction.type === 'Credit' && transaction.tillNumber === 'VehicleTill', 6)
    .map(day => day.amount);
  const utilitySparkData = getRecentDailySeries(transactions, transaction => transaction.type === 'Debit' && transaction.tillNumber === 'UtilityTill', 6)
    .map(day => day.amount);
  const recentWeekDates = new Set(getRecentDailySeries(transactions, () => true, 7).map(day => day.dateString));
  const weeklyCreditTotal = getRecentDailySeries(transactions, transaction => transaction.type === 'Credit', 7).reduce((sum, day) => sum + day.amount, 0);
  const weeklySavings = transactions
    .filter(transaction => transaction.type === 'Credit' && transaction.savingsContribution !== undefined)
    .filter(transaction => recentWeekDates.has(transaction.timestamp.slice(0, 10)))
    .reduce((sum, transaction) => sum + Number(transaction.savingsContribution || 0), 0);
  const weeklyLoanRepayments = transactions
    .filter(transaction => transaction.type === 'Credit' && transaction.loanRepay !== undefined)
    .filter(transaction => recentWeekDates.has(transaction.timestamp.slice(0, 10)))
    .reduce((sum, transaction) => sum + Number(transaction.loanRepay || 0), 0);
  const savingsShare = weeklyCreditTotal > 0 ? Math.min(100, (weeklySavings / weeklyCreditTotal) * 100) : 0;
  const loanRepaymentShare = weeklyCreditTotal > 0 ? Math.min(100, (weeklyLoanRepayments / weeklyCreditTotal) * 100) : 0;
  const ledgerEntryCount = transactions.length;

  // Auto set Type & Till depending on category
  const handleCategoryChange = (cat: typeof category) => {
    setCategory(cat);
    if (isExpenseTransactionCategory(cat)) {
      setType('Debit');
      setTillNumber('UtilityTill');
      setMemberId('');
      setVehiclePlate('');
    } else {
      setType('Credit');
      setTillNumber('VehicleTill');
    }
  };

  const handleCreateTx = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const transactionAmount = category === 'Daily Contribution' ? dailyNetAmount : Number(amount);
    if (transactionAmount <= 0) {
      setError('Amount must be a positive number greater than zero.');
      return;
    }

    const normalizedVehiclePlate = vehiclePlate.trim().toUpperCase();
    const matchedMember = members.find(member =>
      member.status === 'Active' && member.name.trim().toLowerCase() === personName.trim().toLowerCase()
    );
    const matchedVehicle = normalizedVehiclePlate
      ? vehicles.find(v => v.plateNumber.replace(/\s+/g, '').toUpperCase() === normalizedVehiclePlate.replace(/\s+/g, ''))
      : undefined;
    if (requiresRegisteredMember(category)) {
      if (!matchedMember) {
        setError(`Name "${personName.trim() || 'blank'}" is not registered. Register the member first.`);
        return;
      }
      if (normalizedVehiclePlate && !matchedVehicle) {
        setError(`Car/V.REG "${normalizedVehiclePlate}" is not registered. Onboard the vehicle first.`);
        return;
      }
      if (matchedVehicle && matchedVehicle.ownerId !== matchedMember.id) {
        setError(`Car/V.REG "${matchedVehicle.plateNumber}" is not registered under ${matchedMember.name}.`);
        return;
      }
      if (matchedVehicle && matchedVehicle.status !== 'Active') {
        setError(`Car/V.REG "${matchedVehicle.plateNumber}" is not active.`);
        return;
      }
    }
    const automaticRefCode = `SWT-MAN-${Date.now()}`;
    
    onAddTransaction({
      memberId: isExpenseEntry ? undefined : matchedMember?.id,
      memberName: personName.trim() || matchedMember?.name || undefined,
      vehiclePlate: isExpenseEntry ? undefined : normalizedVehiclePlate,
      category,
      type,
      amount: transactionAmount,
      refCode: automaticRefCode,
      description: description.trim() || (category === 'Daily Contribution'
        ? `${vehicleClass} daily collection: gross KES ${dailyGrossAmount}, deductions KES ${Number(expenseDeduction) || 0}`
        : `${category} recorded for ${matchedMember ? matchedMember.name : 'Sacco Office'}`),
      tillNumber: tillNumber,
      ...(category === 'Daily Contribution' ? {
        vehicleClass,
        operationAmount: Number(operationAmount) || 0,
        entranceFee: Number(entranceFee) || 0,
        loanRepay: Number(loanRepay) || 0,
        savingsContribution: Number(savingsContribution) || 0,
        sTicket: Number(sTicket) || 0,
        legalFee: Number(legalFee) || 0,
        expenseDeduction: Number(expenseDeduction) || 0,
        grossAmount: dailyGrossAmount
      } : {})
    });

    // Reset Form
    setMemberId('');
    setPersonName('');
    setVehiclePlate('');
    setCategory('Daily Contribution');
    setType('Credit');
    setTillNumber('VehicleTill');
    setAmount('');
    setDescription('');
    setVehicleClass('Nissan');
    setOperationAmount('');
    setEntranceFee('');
    setLoanRepay('');
    setSavingsContribution('');
    setSTicket('');
    setLegalFee('');
    setExpenseDeduction('');
    setShowAddModal(false);
  };

  const isTreasurer = currentUserRole === 'Treasurer' || currentUserRole === 'Chairman';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="flex-1 flex flex-col overflow-y-auto bg-slate-50 font-sans"
    >
      {/* Premium Dashboard Header Greeting */}
      <header className="dashboard-hero py-7 sm:py-9 bg-white border-b border-slate-200/80 px-4 sm:px-8 flex flex-col sm:flex-row sm:items-center justify-between gap-5 shrink-0">
        <div className="space-y-2">
          <span className="dashboard-eyebrow">Operations command centre</span>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
            {greeting}, {currentUserName.split(' ')[0]}.
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Your live collections, fleet activity and financial controls—at a glance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isTreasurer ? (
            <button
              onClick={() => setShowAddModal(true)}
              id="dashboard-new-tx-btn"
              className="dashboard-primary-action px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl tracking-wide shadow-sm shadow-blue-200 flex items-center space-x-2 transition-all cursor-pointer transform active:scale-95"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Record Transaction</span>
            </button>
          ) : (
            <span className="text-[10px] uppercase bg-slate-100 text-slate-600 font-bold border border-slate-200 px-3 py-1.5 rounded-lg font-mono">
              Read-Only Profile ({currentUserRole})
            </span>
          )}

          {/* Minimize / Enlarge Toggle */}
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="px-3 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 text-[10px] font-bold rounded-xl uppercase tracking-wider flex items-center space-x-1.5 transition-all cursor-pointer"
            title={isMinimized ? "Enlarge Dashboard" : "Minimize Dashboard"}
          >
            {isMinimized ? (
              <>
                <Maximize2 className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
                <span className="text-blue-700 font-extrabold">ENLARGE</span>
              </>
            ) : (
              <>
                <Minimize2 className="w-3.5 h-3.5 text-slate-500" />
                <span>MINIMIZE</span>
              </>
            )}
          </button>

          <div className="hidden sm:block h-8 w-px bg-slate-200"></div>
          <div className="text-left sm:text-right">
            <p className="text-[9px] text-slate-400 uppercase tracking-widest font-mono font-semibold">Ledger Stream</p>
            <p className="text-xs text-blue-600 font-bold flex items-center justify-start sm:justify-end font-display">
              <span className="w-2 h-2 rounded-full bg-blue-500 mr-2 animate-pulse"></span>Active OS
            </p>
          </div>
        </div>
      </header>

      {/* Main Grid Layout */}
      {isMinimized ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-50/50 font-sans min-h-[450px]">
          {/* Animated minimized container card */}
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 shadow-[0_20px_50px_rgba(0,0,0,0.02)] flex flex-col items-center text-center space-y-6 hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center relative overflow-hidden shadow-inner">
              <LayoutDashboard className="w-8 h-8" />
              <span className="absolute top-1 right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span>
              </span>
            </div>
            
            <div className="space-y-2">
              <h3 className="text-lg font-bold text-slate-900 font-display uppercase tracking-wide">Dashboard Minimized</h3>
              <p className="text-xs text-slate-400 leading-relaxed max-w-[280px]">
                The Sacco operational ledger is running in background. Tap below to enlarge.
              </p>
            </div>

            {/* Stat Preview inside minimized card */}
            <div className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 flex items-center justify-between font-mono text-left">
              <div>
                <p className="text-[9px] text-slate-400 uppercase tracking-wider font-bold">Today's Pool</p>
                <p className="text-sm font-black text-slate-700">KES {todayCredits.toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] text-slate-400 uppercase tracking-wider font-bold">Active Fleet</p>
                <p className="text-sm font-black text-slate-700">{activeFleetCount} Matatus</p>
              </div>
            </div>

            <button
              onClick={() => setIsMinimized(false)}
              className="w-full py-3.5 px-6 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-[0_4px_12px_rgba(37,99,235,0.1)] hover:shadow-md transition-all duration-300 flex items-center justify-center space-x-2 group cursor-pointer"
            >
              <Maximize2 className="w-4 h-4 text-blue-400 group-hover:scale-110 transition-transform" />
              <span>Enlarge Sacco Dashboard</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="dashboard-grid p-4 sm:p-8 grid grid-cols-1 md:grid-cols-12 gap-6 flex-1 bg-slate-50/50">
        
        {/* Brand New App guided flow */}
        {members.length === 0 && (
          <div className="md:col-span-12 bg-gradient-to-br from-slate-900 to-blue-950 text-white border border-blue-900 rounded-3xl p-6 sm:p-8 shadow-xl relative overflow-hidden" id="sandbox-walkthrough-guide">
            <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
            <div className="relative z-10 max-w-5xl space-y-5">
              <div className="flex items-center space-x-2">
                <span className="px-2.5 py-1 bg-blue-500 text-slate-950 rounded text-[10px] font-mono font-black tracking-wider uppercase">
                  Pristine Installation
                </span>
                <span className="text-[11px] font-mono text-blue-400 font-bold">
                  Sacco OS Core Running Clean
                </span>
              </div>
              
              <div className="space-y-2">
                <h3 className="text-xl sm:text-2xl font-black font-display tracking-tight text-white">
                  Start Testing the Complete Flow
                </h3>
                <p className="text-xs text-blue-100/70 leading-relaxed">
                  Welcome to Sowetamu Sacco. This installation starts with empty registries, fleets, and ledgers. Follow this setup roadmap to build your live SACCO records from scratch:
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-2">
                {/* Step 1 */}
                <div className="bg-blue-950/30 border border-blue-900/40 rounded-xl p-4 flex flex-col justify-between space-y-3">
                  <div>
                    <span className="text-xs font-mono font-bold text-blue-400">Step 01</span>
                    <h4 className="text-xs font-bold text-white uppercase mt-1">Approve Blueprint</h4>
                    <p className="text-[10px] text-blue-200/60 leading-normal mt-1">
                      Chairman profile required to sign and lock the compliance design blueprint.
                    </p>
                  </div>
                  <button
                    onClick={() => onNavigateToTab('Blueprint')}
                    className="w-full py-1.5 bg-blue-900/40 hover:bg-blue-800/40 text-blue-300 rounded text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                  >
                    Go to Blueprint &rarr;
                  </button>
                </div>

                {/* Step 2 */}
                <div className="bg-blue-950/30 border border-blue-900/40 rounded-xl p-4 flex flex-col justify-between space-y-3">
                  <div>
                    <span className="text-xs font-mono font-bold text-blue-400">Step 02</span>
                    <h4 className="text-xs font-bold text-white uppercase mt-1">Add Member</h4>
                    <p className="text-[10px] text-blue-200/60 leading-normal mt-1">
                      Register a Sacco member (Matatu owner) inside the directory list.
                    </p>
                  </div>
                  <button
                    onClick={() => onNavigateToTab('Members')}
                    className="w-full py-1.5 bg-blue-900/40 hover:bg-blue-800/40 text-blue-300 rounded text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                  >
                    Go to Members &rarr;
                  </button>
                </div>

                {/* Step 3 */}
                <div className="bg-blue-950/30 border border-blue-900/40 rounded-xl p-4 flex flex-col justify-between space-y-3">
                  <div>
                    <span className="text-xs font-mono font-bold text-blue-400">Step 03</span>
                    <h4 className="text-xs font-bold text-white uppercase mt-1">Add Fleet Vehicle</h4>
                    <p className="text-[10px] text-blue-200/60 leading-normal mt-1">
                      Add a Matatu vehicle plate and assign it to your registered member.
                    </p>
                  </div>
                  <button
                    onClick={() => onNavigateToTab('Fleet')}
                    className="w-full py-1.5 bg-blue-900/40 hover:bg-blue-800/40 text-blue-300 rounded text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                  >
                    Go to Fleet &rarr;
                  </button>
                </div>

                {/* Step 4 */}
                <div className="bg-blue-950/30 border border-blue-900/40 rounded-xl p-4 flex flex-col justify-between space-y-3">
                  <div>
                    <span className="text-xs font-mono font-bold text-blue-400">Step 04</span>
                    <h4 className="text-xs font-bold text-white uppercase mt-1">Log Daily sheet</h4>
                    <p className="text-[10px] text-blue-200/60 leading-normal mt-1">
                      Log daily collections, savings, loan repayments, and expense vouchers.
                    </p>
                  </div>
                  <button
                    onClick={() => onNavigateToTab('Daily Collections')}
                    className="w-full py-1.5 bg-blue-900/40 hover:bg-blue-800/40 text-blue-300 rounded text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                  >
                    Log Sheet &rarr;
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* BENTO STATS CARDS */}
        {/* Card 1: Unified Conjunction Pool */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="dashboard-metric md:col-span-3 bg-white border border-slate-200/80 p-5 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between group backdrop-blur-md bg-white/90 relative overflow-hidden"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest font-mono">Unified Conjunction Pool</span>
              <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <DollarSign className="w-4 h-4 text-amber-600" />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-800 mt-3 font-mono tracking-tight">KES {todayCredits.toLocaleString()}</p>
          </div>
          <div className="flex items-end justify-between mt-4 pt-4 border-t border-slate-50">
            <div className="text-[10px] text-emerald-600 font-bold flex items-center bg-emerald-50/70 px-2 py-1 rounded-lg border border-emerald-100">
              <ArrowUpRight className="w-3.5 h-3.5 mr-0.5 text-emerald-500" /> +12.4% vs yesterday
            </div>
            <Sparkline data={[todayCredits * 0.72, todayCredits * 0.81, todayCredits * 0.75, todayCredits * 0.89, todayCredits]} color="#eab308" />
          </div>
        </motion.div>

        {/* Card 2: Fleet Till */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="dashboard-metric md:col-span-3 bg-white border border-slate-200/80 p-5 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between group backdrop-blur-md bg-white/90 relative overflow-hidden"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest font-mono">Fleet Till: 824 9102</span>
              <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <Activity className="w-4 h-4 text-emerald-600" />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-800 mt-3 font-mono tracking-tight">
              KES {transactions.filter(t => t.tillNumber === 'VehicleTill' && t.type === 'Credit').reduce((acc, t) => acc + t.amount, 0).toLocaleString()}
            </p>
          </div>
          <div className="flex items-end justify-between mt-4 pt-4 border-t border-slate-50">
            <p className="text-[10px] text-slate-400 font-medium">
              Collects daily fleet quota
            </p>
            <Sparkline data={fleetSparkData} color="#10b981" />
          </div>
        </motion.div>

        {/* Card 3: Utility Till */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          className="dashboard-metric md:col-span-3 bg-white border border-slate-200/80 p-5 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between group backdrop-blur-md bg-white/90 relative overflow-hidden"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest font-mono">Utility Till: 481 0294</span>
              <div className="w-8 h-8 rounded-full bg-rose-50 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <AlertCircle className="w-4 h-4 text-rose-500" />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-800 mt-3 font-mono tracking-tight">
              KES {transactions.filter(t => t.tillNumber === 'UtilityTill' && t.type === 'Debit').reduce((acc, t) => acc + t.amount, 0).toLocaleString()}
            </p>
          </div>
          <div className="flex items-end justify-between mt-4 pt-4 border-t border-slate-50">
            <div className="text-[10px] text-rose-600 font-bold flex items-center bg-rose-50/70 px-2 py-0.5 rounded border border-rose-100">
              Operations debits
            </div>
            <Sparkline data={utilitySparkData} color="#ef4444" />
          </div>
        </motion.div>

        {/* Card 4: Sacco Fleet Status */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="dashboard-metric md:col-span-3 bg-white border border-slate-200/80 p-5 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between group backdrop-blur-md bg-white/90 relative overflow-hidden"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest font-mono">Sacco Fleet Status</span>
              <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <CheckCircle2 className="w-4 h-4 text-blue-500" />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-800 mt-3 font-mono tracking-tight">
              {activeFleetCount} / {vehicles.length} Active
            </p>
          </div>
          <div className="flex items-end justify-between mt-4 pt-4 border-t border-slate-50">
            <p className="text-[10px] text-slate-400 font-medium">
              {members.length} registered members
            </p>
            <Sparkline data={[2, 3, 3, 4, 3, activeFleetCount]} color="#3b82f6" />
          </div>
        </motion.div>

        {/* ANALYTICS ROW */}
        {/* Sacco Analytics Chart */}
        <div className="md:col-span-8">
          <SaccoAnalyticsChart transactions={transactions} />
        </div>

        {/* Side Audit & Targets Box */}
        <div className="md:col-span-4 flex flex-col gap-6">
          {/* Audit Health Card */}
          <div className="bg-gradient-to-br from-slate-900 to-blue-900 text-white p-6 rounded-3xl shadow-[0_10px_30px_rgba(37,99,235,0.08)] relative overflow-hidden group border border-blue-950/20">
            <div className="absolute -top-12 -right-12 w-36 h-36 bg-blue-500/10 rounded-full blur-xl group-hover:bg-blue-500/20 transition-all duration-500"></div>
            <h3 className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-4 font-mono">
              Ledger Activity
            </h3>
            <div className="flex items-end justify-between relative z-10">
              <div>
                <p className="text-3xl font-black tracking-tight font-display">{ledgerEntryCount}</p>
                <p className="text-[10px] text-blue-200/80 mt-1 leading-normal max-w-[200px]">
                  {ledgerEntryCount === 1 ? 'recorded ledger entry' : 'recorded ledger entries'} available for review and correction.
                </p>
              </div>
              <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center border border-white/20 shrink-0">
                <span className="text-[10px] font-bold text-blue-300">LIVE</span>
              </div>
            </div>
          </div>

          {/* Collection Targets */}
          <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.015)] flex flex-col justify-between flex-1">
            <div>
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4 font-mono">
                Weekly Collection Summary
              </h3>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-[10px] font-bold mb-1.5 text-slate-600">
                    <span>WEEKLY SAVINGS RECORDED</span>
                    <span className="font-mono text-blue-600 font-black">KES {weeklySavings.toLocaleString()}</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-600 rounded-full transition-all duration-500" style={{ width: `${savingsShare}%` }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] font-bold mb-1.5 text-slate-600">
                    <span>WEEKLY LOAN REPAYMENTS</span>
                    <span className="font-mono text-amber-500 font-black">KES {weeklyLoanRepayments.toLocaleString()}</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full transition-all duration-500" style={{ width: `${loanRepaymentShare}%` }}></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-100 mt-6">
              <button
                onClick={() => onNavigateToTab('Reports')}
                className="w-full py-2.5 bg-slate-50 border border-slate-200 text-slate-600 text-[10px] font-bold rounded-xl uppercase tracking-wider hover:bg-slate-100 transition-colors duration-200"
              >
                View Live Ledger Summary
              </button>
            </div>
          </div>
        </div>

        {/* BOTTOM ROW: FULL LEDGER RECORDS */}
        <div className="md:col-span-12 bg-white border border-slate-200 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.01)] flex flex-col overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider font-display">Recent Immutable Ledger Records</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">Live real-time operational logbook with tamperproof verification codes</p>
            </div>
            <button
              onClick={() => onNavigateToTab('Reports')}
              className="text-[10px] text-blue-600 hover:text-blue-700 font-bold uppercase tracking-wider bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 transition-colors duration-200 cursor-pointer"
            >
              View Full Accounts &rarr;
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50/50 text-[10px] text-slate-400 font-bold uppercase tracking-wider border-b border-slate-100">
                <tr>
                  <th className="px-6 py-4">Timestamp / Ref</th>
                  <th className="px-6 py-4">Member / Matatu</th>
                  <th className="px-6 py-4">Description</th>
                  <th className="px-6 py-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {transactions.slice(0, 6).map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50/40 transition-colors duration-150">
                    <td className="px-6 py-4 text-slate-500">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-700 font-mono">
                          {new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="text-[10px] text-slate-400 uppercase tracking-widest font-mono mt-0.5">{tx.refCode}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-800">{tx.memberName || 'Office Administration'}</span>
                        {tx.vehiclePlate && (
                          <span className="text-[10px] text-emerald-600 font-bold font-mono mt-0.5">{tx.vehiclePlate}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-600">{tx.description}</span>
                        <div className="flex items-center space-x-2 mt-1">
                          <span className="text-[10px] text-slate-400 font-medium">{tx.category}</span>
                          <span className="text-[10px] text-slate-300">&bull;</span>
                          <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-md ${
                            tx.tillNumber === 'VehicleTill'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                              : tx.tillNumber === 'UtilityTill'
                              ? 'bg-blue-50 text-blue-700 border border-blue-100'
                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}>
                            {tx.tillNumber === 'VehicleTill' ? 'Till: 8249102 (Fleet)' : tx.tillNumber === 'UtilityTill' ? 'Till: 4810294 (Admin)' : 'Cash Drawer'}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className={`font-mono font-black text-xs ${
                        tx.type === 'Credit' ? 'text-emerald-600' : 'text-rose-500'
                      }`}>
                        {tx.type === 'Credit' ? '+' : '-'} {tx.amount.toLocaleString()}.00
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
      )}

      {/* Record Transaction Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 border-b border-slate-100 pb-3 mb-4 font-display">
              Record Sacco Ledger Transaction
            </h3>

            <form onSubmit={handleCreateTx} className="space-y-4">
              <div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                    Book Category *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => handleCategoryChange(e.target.value as any)}
                    className="w-full p-2.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-100 bg-white"
                  >
                    <option value="Daily Contribution">Daily Contribution</option>
                    <option value="Registration Fee">Registration Fee</option>
                    <option value="Management Fee">Management Fee</option>
                    <option value="Office Expenses">Office Expenses</option>
                    <option value="Petty Cash">Petty Cash</option>
                    <option value="Penalty">Penalty</option>
                    <option value="Utilities">Utilities</option>
                    <option value="Equipment">Equipment</option>
                  </select>
                </div>

              </div>

              {category === 'Daily Contribution' && (
                <div className="space-y-3 rounded-2xl border-2 border-slate-900 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-900">Daily collection sheet</p>
                      <p className="text-[10px] text-slate-500">Based on the handwritten operation register</p>
                    </div>
                    <select
                      value={vehicleClass}
                      onChange={(e) => {
                        const nextClass = e.target.value as VehicleClass;
                        setVehicleClass(nextClass);
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold"
                    >
                      <option value="Nissan">Nissan</option>
                      <option value="Sienta">Sienta</option>
                      <option value="Member Contribution">Member Contribution</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {[
                      ['Operation', operationAmount, setOperationAmount],
                      ['Entrance fee', entranceFee, setEntranceFee],
                      ['Loan repay', loanRepay, setLoanRepay],
                      ['Savings', savingsContribution, setSavingsContribution],
                      ['S/Ticket', sTicket, setSTicket],
                      ['Legal fee', legalFee, setLegalFee]
                    ].map(([label, value, setter]) => (
                      <label key={label as string} className="text-[9px] font-bold uppercase tracking-wide text-slate-500">
                        {label as string}
                        <input
                          type="number"
                          min="0"
                          value={value as string}
                          onChange={(e) => (setter as React.Dispatch<React.SetStateAction<string>>)(sanitizeDecimalInput(e.target.value))}
                          inputMode="decimal"
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-right font-mono text-xs text-slate-900"
                        />
                      </label>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-2 border-t border-slate-300 pt-3 font-mono text-xs">
                    <div><span className="block text-[9px] text-slate-500">GROSS</span><strong>KES {dailyGrossAmount.toLocaleString()}</strong></div>
                    <label className="text-[9px] font-bold text-rose-600">DEDUCTION
                      <input type="number" min="0" value={expenseDeduction} onChange={(e) => setExpenseDeduction(sanitizeDecimalInput(e.target.value))} inputMode="decimal" className="mt-1 w-full rounded border border-rose-200 bg-white p-1.5 text-right text-xs" />
                    </label>
                    <div className="text-right"><span className="block text-[9px] text-emerald-700">NET BANKABLE</span><strong className="text-emerald-700">KES {dailyNetAmount.toLocaleString()}</strong></div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                  Active Till Account Assignment *
                </label>
                <select
                  value={tillNumber}
                  onChange={(e) => setTillNumber(e.target.value as any)}
                  className="w-full p-2.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-100 bg-white font-mono"
                >
                  <option value="VehicleTill">Till No: 824 9102 (Sacco Vehicle Fleet Account)</option>
                  <option value="UtilityTill">Till No: 481 0294 (Sacco Administrative Utility Account)</option>
                  <option value="None">None (Direct Petty Cash Voucher Draw)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                    Amount (KES) *
                  </label>
                  <input
                    type="number"
                    required
                    value={category === 'Daily Contribution' ? dailyNetAmount : amount}
                    onChange={(e) => setAmount(sanitizeDecimalInput(e.target.value))}
                    inputMode="decimal"
                    disabled={category === 'Daily Contribution'}
                    className="w-full p-2.5 border border-slate-200 rounded-xl text-xs font-mono focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-100 disabled:bg-emerald-50 disabled:text-emerald-800 disabled:font-bold"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                    Ledger Account Type
                  </label>
                  <input
                    type="text"
                    disabled
                    value={type === 'Credit' ? 'CREDIT (Receivable)' : 'DEBIT (Outgoing)'}
                    className="w-full p-2.5 border border-slate-200 rounded-xl text-xs bg-slate-50 text-slate-600 font-bold font-mono"
                  />
                </div>
              </div>

              {isExpenseEntry ? (
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                    External Payee / Recipient (Optional)
                  </label>
                  <input
                    type="text"
                    value={personName}
                    onChange={(e) => setPersonName(sanitizePersonName(e.target.value))}
                    inputMode="text"
                    pattern="[A-Za-z .'-]*"
                    title="Use letters only."
                    placeholder="Enter the person receiving the expense"
                    className="w-full p-2.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-100 bg-white"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                      Registered Member Name *
                    </label>
                    <input
                      type="text"
                      required
                      list="registered-member-names"
                      value={personName}
                      onChange={(e) => {
                        const nextName = sanitizePersonName(e.target.value);
                        const member = members.find(item => item.name.trim().toLowerCase() === nextName.trim().toLowerCase());
                        setPersonName(nextName);
                        setMemberId(member?.id || '');
                      }}
                      placeholder="Type the member's registered name"
                      className="w-full p-2.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-100 bg-white"
                    />
                    <datalist id="registered-member-names">
                      {members.filter(member => member.status === 'Active').map(member => (
                        <option key={member.id} value={member.name} />
                      ))}
                    </datalist>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                      V.REG / Car (Optional)
                    </label>
                    <input
                      type="text"
                      list="active-onboarded-vehicles"
                      value={vehiclePlate}
                      onChange={(e) => setVehiclePlate(sanitizeVehiclePlate(e.target.value))}
                      placeholder="Leave blank or type a registered V.REG"
                      className="w-full p-2.5 border border-slate-200 rounded-xl text-xs font-mono uppercase focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-100 bg-white"
                    />
                    <datalist id="active-onboarded-vehicles">
                      {activeVehicles.map(vehicle => (
                        <option key={vehicle.id} value={vehicle.plateNumber}>{vehicle.ownerName}</option>
                      ))}
                    </datalist>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                  Memo Description (Optional)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full p-2.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-100"
                />
              </div>

              {error && <p className="text-xs text-rose-600 font-bold" id="tx-error-message">{error}</p>}

              <div className="flex justify-end space-x-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setError('');
                  }}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-500 uppercase tracking-wider hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="record-tx-submit-button"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-sm shadow-blue-100 transition-all cursor-pointer transform active:scale-95"
                >
                  Confirm Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </motion.div>
  );
}
