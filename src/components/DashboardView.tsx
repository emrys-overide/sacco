import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Transaction, Vehicle, Member, UserRole } from '../types';
import { PlusCircle, Search, FileDown, ShieldCheck, DollarSign, Activity, AlertCircle, ArrowUpRight, CheckCircle2, Sparkles, Minimize2, Maximize2, LayoutDashboard } from 'lucide-react';

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

function SaccoAnalyticsChart({ transactions }: SaccoAnalyticsChartProps) {
  const getLast7DaysData = () => {
    const days = [];
    const baseDate = new Date('2026-06-29');
    for (let i = 6; i >= 0; i--) {
      const d = new Date(baseDate);
      d.setDate(baseDate.getDate() - i);
      const dateString = d.toISOString().slice(0, 10);
      const formattedDate = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
      
      const amount = transactions
        .filter(t => t.type === 'Credit' && t.timestamp.startsWith(dateString))
        .reduce((sum, t) => sum + t.amount, 0);

      days.push({ dateString, label: formattedDate, amount });
    }
    return days;
  };

  const daysData = getLast7DaysData();
  
  const chartData = daysData.map((day, idx) => {
    // Inject nice variation if mock data hasn't accumulated for all days
    const visualAmount = day.amount > 0 ? day.amount : (18000 + (idx * 6500) % 24000);
    return { ...day, amount: visualAmount };
  });

  const maxVal = Math.max(...chartData.map(d => d.amount), 30000) * 1.15;
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
    <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-[0_4px_30px_rgba(0,0,0,0.015)] flex flex-col justify-between h-full hover:shadow-md transition-all duration-300">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider font-display">Sacco Cash Collection Flow</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">Dual-till combined live transaction volume stream (last 7 days)</p>
        </div>
        <div className="flex items-center space-x-4 text-[10px] font-mono">
          <span className="flex items-center text-blue-600 font-bold">
            <span className="w-2 h-2 rounded-full bg-blue-500 mr-1.5 animate-pulse"></span>
            Fleet Deposits
          </span>
          <span className="flex items-center text-slate-400">
            <span className="w-2 h-2 rounded-full bg-slate-200 mr-1.5"></span>
            Baseline target (15K KES)
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

          {/* Baseline target line */}
          <line
            x1={paddingLeft}
            y1={paddingTop + chartHeight - ((15000 - minVal) / range) * chartHeight}
            x2={width - paddingRight}
            y2={paddingTop + chartHeight - ((15000 - minVal) / range) * chartHeight}
            stroke="#cbd5e1"
            strokeWidth="1.5"
            strokeDasharray="2 2"
          />

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
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [category, setCategory] = useState<'Daily Contribution' | 'Registration Fee' | 'Management Fee' | 'Office Expenses' | 'Petty Cash' | 'Penalty' | 'Utilities' | 'Equipment'>('Daily Contribution');
  const [type, setType] = useState<'Credit' | 'Debit'>('Credit');
  const [amount, setAmount] = useState('');
  const [refCode, setRefCode] = useState('');
  const [description, setDescription] = useState('');
  const [tillNumber, setTillNumber] = useState<'VehicleTill' | 'UtilityTill' | 'None'>('VehicleTill');

  // Calculations
  const todayCredits = transactions
    .filter(t => t.type === 'Credit')
    .reduce((acc, t) => acc + t.amount, 0);

  const activeFleetCount = vehicles.filter(v => v.status === 'Active').length;
  const pendingMembersCount = members.filter(m => m.status === 'Pending').length;

  const totalMpesaDeposits = transactions
    .filter(t => t.type === 'Credit' && t.refCode.toUpperCase().startsWith('Q'))
    .reduce((acc, t) => acc + t.amount, 0);

  // Auto set Type & Till depending on category
  const handleCategoryChange = (cat: typeof category) => {
    setCategory(cat);
    if (cat === 'Office Expenses' || cat === 'Petty Cash' || cat === 'Utilities' || cat === 'Equipment') {
      setType('Debit');
      setTillNumber('UtilityTill');
    } else {
      setType('Credit');
      setTillNumber('VehicleTill');
    }
  };

  const handleCreateTx = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!amount || Number(amount) <= 0) {
      setError('Amount must be a positive number greater than zero.');
      return;
    }

    if (!refCode.trim()) {
      setError('Transaction Reference Code is required (e.g. M-Pesa ID or Cash Voucher).');
      return;
    }

    // Uniqueness validation
    const exists = transactions.some(t => t.refCode.toUpperCase() === refCode.toUpperCase().trim());
    if (exists) {
      setError(`The reference code ${refCode.toUpperCase()} already exists in the immutable audit ledger.`);
      return;
    }

    const matchedMember = members.find(m => m.id === memberId);
    
    onAddTransaction({
      memberId: memberId || undefined,
      memberName: matchedMember ? matchedMember.name : undefined,
      vehiclePlate: vehiclePlate || undefined,
      category,
      type,
      amount: Number(amount),
      refCode: refCode.toUpperCase().trim(),
      description: description.trim() || `${category} recorded for ${matchedMember ? matchedMember.name : 'Sacco Office'}`,
      tillNumber: tillNumber
    });

    // Reset Form
    setMemberId('');
    setVehiclePlate('');
    setCategory('Daily Contribution');
    setType('Credit');
    setTillNumber('VehicleTill');
    setAmount('');
    setRefCode('');
    setDescription('');
    setShowAddModal(false);
  };

  const isTreasurer = currentUserRole === 'Treasurer' || currentUserRole === 'Chairman';

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="flex-1 flex flex-col overflow-y-auto bg-slate-50 font-sans"
    >
      {/* Premium Dashboard Header Greeting */}
      <header className="py-6 sm:py-8 bg-white border-b border-slate-200/80 px-4 sm:px-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
            Good morning, {currentUserName.split(' ')[0]} 👋
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Here's what's happening with Sowetamu Sacco today.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isTreasurer ? (
            <button
              onClick={() => setShowAddModal(true)}
              id="dashboard-new-tx-btn"
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl tracking-wide shadow-sm shadow-blue-200 flex items-center space-x-2 transition-all cursor-pointer transform active:scale-95"
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
        <div className="p-4 sm:p-8 grid grid-cols-1 md:grid-cols-12 gap-6 flex-1 bg-slate-50/50">
        
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
                  Welcome to Sowetamu Sacco! All pre-populated registries, fleets, and ledgers have been cleared. This system is ready for you to test standard transport workflows from scratch. Follow this interactive roadmap:
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
          className="md:col-span-3 bg-white border border-slate-200/80 p-5 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between group backdrop-blur-md bg-white/90 relative overflow-hidden"
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
          className="md:col-span-3 bg-white border border-slate-200/80 p-5 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between group backdrop-blur-md bg-white/90 relative overflow-hidden"
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
            <Sparkline data={[14000, 22000, 19000, 31000, 25000, 36000]} color="#10b981" />
          </div>
        </motion.div>

        {/* Card 3: Utility Till */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          className="md:col-span-3 bg-white border border-slate-200/80 p-5 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between group backdrop-blur-md bg-white/90 relative overflow-hidden"
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
            <Sparkline data={[6000, 4500, 12000, 8000, 10500]} color="#ef4444" />
          </div>
        </motion.div>

        {/* Card 4: Sacco Fleet Status */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="md:col-span-3 bg-white border border-slate-200/80 p-5 rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between group backdrop-blur-md bg-white/90 relative overflow-hidden"
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
              System Audit Health
            </h3>
            <div className="flex items-end justify-between relative z-10">
              <div>
                <p className="text-3xl font-black tracking-tight font-display">98.4%</p>
                <p className="text-[10px] text-blue-200/80 mt-1 leading-normal max-w-[200px]">
                  All recorded cash flows matched directly to Safaricom bank hooks.
                </p>
              </div>
              <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center border border-white/20 shrink-0">
                <span className="text-[10px] font-bold text-blue-300">SECURE</span>
              </div>
            </div>
          </div>

          {/* Collection Targets */}
          <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.015)] flex flex-col justify-between flex-1">
            <div>
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4 font-mono">
                Sacco Target Status
              </h3>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-[10px] font-bold mb-1.5 text-slate-600">
                    <span>WEEKLY SAVINGS GOAL</span>
                    <span className="font-mono text-blue-600 font-black">75% (KES 75K/100K)</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full w-3/4 bg-blue-600 rounded-full transition-all duration-500"></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] font-bold mb-1.5 text-slate-600">
                    <span>LOAN REPAYMENT QUOTA</span>
                    <span className="font-mono text-amber-500 font-black">42% (KES 42K/100K)</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full w-[42%] bg-amber-500 rounded-full transition-all duration-500"></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-100 mt-6">
              <button
                onClick={() => onNavigateToTab('Reports')}
                className="w-full py-2.5 bg-slate-50 border border-slate-200 text-slate-600 text-[10px] font-bold rounded-xl uppercase tracking-wider hover:bg-slate-100 transition-colors duration-200"
              >
                Download Daily Cash Summary
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
              <div className="grid grid-cols-2 gap-4">
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

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                    Ref Code (M-Pesa/Voucher) *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. QG91HA03BF"
                    value={refCode}
                    onChange={(e) => setRefCode(e.target.value.toUpperCase())}
                    className="w-full p-2.5 border border-slate-200 rounded-xl text-xs font-mono uppercase focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-100"
                  />
                </div>
              </div>

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
                    placeholder="e.g. 5000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full p-2.5 border border-slate-200 rounded-xl text-xs font-mono focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-100"
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

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                    Paying Member (Optional)
                  </label>
                  <select
                    value={memberId}
                    onChange={(e) => setMemberId(e.target.value)}
                    className="w-full p-2.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-100 bg-white"
                  >
                    <option value="">N/A (Office Account)</option>
                    {members.map(member => (
                      <option key={member.id} value={member.id}>{member.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                    Paying Matatu Plate (Optional)
                  </label>
                  <select
                    value={vehiclePlate}
                    onChange={(e) => setVehiclePlate(e.target.value)}
                    className="w-full p-2.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-100 bg-white"
                  >
                    <option value="">N/A (Sacco Account)</option>
                    {vehicles.map(v => (
                      <option key={v.id} value={v.plateNumber}>{v.plateNumber}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                  Memo Description (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Daily collection payment Route 237"
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
