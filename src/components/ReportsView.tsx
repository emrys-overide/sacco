import React, { useState } from 'react';
import type { Transaction, Vehicle, Member, User, UserRole } from '../types';
import { canRole } from '../lib/auth';
import { sanitizeDecimalInput, sanitizeReferenceCode } from '../lib/inputValidation';
import { isExpenseTransactionCategory, requiresRegisteredMember } from '../lib/transactionPolicy';
import { calculateReportFinancials, SOWETAMU_AUDIT_REFERENCE } from '../lib/reportFinancials';
import { 
  FileText, 
  Download, 
  TrendingUp, 
  DollarSign, 
  ArrowDownLeft, 
  ArrowUpRight, 
  CheckCircle2, 
  Sliders, 
  RefreshCw, 
  Layers, 
  Wallet, 
  Server, 
  Activity, 
  ArrowRight,
  Sparkles,
  BookOpen,
  Printer,
  FileCheck,
  Award,
  Users,
  PenTool,
  Scale,
  Building,
  Calculator,
  Percent,
  PlusCircle,
  Coins,
  Search,
  RotateCcw,
  Pencil
} from 'lucide-react';

const JOURNAL_WRITE_ROLES: readonly UserRole[] = ['Treasurer', 'Chairman', 'Accountant'];

interface ReportsViewProps {
  transactions: Transaction[];
  vehicles: Vehicle[];
  members: Member[];
  onAddTransaction?: (newTx: Omit<Transaction, 'id' | 'timestamp' | 'recorderName'>) => void | Promise<Transaction>;
  onReverseTransaction?: (transactionId: string) => Promise<void>;
  onUpdateTransaction?: (transactionId: string, changes: Partial<Transaction>) => Promise<Transaction>;
  currentUser?: User;
}

export default function ReportsView({ 
  transactions, 
  vehicles, 
  members, 
  onAddTransaction, 
  onReverseTransaction,
  onUpdateTransaction,
  currentUser 
}: ReportsViewProps) {
  // Navigation
  const [activeSection, setActiveSection] = useState<'cashless' | 'compliance' | 'accountant'>('cashless');

  // Accountant Workspace States
  const [journalType, setJournalType] = useState<'Credit' | 'Debit'>('Credit');
  const [journalCategory, setJournalCategory] = useState<'Daily Contribution' | 'Savings Contribution' | 'Registration Fee' | 'Management Fee' | 'Office Expenses' | 'Petty Cash' | 'Penalty' | 'Utilities' | 'Equipment'>('Daily Contribution');
  const [journalAmount, setJournalAmount] = useState<string>('');
  const [journalDescription, setJournalDescription] = useState<string>('');
  const [journalRefCode, setJournalRefCode] = useState<string>('');
  const [journalMemberId, setJournalMemberId] = useState<string>('');
  const [journalVehiclePlate, setJournalVehiclePlate] = useState<string>('');
  const [journalTill, setJournalTill] = useState<'VehicleTill' | 'UtilityTill' | 'None'>('VehicleTill');
  const [journalSuccess, setJournalSuccess] = useState<string>('');
  const [journalError, setJournalError] = useState<string>('');
  const journalRequiresRegistration = requiresRegisteredMember(journalCategory);
  const activeJournalVehicles = vehicles.filter(vehicle => vehicle.status === 'Active');
  const eligibleJournalMembers = members.filter(member =>
    member.status === 'Active' && activeJournalVehicles.some(vehicle => vehicle.ownerId === member.id)
  );
  const eligibleJournalVehicles = journalMemberId
    ? activeJournalVehicles.filter(vehicle => vehicle.ownerId === journalMemberId)
    : activeJournalVehicles;

  const [ledgerSearch, setLedgerSearch] = useState<string>('');
  const [ledgerCategoryFilter, setLedgerCategoryFilter] = useState<string>('All');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState<string>('All');
  const [ledgerTillFilter, setLedgerTillFilter] = useState<string>('All');
  const [ledgerDateFrom, setLedgerDateFrom] = useState<string>('');
  const [ledgerDateTo, setLedgerDateTo] = useState<string>('');
  const [reversingTransactionId, setReversingTransactionId] = useState<string>('');
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editVehiclePlate, setEditVehiclePlate] = useState('');
  const [editType, setEditType] = useState<'Credit' | 'Debit'>('Credit');
  const [editCategory, setEditCategory] = useState<Transaction['category']>('Daily Contribution');
  const [editTill, setEditTill] = useState<Transaction['tillNumber']>('VehicleTill');
  
  // Cashless Tills Hub states
  const [reportType, setReportType] = useState<'Daily' | 'Monthly' | 'Yearly'>('Daily');
  const [downloadSuccessMessage, setDownloadSuccessMessage] = useState('');
  const [activeTillTab, setActiveTillTab] = useState<'conjunction' | 'vehicle' | 'utility'>('conjunction');

  // Compliance Report states
  const [reportDataSource, setReportDataSource] = useState<'sowetamu' | 'live'>('live');
  const [complianceActivePage, setComplianceActivePage] = useState<string>('cover');
  const [showEditCommittee, setShowEditCommittee] = useState(false);

  // Editable Committee Names
  const [chairmanName, setChairmanName] = useState('Joseph Kagai Nyamwitha');
  const [secretaryName, setSecretaryName] = useState('Peter Mwangi Waweru');
  const [treasurerName, setTreasurerName] = useState('Tobias Taabu Obiero');
  const [bankName, setBankName] = useState('Co-operative Bank of Kenya Ltd, Kayole Branch');
  const [saccoRegNo, setSaccoRegNo] = useState('CS/NO. 22239');
  const [saccoCustomName, setSaccoCustomName] = useState('SOWETAMU SACCO');

  const reportMetrics = calculateReportFinancials(transactions, members);
  const { totalCredits, totalDebits, netBalance, categorySummary } = reportMetrics;
  const { entries: vehicleTx, credits: vehicleCredits, debits: vehicleDebits, net: vehicleNet } = reportMetrics.vehicle;
  const { entries: utilityTx, credits: utilityCredits, debits: utilityDebits, net: utilityNet } = reportMetrics.utility;
  const { entries: cashTx, credits: cashCredits, debits: cashDebits, net: cashNet } = reportMetrics.cash;
  const sowetamuData = SOWETAMU_AUDIT_REFERENCE;

  // Select dataset depending on switcher state
  const reportSaccoName = reportDataSource === 'sowetamu' ? sowetamuData.saccoName : saccoCustomName;
  const reportRegNo = reportDataSource === 'sowetamu' ? sowetamuData.regNo : saccoRegNo;
  const reportYear = reportDataSource === 'sowetamu' ? sowetamuData.year : '2026';
  const reportAuditFee = reportDataSource === 'sowetamu' ? sowetamuData.auditFee : 0;
  
  const reportMembers = reportDataSource === 'sowetamu' 
    ? sowetamuData.members 
    : reportMetrics.liveMembers;

  const reportFinancials = reportDataSource === 'sowetamu' 
    ? sowetamuData.financials 
    : reportMetrics.liveFinancials;

  const filteredLedgerTransactions = transactions.filter(t => {
    const normalizedSearch = ledgerSearch.toLowerCase();
    const txDate = t.timestamp.substring(0, 10);
    const matchSearch =
      t.refCode.toLowerCase().includes(normalizedSearch) ||
      t.description.toLowerCase().includes(normalizedSearch) ||
      (t.memberName && t.memberName.toLowerCase().includes(normalizedSearch)) ||
      (t.vehiclePlate && t.vehiclePlate.toLowerCase().includes(normalizedSearch));

    const matchCategory = ledgerCategoryFilter === 'All' || t.category === ledgerCategoryFilter;
    const matchType = ledgerTypeFilter === 'All' || t.type === ledgerTypeFilter;
    const matchTill = ledgerTillFilter === 'All' || t.tillNumber === ledgerTillFilter;
    const matchDateFrom = !ledgerDateFrom || txDate >= ledgerDateFrom;
    const matchDateTo = !ledgerDateTo || txDate <= ledgerDateTo;

    return matchSearch && matchCategory && matchType && matchTill && matchDateFrom && matchDateTo;
  });

  const filteredLedgerCredits = filteredLedgerTransactions
    .filter(t => t.type === 'Credit')
    .reduce((sum, t) => sum + t.amount, 0);
  const filteredLedgerDebits = filteredLedgerTransactions
    .filter(t => t.type === 'Debit')
    .reduce((sum, t) => sum + t.amount, 0);
  const filteredLedgerNet = filteredLedgerCredits - filteredLedgerDebits;

  // Cashless till download
  const triggerDownload = (format: 'TXT' | 'CSV') => {
    let content = `======================================================\n`;
    content += `         SOWETAMU SACCO FINANCIAL BLUEPRINT REPORT\n`;
    content += `         Scope: ${reportType} Combined & Segregated Tills Statement\n`;
    content += `              Generated on: ${new Date().toLocaleString()}\n`;
    content += `======================================================\n\n`;

    content += `CONJUNCTION OF TILL ACCOUNTS (MERGED STATEMENT):\n`;
    content += `------------------------------------------------------\n`;
    content += `Total Credits Received  : KES ${totalCredits.toLocaleString()}.00\n`;
    content += `Total Debits (Expenses) : KES ${totalDebits.toLocaleString()}.00\n`;
    content += `Unified Sacco Net Asset : KES ${netBalance.toLocaleString()}.00\n\n`;

    content += `INDIVIDUAL TILL LEDGER SUMMARIES:\n`;
    content += `------------------------------------------------------\n`;
    content += `1. CO-OP ACCOUNT 48277 (OPERATIONS / DAILY COLLECTIONS)\n`;
    content += `   - Total Deposits     : KES ${vehicleCredits.toLocaleString()}.00\n`;
    content += `   - Total Payouts/Fees : KES ${vehicleDebits.toLocaleString()}.00\n`;
    content += `   - Net Till Balance   : KES ${vehicleNet.toLocaleString()}.00\n\n`;

    content += `2. CO-OP ACCOUNT 871671 (MEMBER SAVINGS)\n`;
    content += `   - Total Deposits     : KES ${utilityCredits.toLocaleString()}.00\n`;
    content += `   - Total Office Exp   : KES ${utilityDebits.toLocaleString()}.00\n`;
    content += `   - Net Till Balance   : KES ${utilityNet.toLocaleString()}.00\n\n`;

    if (cashTx.length > 0) {
      content += `3. DIRECT PETTY CASH DRAWER (CASH/VOUCHERS)\n`;
      content += `   - Total Receipts     : KES ${cashCredits.toLocaleString()}.00\n`;
      content += `   - Total Disbursements: KES ${cashDebits.toLocaleString()}.00\n`;
      content += `   - Net Cash Balance   : KES ${cashNet.toLocaleString()}.00\n\n`;
    }

    content += `CATEGORY BREAKDOWN:\n`;
    content += `------------------------------------------------------\n`;
    Object.entries(categorySummary).forEach(([category, amount]) => {
      content += `${category.padEnd(25)} : KES ${amount.toLocaleString()}.00\n`;
    });
    content += `\n`;

    content += `FLEET METRICS:\n`;
    content += `------------------------------------------------------\n`;
    content += `Registered Fleet Vehicles: ${vehicles.length}\n`;
    content += `Registered Sacco Members : ${members.length}\n`;
    content += `\n`;

    content += `COMPREHENSIVE LEDGER AUDIT LOG:\n`;
    content += `------------------------------------------------------\n`;
    content += `Date       Till Type       Ref Code      Type    Category             Amount\n`;
    transactions.forEach(t => {
      const dateStr = t.timestamp.substring(0, 10);
      const tillStr = (t.tillNumber === 'VehicleTill' ? 'Acct 48277' : t.tillNumber === 'UtilityTill' ? 'Acct 871671' : 'Cash Drawer').padEnd(15);
      const refCode = t.refCode.padEnd(13);
      const typeStr = t.type.padEnd(7);
      const catStr = t.category.padEnd(20);
      const amountStr = `KES ${t.amount.toLocaleString()}`;
      content += `${dateStr} ${tillStr} ${refCode} ${typeStr} ${catStr} ${amountStr}\n`;
    });
    content += `\n======================================================\n`;
    content += `       End of Financial Sowetamu Sacco Statement\n`;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Sowetamu_Sacco_Till_Report_${reportType.toLowerCase()}_${new Date().toISOString().slice(0,10)}.${format.toLowerCase()}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setDownloadSuccessMessage(`Success! Sowetamu Sacco dual-till financial statement exported in ${format} format.`);
    setTimeout(() => setDownloadSuccessMessage(''), 5000);
  };

  // Downloads the complete textual regulatory PDF equivalent report
  const downloadComplianceReport = () => {
    let report = `REPUBLIC OF KENYA\n`;
    report += `CS/NO: ${reportRegNo}\n`;
    report += `${reportSaccoName.toUpperCase()} CO-OPERATIVE SAVINGS & CREDIT SOCIETY LTD\n`;
    report += `ANNUAL AUDIT REPORT & CERTIFIED FINANCIAL STATEMENTS\n`;
    report += `FOR THE REGULATORY COMPLIANCE YEAR ENDED 31ST DECEMBER ${reportYear}\n`;
    report += `=========================================================================\n\n`;

    report += `1. SOCIETY EXECUTIVE INFORMATION\n`;
    report += `-------------------------------------------------------------------------\n`;
    report += `Chairman               : ${chairmanName}\n`;
    report += `Secretary              : ${secretaryName}\n`;
    report += `Treasurer              : ${treasurerName}\n`;
    report += `Registered Office      : Shujaa Mall, Kayole, Nairobi\n`;
    report += `Principal Banker       : ${bankName}\n`;
    report += `Sacco Registry CS No.  : ${reportRegNo}\n\n`;

    report += `2. STATISTICAL REGULATION INDEX\n`;
    report += `-------------------------------------------------------------------------\n`;
    report += `Active Sacco Book Members : ${reportMembers.active}\n`;
    report += `Dormant Sacco Members     : ${reportMembers.dormant}\n`;
    report += `Total Registry Members    : ${reportMembers.total}\n\n`;

    report += `3. CERTIFIED BALANCE SHEET (AUDITED)\n`;
    report += `-------------------------------------------------------------------------\n`;
    report += `ASSETS:\n`;
    report += `  - Cash & Cash Equivalents     : KSH ${reportFinancials.cashAndEquiv.toLocaleString()}\n`;
    report += `  - Accounts/Trade Receivables  : KSH ${reportFinancials.otherReceivables.toLocaleString()}\n`;
    report += `  - Net Loans Advanced Members  : KSH ${reportFinancials.loansToMembers.toLocaleString()}\n`;
    report += `  - PPE Carrying Net Value      : KSH ${reportFinancials.ppeCarrying.toLocaleString()}\n`;
    report += `  TOTAL AUDITED ASSETS          : KSH ${reportFinancials.totalAssets.toLocaleString()}\n\n`;
    
    report += `LIABILITIES:\n`;
    report += `  - Members savings & Deposits : KSH ${reportFinancials.membersDeposits.toLocaleString()}\n`;
    report += `  - Trade Payables & Accruals   : KSH ${reportFinancials.tradePayables.toLocaleString()}\n`;
    report += `  TOTAL AUDITED LIABILITIES     : KSH ${reportFinancials.totalLiabilities.toLocaleString()}\n\n`;

    report += `4. IFRS LEGAL AUDITOR OPINION\n`;
    report += `-------------------------------------------------------------------------\n`;
    report += `Subject: Compliance Audit on Co-operative Societies Act Cap 490\n`;
    report += `Opinion: In our professional administrative opinion, the books are kept in\n`;
    report += `perfect accordance with Kenya State Regulation, presenting a true & fair\n`;
    report += `view of the financial affairs of the Co-operative society.\n\n`;
    report += `Certified by order of the County Commissioner for Co-operative Development.\n`;

    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Audit_Compliance_Report_${reportRegNo.replace(/[\/\s.]/g, '_')}_${reportYear}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setDownloadSuccessMessage(`Success! Formal regulatory report for ${reportSaccoName} downloaded successfully.`);
    setTimeout(() => setDownloadSuccessMessage(''), 5000);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="flex-1 p-4 sm:p-8 overflow-y-auto bg-slate-100 font-sans flex flex-col space-y-6 min-h-0">
      
      {/* SECTION SELECTOR / TOP BANNER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-slate-300 gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-[9px] font-bold uppercase tracking-widest bg-slate-900 text-white px-2 py-0.5 rounded font-mono border border-slate-950">
              Cooperative Societies Act Cap 490 Registry
            </span>
          </div>
          <h2 className="text-xl font-bold font-display text-slate-800 mt-1">Sacco Audit &amp; Reporting Central</h2>
          <p className="text-xs text-slate-500">Generate real-time cash flow statements, dual-till ledger charts and print regulatory annual reports</p>
        </div>

        {/* Outer Section Switcher */}
        <div className="flex flex-col sm:flex-row gap-1.5 bg-slate-200 p-1 rounded-lg border border-slate-300">
          <button
            onClick={() => setActiveSection('cashless')}
            className={`px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-md flex items-center justify-center space-x-1.5 transition-all ${
              activeSection === 'cashless'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Co-op Accounts Hub</span>
          </button>
          
          <button
            onClick={() => setActiveSection('compliance')}
            className={`px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-md flex items-center justify-center space-x-1.5 transition-all ${
              activeSection === 'compliance'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-amber-500" />
            <span>Kenyan Audit Book</span>
          </button>

          <button
            onClick={() => setActiveSection('accountant')}
            className={`px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-md flex items-center justify-center space-x-1.5 transition-all ${
              activeSection === 'accountant'
                ? 'bg-emerald-800 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Scale className="w-3.5 h-3.5 text-emerald-400" />
            <span>Accountant GL &amp; Adjustments</span>
          </button>
        </div>
      </div>

      {downloadSuccessMessage && (
        <div className="bg-emerald-50 border-2 border-emerald-500 text-emerald-950 p-4 rounded flex items-center space-x-2.5 text-xs shadow-sm shrink-0">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-bold">{downloadSuccessMessage}</span>
        </div>
      )}

      {/* RENDER CASHLESS TILLS ARCHITECTURE SECTION */}
      {activeSection === 'cashless' && (
        <>
          {/* Till Switcher Selector Tabs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <button
              onClick={() => setActiveTillTab('conjunction')}
              className={`text-left p-5 rounded border-2 transition-all flex flex-col justify-between ${
                activeTillTab === 'conjunction'
                  ? 'bg-amber-50 border-amber-500 shadow-[4px_4px_0px_rgba(245,158,11,1)]'
                  : 'bg-white border-slate-200 hover:border-slate-400 shadow-xs'
              }`}
            >
              <div className="w-full flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono">CONJUNCTION VIEW</span>
                <Layers className={`w-4 h-4 ${activeTillTab === 'conjunction' ? 'text-amber-600' : 'text-slate-400'}`} />
              </div>
              <div className="mt-4">
                <p className="text-2xl font-black text-slate-900 font-mono">KES {netBalance.toLocaleString()}.00</p>
                <p className="text-[10px] text-slate-500 mt-1 font-medium uppercase tracking-wide">Merged Accounts &amp; Assets</p>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between w-full">
                <span className="text-[9px] font-mono uppercase bg-slate-900 text-white px-2 py-0.5 rounded-sm">Merged (T1 + T2)</span>
                <span className="text-[10px] text-amber-700 font-bold hover:underline">Reconciliation Map &rarr;</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTillTab('vehicle')}
              className={`text-left p-5 rounded border-2 transition-all flex flex-col justify-between ${
                activeTillTab === 'vehicle'
                  ? 'bg-emerald-50 border-emerald-600 shadow-[4px_4px_0px_rgba(5,150,105,1)]'
                  : 'bg-white border-slate-200 hover:border-slate-400 shadow-xs'
              }`}
            >
              <div className="w-full flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono">OPERATIONS / DAILY (48277)</span>
                <Wallet className={`w-4 h-4 ${activeTillTab === 'vehicle' ? 'text-emerald-600' : 'text-slate-400'}`} />
              </div>
              <div className="mt-4">
                <p className="text-2xl font-black text-emerald-950 font-mono">KES {vehicleNet.toLocaleString()}.00</p>
                <p className="text-[10px] text-slate-500 mt-1 font-medium uppercase tracking-wide">Fleet Deposits &amp; Contributions</p>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between w-full">
                <span className="text-[9px] font-mono uppercase bg-emerald-700 text-white px-2 py-0.5 rounded-sm">Till Segregation Active</span>
                <span className="text-[10px] text-emerald-700 font-bold hover:underline">Inspect Fleet &rarr;</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTillTab('utility')}
              className={`text-left p-5 rounded border-2 transition-all flex flex-col justify-between ${
                activeTillTab === 'utility'
                  ? 'bg-blue-50 border-blue-600 shadow-[4px_4px_0px_rgba(37,99,235,1)]'
                  : 'bg-white border-slate-200 hover:border-slate-400 shadow-xs'
              }`}
            >
              <div className="w-full flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono">MEMBER SAVINGS (871671)</span>
                <Server className={`w-4 h-4 ${activeTillTab === 'utility' ? 'text-blue-600' : 'text-slate-400'}`} />
              </div>
              <div className="mt-4">
                <p className="text-2xl font-black text-blue-950 font-mono">KES {utilityNet.toLocaleString()}.00</p>
                <p className="text-[10px] text-slate-500 mt-1 font-medium uppercase tracking-wide">General Administration &amp; Utilities</p>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between w-full">
                <span className="text-[9px] font-mono uppercase bg-blue-700 text-white px-2 py-0.5 rounded-sm">Operational Ledger</span>
                <span className="text-[10px] text-blue-700 font-bold hover:underline">Inspect Savings &rarr;</span>
              </div>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-8 space-y-6">
              {activeTillTab === 'conjunction' && (
                <div className="bg-white border-2 border-slate-900 rounded shadow-sm overflow-hidden">
                  <div className="px-6 py-4 bg-slate-900 border-b border-slate-900 flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-white">
                      <Layers className="w-4 h-4 text-amber-400" />
                      <h3 className="text-xs font-black uppercase tracking-wider font-display">Combined Sacco Conjunction Balance Sheet</h3>
                    </div>
                    <span className="text-[10px] font-mono bg-amber-500 text-slate-900 font-black px-2 py-0.5 rounded">Annual Reconciliation Ready</span>
                  </div>

                  <div className="p-6 space-y-6">
                    <div className="border-l-4 border-amber-500 bg-amber-50/50 p-4 rounded text-xs text-slate-700 leading-normal">
                      <strong className="text-amber-950 block mb-1 flex items-center">
                        <Sparkles className="w-4 h-4 mr-1 text-amber-600" /> Sowetamu Sacco Dual-Till Segregation Policy
                      </strong>
                      To separate fleet collections from operations, Sowetamu Sacco runs isolated tills. While transaction streams are separate, this automated conjunction ledger merges them to evaluate total capital reserves.
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="border border-slate-200 p-4 rounded">
                        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide border-b pb-2 mb-3">
                          Operations / Daily Account (48277)
                        </h4>
                        <div className="space-y-2 text-xs">
                          <div className="flex justify-between">
                            <span className="text-slate-500">Gross Deposits:</span>
                            <span className="font-mono font-bold text-emerald-700">KES {vehicleCredits.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Fleet Withdrawals:</span>
                            <span className="font-mono font-bold text-rose-600">KES {vehicleDebits.toLocaleString()}</span>
                          </div>
                          <div className="border-t pt-2 flex justify-between font-bold">
                            <span>Net Part-Balance:</span>
                            <span className="font-mono text-slate-900">KES {vehicleNet.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>

                      <div className="border border-slate-200 p-4 rounded">
                        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide border-b pb-2 mb-3">
                          Member Savings Account (871671)
                        </h4>
                        <div className="space-y-2 text-xs">
                          <div className="flex justify-between">
                            <span className="text-slate-500">General Deposits:</span>
                            <span className="font-mono font-bold text-emerald-700">KES {utilityCredits.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Administrative Debits:</span>
                            <span className="font-mono font-bold text-rose-600">KES {utilityDebits.toLocaleString()}</span>
                          </div>
                          <div className="border-t pt-2 flex justify-between font-bold">
                            <span>Net Part-Balance:</span>
                            <span className="font-mono text-slate-900">KES {utilityNet.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-900 text-white p-4 rounded-lg font-mono text-xs flex flex-col md:flex-row md:items-center justify-between border border-slate-900">
                      <div className="flex items-center space-x-2">
                        <span className="bg-emerald-500 text-slate-950 text-[10px] font-black px-2 py-0.5 rounded">FORMULA</span>
                        <span>Unified Net Asset = T1 + T2 + Petty Cash</span>
                      </div>
                      <div className="mt-2 md:mt-0 text-amber-400 font-bold">
                        KES {vehicleNet.toLocaleString()} + KES {utilityNet.toLocaleString()} + KES {cashNet.toLocaleString()} = KES {netBalance.toLocaleString()}
                      </div>
                    </div>

                    <div>
                      <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 mb-3 font-display">Combined Transaction Conjunction (All Accounts)</h4>
                      <div className="overflow-x-auto border border-slate-200 rounded">
                        <table className="w-full text-left">
                          <thead className="bg-slate-100 text-[9px] text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                            <tr>
                              <th className="px-4 py-2">Date</th>
                              <th className="px-4 py-2">Co-op Account</th>
                              <th className="px-4 py-2">Category</th>
                              <th className="px-4 py-2">Memo Description</th>
                              <th className="px-4 py-2 text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-xs">
                            {transactions.map(t => (
                              <tr key={t.id} className="hover:bg-slate-50">
                                <td className="px-4 py-3 font-mono text-slate-600">
                                  <div>{t.timestamp.substring(0, 10)}</div>
                                  <div className="text-[10px] text-slate-400 uppercase tracking-widest">{t.refCode}</div>
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded ${
                                    t.tillNumber === 'VehicleTill' 
                                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
                                      : t.tillNumber === 'UtilityTill' 
                                      ? 'bg-blue-50 text-blue-800 border border-blue-200' 
                                      : 'bg-slate-100 text-slate-700'
                                  }`}>
                                    {t.tillNumber === 'VehicleTill' ? 'Account: 48277' : t.tillNumber === 'UtilityTill' ? 'Account: 871671' : 'Cash Box'}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-slate-700 font-medium">{t.category}</td>
                                <td className="px-4 py-3 text-slate-500 text-[11px]">{t.description}</td>
                                <td className="px-4 py-3 text-right font-mono font-bold text-xs">
                                  <span className={t.type === 'Credit' ? 'text-emerald-700' : 'text-rose-600'}>
                                    {t.type === 'Credit' ? '+' : '-'} {t.amount.toLocaleString()}.00
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTillTab === 'vehicle' && (
                <div className="bg-white border-2 border-emerald-600 rounded shadow-sm overflow-hidden">
                  <div className="px-6 py-4 bg-emerald-950 border-b border-emerald-800 flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-white">
                      <Wallet className="w-4 h-4 text-emerald-400" />
                      <h3 className="text-xs font-black uppercase tracking-wider font-display">Operations / Daily Ledger (Account 48277)</h3>
                    </div>
                    <span className="text-[10px] font-mono bg-emerald-500 text-emerald-950 font-black px-2.5 py-0.5 rounded">Fleet Core Collections</span>
                  </div>

                  <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="border border-slate-200 p-4 rounded bg-slate-50">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Gross Fleet Deposits</p>
                        <p className="text-xl font-bold font-mono text-emerald-800 mt-1">KES {vehicleCredits.toLocaleString()}</p>
                        <span className="text-[9px] text-slate-500">Registration &amp; collection fees</span>
                      </div>
                      <div className="border border-slate-200 p-4 rounded bg-slate-50">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Withdrawn / Allocated</p>
                        <p className="text-xl font-bold font-mono text-rose-700 mt-1">KES {vehicleDebits.toLocaleString()}</p>
                        <span className="text-[9px] text-slate-500">Transferred out to Sacco reserve</span>
                      </div>
                      <div className="border border-slate-200 p-4 rounded bg-slate-50">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Till Net Asset Value</p>
                        <p className="text-xl font-bold font-mono text-slate-900 mt-1">KES {vehicleNet.toLocaleString()}</p>
                        <span className="text-[9px] text-emerald-600 font-semibold">100% cashless custody</span>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">Operations Account Ledger Logs</h4>
                      {vehicleTx.length === 0 ? (
                        <div className="text-center py-8 border border-dashed rounded text-xs text-slate-400">
                          No transactions recorded under account 48277
                        </div>
                      ) : (
                        <div className="overflow-x-auto border border-slate-200 rounded">
                          <table className="w-full text-left">
                            <thead className="bg-slate-100 text-[9px] text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                              <tr>
                                <th className="px-4 py-2">Date</th>
                                <th className="px-4 py-2">Category</th>
                                <th className="px-4 py-2">Description</th>
                                <th className="px-4 py-2">Recorder</th>
                                <th className="px-4 py-2 text-right">Amount</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-xs">
                              {vehicleTx.map(t => (
                                <tr key={t.id} className="hover:bg-slate-50">
                                  <td className="px-4 py-3 font-mono text-slate-600">
                                    <div>{t.timestamp.substring(0, 10)}</div>
                                    <div className="text-[10px] text-slate-400 uppercase tracking-widest">{t.refCode}</div>
                                  </td>
                                  <td className="px-4 py-3 text-emerald-800 font-bold text-[11px]">{t.category}</td>
                                  <td className="px-4 py-3 text-slate-600 text-[11px]">{t.description}</td>
                                  <td className="px-4 py-3 text-slate-500 text-[11px]">{t.recorderName}</td>
                                  <td className="px-4 py-3 text-right font-mono font-bold text-xs text-emerald-700">
                                    + KES {t.amount.toLocaleString()}.00
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTillTab === 'utility' && (
                <div className="bg-white border-2 border-blue-600 rounded shadow-sm overflow-hidden">
                  <div className="px-6 py-4 bg-blue-950 border-b border-blue-800 flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-white">
                      <Server className="w-4 h-4 text-blue-400" />
                      <h3 className="text-xs font-black uppercase tracking-wider font-display">Member Savings Ledger (Account 871671)</h3>
                    </div>
                    <span className="text-[10px] font-mono bg-blue-500 text-blue-950 font-black px-2.5 py-0.5 rounded">Sacco Operations Drawer</span>
                  </div>

                  <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="border border-slate-200 p-4 rounded bg-slate-50">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Deposits / Allocations</p>
                        <p className="text-xl font-bold font-mono text-blue-800 mt-1">KES {utilityCredits.toLocaleString()}</p>
                        <span className="text-[9px] text-slate-500">Transferred from main pool</span>
                      </div>
                      <div className="border border-slate-200 p-4 rounded bg-slate-50">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Disbursements &amp; Expenses</p>
                        <p className="text-xl font-bold font-mono text-rose-700 mt-1">KES {utilityDebits.toLocaleString()}</p>
                        <span className="text-[9px] text-slate-500">Office stationery, equipment, utilities</span>
                      </div>
                      <div className="border border-slate-200 p-4 rounded bg-slate-50">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Till Operating Balance</p>
                        <p className="text-xl font-bold font-mono text-slate-900 mt-1">KES {utilityNet.toLocaleString()}</p>
                        <span className="text-[9px] text-blue-600 font-semibold">Allocated operational fluid budget</span>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">Operating Till Dedicated Ledger Logs</h4>
                      {utilityTx.length === 0 ? (
                        <div className="text-center py-8 border border-dashed rounded text-xs text-slate-400">
                          No savings deposits recorded under account 871671
                        </div>
                      ) : (
                        <div className="overflow-x-auto border border-slate-200 rounded">
                          <table className="w-full text-left">
                            <thead className="bg-slate-100 text-[9px] text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                              <tr>
                                <th className="px-4 py-2">Date</th>
                                <th className="px-4 py-2">Category</th>
                                <th className="px-4 py-2">Disbursement Memo</th>
                                <th className="px-4 py-2">Disbursed By</th>
                                <th className="px-4 py-2 text-right">Amount</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-xs">
                              {utilityTx.map(t => (
                                <tr key={t.id} className="hover:bg-slate-50">
                                  <td className="px-4 py-3 font-mono text-slate-600">
                                    <div>{t.timestamp.substring(0, 10)}</div>
                                    <div className="text-[10px] text-slate-400 uppercase tracking-widest">{t.refCode}</div>
                                  </td>
                                  <td className="px-4 py-3 text-blue-800 font-bold text-[11px]">{t.category}</td>
                                  <td className="px-4 py-3 text-slate-600 text-[11px]">{t.description}</td>
                                  <td className="px-4 py-3 text-slate-500 text-[11px]">{t.recorderName}</td>
                                  <td className="px-4 py-3 text-right font-mono font-bold text-xs text-rose-600">
                                    - KES {t.amount.toLocaleString()}.00
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT COLUMN: Sidebar Stats & Document Services */}
            <div className="lg:col-span-4 space-y-6 animate-fade-in">
              <div className="bg-white border-2 border-slate-900 rounded p-6 shadow-sm">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 border-b pb-2 mb-4 font-display">
                  Category Allocation Pools
                </h3>
                <div className="space-y-4">
                  {Object.entries(categorySummary).map(([category, amount]) => {
                    const isCredit = category !== 'Office Expenses' && category !== 'Petty Cash' && category !== 'Utilities' && category !== 'Equipment';
                    return (
                      <div key={category} className="pb-3 border-b border-slate-100 last:border-0 last:pb-0">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-semibold text-slate-700">{category}</span>
                          <span className={`font-mono font-bold ${isCredit ? 'text-emerald-700' : 'text-rose-600'}`}>
                            {isCredit ? '+' : '-'} KES {amount.toLocaleString()}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full mt-2">
                          <div
                            className={`h-full rounded-full ${isCredit ? 'bg-emerald-600' : 'bg-rose-500'}`}
                            style={{ width: `${Math.min((amount / Math.max(totalCredits, 1)) * 100, 100)}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-white border-2 border-slate-900 rounded p-6 shadow-sm flex flex-col space-y-4">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 border-b pb-2 font-display">
                  Export Ledger Services
                </h3>
                <p className="text-[11px] text-slate-600 leading-normal font-medium">
                  Sowetamu Sacco's cashless dual-till transactions can be merged into unified statements instantly for AGM compliance and state auditors. Select a format below:
                </p>

                <div className="space-y-2 pt-2">
                  <button
                    onClick={() => triggerDownload('TXT')}
                    id="export-txt-report-button"
                    className="py-2.5 w-full bg-slate-900 hover:bg-slate-800 text-white font-black text-xs uppercase tracking-wider rounded border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none transition-all flex items-center justify-center space-x-2"
                  >
                    <Download className="w-4 h-4 text-emerald-400" />
                    <span>Download Plain Text (.TXT)</span>
                  </button>

                  <button
                    onClick={() => triggerDownload('CSV')}
                    id="export-csv-report-button"
                    className="py-2.5 w-full bg-white hover:bg-slate-50 text-slate-800 font-black text-xs uppercase tracking-wider rounded border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none transition-all flex items-center justify-center space-x-2"
                  >
                    <Download className="w-4 h-4 text-blue-600" />
                    <span>Export Excel Sheet (.CSV)</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* RENDER COMPLIANCE ANNUAL REPORT WORKSPACE */}
      {activeSection === 'compliance' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          
          {/* TOBACCO/BOOK TOC SIDEBAR (4 Cols) */}
          <div className="xl:col-span-3 space-y-4">
            
            {/* Report Source Config */}
            <div className="bg-white border-2 border-amber-500 rounded p-4 shadow-sm space-y-3">
              <span className="text-[9px] font-black tracking-widest uppercase bg-amber-500 text-slate-950 px-2 py-0.5 rounded font-mono">
                REGULATORY AUDIT REPORT TARGET
              </span>
              
              <div className="space-y-2">
                <button
                  onClick={() => {
                    setReportDataSource('sowetamu');
                    setSaccoRegNo('CS/NO. 22239');
                  }}
                  className={`w-full text-left p-2 rounded text-xs flex items-center justify-between border ${
                    reportDataSource === 'sowetamu'
                      ? 'bg-amber-50/70 border-amber-500 text-amber-950 font-bold'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span>Sowetamu Sacco (2024 Reference)</span>
                  <span className="text-[9px] font-mono opacity-80">CS/NO 22239</span>
                </button>

                <button
                  onClick={() => {
                    setReportDataSource('live');
                    setSaccoRegNo('CS/NO. 48190');
                  }}
                  className={`w-full text-left p-2 rounded text-xs flex items-center justify-between border ${
                    reportDataSource === 'live'
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-950 font-bold'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span>Sowetamu Sacco (2026 Live Audit)</span>
                  <span className="text-[9px] font-mono text-emerald-600 font-bold">Dynamic</span>
                </button>
              </div>

              {/* Edit Committee Names Button */}
              <button
                onClick={() => setShowEditCommittee(!showEditCommittee)}
                className="w-full text-center py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-[10px] uppercase tracking-wider rounded"
              >
                {showEditCommittee ? 'Hide Report Meta Controls' : 'Edit Committee & Registry Info'}
              </button>
            </div>

            {/* Dynamic Committee Metadata Panel */}
            {showEditCommittee && (
              <div className="bg-white border border-slate-300 rounded p-4 space-y-3 shadow-xs">
                <h4 className="text-[10px] font-black uppercase text-slate-700 tracking-wider font-mono border-b pb-1">
                  Custom Report Registry Controls
                </h4>
                
                <div className="space-y-2.5 text-xs">
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 uppercase">Sacco Name</label>
                    <input
                      type="text"
                      value={saccoCustomName}
                      onChange={(e) => setSaccoCustomName(e.target.value)}
                      className="w-full p-1 border border-slate-200 rounded font-mono text-[11px]"
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 uppercase">CS Registration No</label>
                    <input
                      type="text"
                      value={saccoRegNo}
                      onChange={(e) => setSaccoRegNo(e.target.value)}
                      className="w-full p-1 border border-slate-200 rounded font-mono text-[11px]"
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 uppercase">Chairman</label>
                    <input
                      type="text"
                      value={chairmanName}
                      onChange={(e) => setChairmanName(e.target.value)}
                      className="w-full p-1 border border-slate-200 rounded font-mono text-[11px]"
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 uppercase">Secretary</label>
                    <input
                      type="text"
                      value={secretaryName}
                      onChange={(e) => setSecretaryName(e.target.value)}
                      className="w-full p-1 border border-slate-200 rounded font-mono text-[11px]"
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 uppercase">Treasurer</label>
                    <input
                      type="text"
                      value={treasurerName}
                      onChange={(e) => setTreasurerName(e.target.value)}
                      className="w-full p-1 border border-slate-200 rounded font-mono text-[11px]"
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 uppercase">Principal Banker</label>
                    <input
                      type="text"
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      className="w-full p-1 border border-slate-200 rounded font-mono text-[11px]"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* BOOK NAVIGATION (TABLE OF CONTENTS) */}
            <div className="bg-white border-2 border-slate-900 rounded overflow-hidden shadow-xs">
              <div className="bg-slate-900 text-white p-3 text-xs font-bold uppercase tracking-wider font-mono">
                Book Table of Contents
              </div>
              
              <div className="divide-y divide-slate-100 flex flex-col">
                {[
                  { id: 'cover', label: 'Cover Page & Identity', page: 'Cover' },
                  { id: 'demand', label: 'Audit supervision Fee Letter', page: 'Intro' },
                  { id: 'info', label: 'Society General Information', page: 'Page 1' },
                  { id: 'report', label: 'Report of the Management Committee', page: 'Page 2' },
                  { id: 'stat', label: 'Certified Statistical Information', page: 'Page 3' },
                  { id: 'resp', label: 'Management Responsibilities Statement', page: 'Page 4' },
                  { id: 'auditor', label: 'Independent Sacco Auditor Report', page: 'Page 5' },
                  { id: 'balance', label: 'Certified Balance Sheet', page: 'Page 7' },
                  { id: 'notes', label: 'Accounts Notes & Asset Depreciation', page: 'Page 10' },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setComplianceActivePage(item.id)}
                    className={`w-full text-left p-3 text-xs flex items-center justify-between transition-colors ${
                      complianceActivePage === item.id
                        ? 'bg-amber-50 text-amber-950 font-black border-l-4 border-amber-500 shadow-inner'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span>{item.label}</span>
                    <span className="font-mono text-[10px] text-slate-400 font-bold">{item.page}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Document Print/Export Controls */}
            <div className="bg-white border border-slate-300 rounded p-4 space-y-2.5">
              <button
                onClick={handlePrint}
                className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold uppercase tracking-wider rounded border border-slate-950 flex items-center justify-center space-x-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none transition-all"
              >
                <Printer className="w-4 h-4" />
                <span>Print Active Booklet Page</span>
              </button>

              <button
                onClick={downloadComplianceReport}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold uppercase tracking-wider rounded flex items-center justify-center space-x-2 transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>Download Entire Audit Report (.TXT)</span>
              </button>
            </div>

          </div>

          {/* PRINT-COMPLIANT DOCUMENT PAPER CANVAS (9 Cols) */}
          <div className="xl:col-span-9">
            <div id="printable-compliance-document" className="bg-white border-2 border-slate-900 p-12 min-h-[850px] shadow-[6px_6px_0px_rgba(15,23,42,1)] rounded-sm relative text-slate-900 print:shadow-none print:border-0 print:p-0">
              
              {/* PAGE WATERMARK / TOP STAMPS */}
              <div className="absolute right-8 top-8 opacity-20 pointer-events-none flex flex-col items-center">
                <span className="text-[8px] font-bold font-mono text-slate-500 uppercase">REPUBLIC OF KENYA</span>
                <span className="text-[10px] font-black font-mono text-emerald-800 tracking-wider">CERTIFIED AUDITED REPORT</span>
              </div>

              {/* COVER PAGE */}
              {complianceActivePage === 'cover' && (
                <div className="flex flex-col items-center justify-between h-full space-y-16 py-12 animate-fade-in text-center">
                  
                  {/* Top block */}
                  <div className="space-y-2">
                    <span className="text-sm font-bold tracking-widest uppercase font-sans text-slate-600 block">REPUBLIC OF KENYA</span>
                    <span className="text-xs font-bold tracking-wider font-mono uppercase bg-slate-100 border border-slate-300 px-3 py-1 rounded block">
                      NAIROBI CITY COUNTY &bull; STATE DEPARTMENT FOR CO-OPERATIVES
                    </span>
                  </div>

                  {/* COAT OF ARMS EMBLEM DESIGN (GORGEOUS GEOMETRIC CUSTOM SVG) */}
                  <div className="w-40 h-40 relative flex items-center justify-center border-4 border-slate-900 p-2 rounded-full shadow-inner">
                    <svg viewBox="0 0 100 100" className="w-full h-full text-slate-800">
                      {/* Shield background */}
                      <path d="M50 15 L25 35 V60 C25 80 50 90 50 90 C50 90 75 80 75 60 V35 Z" fill="none" stroke="currentColor" strokeWidth="3" />
                      {/* Shield internal stripes */}
                      <path d="M26 40 L74 40" stroke="currentColor" strokeWidth="2" />
                      <path d="M28 50 L72 50" stroke="currentColor" strokeWidth="2" />
                      {/* Rooster / Lion Symbol minimal drawings */}
                      <circle cx="50" cy="45" r="4" fill="currentColor" />
                      <path d="M47 50 L53 50 L50 65 Z" fill="currentColor" />
                      {/* Spears crossing */}
                      <line x1="15" y1="15" x2="85" y2="85" stroke="currentColor" strokeWidth="2.5" />
                      <line x1="85" y1="15" x2="15" y2="85" stroke="currentColor" strokeWidth="2.5" />
                      {/* Lions on sides */}
                      <path d="M12 40 C15 35 22 45 22 55 L20 65 L10 65 Z" fill="none" stroke="currentColor" strokeWidth="2" />
                      <path d="M88 40 C85 35 78 45 78 55 L80 65 L90 65 Z" fill="none" stroke="currentColor" strokeWidth="2" />
                      {/* Harambee banner */}
                      <rect x="25" y="76" width="50" height="8" rx="2" fill="white" stroke="currentColor" strokeWidth="2" />
                      <text x="50" y="82" textAnchor="middle" fontSize="5" fontWeight="bold" fontFamily="monospace">HARAMBEE</text>
                    </svg>
                  </div>

                  {/* Sacco Identity titles */}
                  <div className="space-y-4">
                    <div className="text-base font-mono font-bold tracking-widest text-slate-600">
                      C/S NO. {reportRegNo}
                    </div>
                    
                    <h1 className="text-2xl font-black font-display text-slate-900 leading-tight uppercase max-w-xl">
                      {reportSaccoName} SAVINGS &amp; CREDIT CO-OPERATIVE SOCIETY LTD
                    </h1>

                    <div className="w-32 h-1 bg-slate-900 mx-auto rounded-full"></div>

                    <h2 className="text-base font-bold font-mono tracking-widest text-slate-800 uppercase mt-2">
                      ANNUAL REPORT &amp; CERTIFIED FINANCIAL STATEMENTS
                    </h2>

                    <p className="text-sm font-black font-mono text-emerald-800 bg-emerald-50 border border-emerald-200 px-4 py-1.5 rounded inline-block">
                      AS AT 31ST DECEMBER {reportYear}
                    </p>
                  </div>

                  {/* Bottom footer block */}
                  <div className="space-y-1.5 text-xs text-slate-500 font-mono">
                    <p className="font-bold uppercase text-slate-700">Ministry of Co-operatives and Micro, Small &amp; Medium Enterprise (MSMEs) Development</p>
                    <p>P.O. Box 40811 - 00100, Nairobi, Kenya</p>
                    <p>Website: www.cooperative.go.ke</p>
                  </div>
                </div>
              )}

              {/* AUDIT DEMAND NOTE (PAGE 1) */}
              {complianceActivePage === 'demand' && (
                <div className="space-y-6 animate-fade-in text-xs leading-relaxed text-slate-800">
                  
                  {/* Ministry Header Letter */}
                  <div className="border-b-2 border-slate-900 pb-4 text-center">
                    <h3 className="text-sm font-black font-mono uppercase tracking-wide">
                      MINISTRY OF CO-OPERATIVES AND MICRO, SMALL &amp; MEDIUM ENTERPRISE(MSMEs) DEVELOPMENT
                    </h3>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 mt-1">
                      STATE DEPARTMENT FOR CO-OPERATIVES
                    </h4>
                    
                    <div className="grid grid-cols-3 gap-2 mt-4 text-[10px] text-slate-500 font-mono text-left">
                      <div>
                        <p>Telegrams: "CO-OPS" Nairobi</p>
                        <p>Telephone: Nairobi 020 2731531/9</p>
                      </div>
                      <div className="text-center">
                        <p>Fax: Nairobi 020 240096</p>
                        <p>When replying please quote ref</p>
                      </div>
                      <div className="text-right">
                        <p>SOCIAL SECURITY HOUSE</p>
                        <p>BISHOPS ROAD, CAPITAL HILL</p>
                        <p>P.O. BOX 30547, NAIROBI</p>
                      </div>
                    </div>
                  </div>

                  {/* Date line */}
                  <div className="flex justify-between items-center font-mono">
                    <div>
                      <p className="font-bold">CS/NO: <span className="underline">{reportRegNo}</span></p>
                    </div>
                    <div>
                      <p className="font-bold">DATE: <span className="underline">14th May {parseInt(reportYear) + 1}</span></p>
                    </div>
                  </div>

                  {/* Address */}
                  <div className="space-y-1 font-mono">
                    <p className="font-bold uppercase">SOCIETY REGISTERED NAME:</p>
                    <p className="text-sm font-black underline uppercase">{reportSaccoName} SAVINGS &amp; CREDIT COOPERATIVE SOCIETY LTD</p>
                  </div>

                  {/* Title of letter */}
                  <div className="text-center border-y py-2 border-slate-200">
                    <h3 className="text-sm font-black underline uppercase font-display">AUDIT AND SUPERVISION FEES DEMAND NOTE</h3>
                  </div>

                  {/* Paragraphs */}
                  <p>
                    I attach official Miscellaneous Receipt(s) for <strong>KSH {reportAuditFee.toLocaleString()}.00</strong> (Twenty Five Thousand Five Hundred Shillings Only) in acknowledgement for your regulatory audit supervision remittance.
                  </p>

                  <p>
                    The outstanding compliance fee balance at the date of this clearance letter is <strong>KSH 0.00</strong> (FULLY RECONCILED COUNTY AUDIT STAMP APPROVED).
                  </p>

                  <div className="bg-amber-50 border border-amber-200 p-4 rounded font-mono text-[11px] text-amber-950 space-y-2">
                    <p className="font-bold flex items-center">
                      <Sparkles className="w-4 h-4 mr-1 text-amber-600" />
                      Handwritten Registry Note (Auditor Chamber):
                    </p>
                    <p className="italic">
                      "c/c Statutory reserves 1% charges on net loss has been charge on Net loss. Signed with full registry endorsement."
                    </p>
                  </div>

                  {/* Signatures */}
                  <div className="pt-8 grid grid-cols-2 gap-4">
                    <div>
                      <p className="font-bold uppercase">FOR: COMMISSIONER FOR COOPERATIVE DEVELOPMENT</p>
                      <div className="h-12 flex items-end">
                        <span className="font-mono text-xs text-slate-400 italic font-bold">Signed: JAVEL M. MURIRA (P2533), DCA</span>
                      </div>
                      <p className="border-t border-slate-400 pt-1 font-mono text-[10px]">CO-OPERATIVE AUDITOR COMMISSIONER OFFICE</p>
                    </div>

                    <div className="flex justify-end">
                      {/* Certified official Stamp Badge representation */}
                      <div className="border-4 border-dashed border-rose-600 p-3 rounded-md text-rose-600 font-bold font-mono text-[9px] uppercase tracking-wider text-center rotate-3 w-40">
                        <p className="border-b border-rose-600 pb-1 mb-1">REGISTERED AUDITED</p>
                        <p>14 MAY {parseInt(reportYear) + 1}</p>
                        <p className="mt-1 font-black text-[10px] text-slate-900 bg-rose-100 rounded-sm">CS/NO. {reportRegNo}</p>
                      </div>
                    </div>
                  </div>

                </div>
              )}

              {/* SOCIETY INFORMATION (PAGE 1) */}
              {complianceActivePage === 'info' && (
                <div className="space-y-6 animate-fade-in text-xs text-slate-800">
                  <div className="border-b pb-2 flex justify-between items-center font-mono">
                    <span className="font-bold text-slate-500">C/S NO. {reportRegNo}</span>
                    <span className="font-bold">SOCIETY INFORMATION</span>
                  </div>

                  <h3 className="text-sm font-black uppercase text-slate-900 border-b pb-1 font-display">
                    Society Management &amp; Committee Structure
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 leading-relaxed">
                    
                    {/* Management Committee */}
                    <div className="space-y-3">
                      <h4 className="font-bold uppercase text-slate-900 underline font-mono">MANAGEMENT COMMITTEE MEMBERS</h4>
                      <table className="w-full">
                        <tbody>
                          <tr className="border-b"><td className="py-1.5 font-bold">Chairman</td><td className="py-1.5 font-mono">{chairmanName}</td></tr>
                          <tr className="border-b"><td className="py-1.5 font-bold">Vice Chairman</td><td className="py-1.5 font-mono">John Waweru</td></tr>
                          <tr className="border-b"><td className="py-1.5 font-bold">Secretary</td><td className="py-1.5 font-mono">{secretaryName}</td></tr>
                          <tr className="border-b"><td className="py-1.5 font-bold">Treasurer</td><td className="py-1.5 font-mono">{treasurerName}</td></tr>
                          <tr className="border-b"><td className="py-1.5 font-bold">Member Credit</td><td className="py-1.5 font-mono">Bernice Wanjiru</td></tr>
                          <tr className="border-b"><td className="py-1.5 font-bold">Member Credit</td><td className="py-1.5 font-mono">Winnie Mbuthia</td></tr>
                          <tr className="border-b"><td className="py-1.5 font-bold">Member Credit</td><td className="py-1.5 font-mono">Martin Kairu</td></tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Supervisory Committee */}
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <h4 className="font-bold uppercase text-slate-900 underline font-mono">SUPERVISORY COMMITTEE</h4>
                        <table className="w-full">
                          <tbody>
                            <tr className="border-b"><td className="py-1.5 font-bold">Chairperson</td><td className="py-1.5 font-mono">{chairmanName}</td></tr>
                            <tr className="border-b"><td className="py-1.5 font-bold">Secretary</td><td className="py-1.5 font-mono">{secretaryName}</td></tr>
                            <tr className="border-b"><td className="py-1.5 font-bold">Treasurer</td><td className="py-1.5 font-mono">{treasurerName}</td></tr>
                          </tbody>
                        </table>
                      </div>

                      <div className="space-y-2 pt-2">
                        <h4 className="font-bold uppercase text-slate-900 underline font-mono">REGISTERED HEAD OFFICE</h4>
                        <p className="font-mono">Shujaa Mall, Kayole,</p>
                        <p className="font-mono">P.O. Box 1324 - 00518</p>
                        <p className="font-mono">Nairobi, Kenya</p>
                      </div>

                      <div className="space-y-2">
                        <h4 className="font-bold uppercase text-slate-900 underline font-mono">PRINCIPAL BANKER</h4>
                        <p className="font-mono font-bold">{bankName}</p>
                      </div>

                      <div className="space-y-2">
                        <h4 className="font-bold uppercase text-slate-900 underline font-mono">INDEPENDENT LEGAL AUDITORS</h4>
                        <p className="font-mono">Ministry of Co-operatives, Small &amp; Medium Enterprise</p>
                        <p className="font-mono">P.O. Box 30547 - 00100, Nairobi</p>
                      </div>
                    </div>

                  </div>
                </div>
              )}

              {/* REPORT OF THE MANAGEMENT COMMITTEE (PAGE 2) */}
              {complianceActivePage === 'report' && (
                <div className="space-y-6 animate-fade-in text-xs text-slate-800 leading-relaxed">
                  <div className="border-b pb-2 flex justify-between items-center font-mono">
                    <span className="font-bold text-slate-500">C/S NO. {reportRegNo}</span>
                    <span className="font-bold">MANAGEMENT COMMITTEE REPORT</span>
                  </div>

                  <h3 className="text-sm font-black uppercase text-slate-900 border-b pb-1 font-display">
                    Report of the Management Committee
                  </h3>

                  <p>
                    The members of the management committee submit their annual report together with the audited financial statements for the cooperative society year ended 31st December {reportYear}.
                  </p>

                  <h4 className="font-bold text-slate-900 uppercase underline font-mono">1. INCORPORATION STATUS</h4>
                  <p>
                    The society is incorporated in Kenya under the <strong>Co-operative Societies Act Cap 490</strong> of 1997 (Amended 2004) and is domiciled in the Republic of Kenya.
                  </p>

                  <h4 className="font-bold text-slate-900 uppercase underline font-mono">2. PRINCIPAL ACTIVITIES</h4>
                  <p>
                    The principal activity of the society remains receiving savings from members and providing affordable credit loans to its registered matatu vehicle operators.
                  </p>

                  <h4 className="font-bold text-slate-900 uppercase underline font-mono">3. CERTIFIED FINANCIAL AUDIT RESULTS</h4>
                  <div className="overflow-x-auto border border-slate-200 rounded">
                    <table className="w-full text-left font-mono">
                      <thead className="bg-slate-50 text-[10px] font-bold">
                        <tr>
                          <th className="px-4 py-2">FINANCIAL INDICATOR</th>
                          <th className="px-4 py-2 text-right">KES SHILLINGS ({reportYear})</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y text-xs">
                        <tr>
                          <td className="px-4 py-2 font-bold">Surplus Before Taxation</td>
                          <td className="px-4 py-2 text-right text-rose-700 font-bold">
                            ({Math.abs(reportFinancials.netSurplus).toLocaleString()}.00)
                          </td>
                        </tr>
                        <tr>
                          <td className="px-4 py-2 font-bold">Net Surplus / (Deficit) after taxation</td>
                          <td className="px-4 py-2 text-right text-rose-700 font-bold">
                            ({Math.abs(reportFinancials.netSurplus).toLocaleString()}.00)
                          </td>
                        </tr>
                        <tr className="bg-slate-50 font-bold">
                          <td className="px-4 py-2 text-slate-900">Retained Surplus/loss for the Year</td>
                          <td className="px-4 py-2 text-right text-rose-800">
                            ({Math.abs(reportFinancials.netSurplus).toLocaleString()}.00)
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <p className="italic">
                    "The Management Committee who served during the year and to the date of this audit report are as listed on Society Information Page."
                  </p>

                  <div className="pt-6 border-t border-slate-200">
                    <p className="font-bold">By order of the Management Committee:</p>
                    <div className="mt-8 flex justify-between items-center">
                      <div>
                        <div className="h-10 flex items-end">
                          <span className="font-mono text-slate-400 italic border-b border-slate-400 w-48 block">{secretaryName}</span>
                        </div>
                        <p className="font-mono text-[10px] mt-1 text-slate-500 uppercase">HON. SECRETARY</p>
                      </div>
                      <div>
                        <p className="font-mono font-bold">Date: 7th May {parseInt(reportYear) + 1}</p>
                      </div>
                    </div>
                  </div>

                </div>
              )}

              {/* STATISTICAL INFORMATION (PAGE 3) */}
              {complianceActivePage === 'stat' && (
                <div className="space-y-6 animate-fade-in text-xs text-slate-800">
                  <div className="border-b pb-2 flex justify-between items-center font-mono">
                    <span className="font-bold text-slate-500">C/S NO. {reportRegNo}</span>
                    <span className="font-bold">STATISTICAL INFORMATION</span>
                  </div>

                  <h3 className="text-sm font-black uppercase text-slate-900 border-b pb-1 font-display">
                    Certified Statistical Information Sheet
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Membership numbers */}
                    <div className="space-y-3">
                      <h4 className="font-bold uppercase text-slate-900 underline font-mono">Sacco Membership Count</h4>
                      <table className="w-full font-mono text-xs border">
                        <thead className="bg-slate-50">
                          <tr><th className="p-2 text-left">STATUS</th><th className="p-2 text-right">MEMBERS COUNT</th></tr>
                        </thead>
                        <tbody className="divide-y">
                          <tr><td className="p-2">Active Books List</td><td className="p-2 text-right font-bold">{reportMembers.active}</td></tr>
                          <tr><td className="p-2">Dormant Registry List</td><td className="p-2 text-right font-bold">{reportMembers.dormant}</td></tr>
                          <tr className="bg-slate-100 font-bold"><td className="p-2 text-slate-900">Total Book Registered</td><td className="p-2 text-right text-slate-900">{reportMembers.total}</td></tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Key financial indicators */}
                    <div className="space-y-3">
                      <h4 className="font-bold uppercase text-slate-900 underline font-mono">Sacco Key Ratios</h4>
                      <table className="w-full font-mono text-xs border">
                        <thead className="bg-slate-50">
                          <tr><th className="p-2 text-left">RATIO INDEX</th><th className="p-2 text-right">CERTIFIED RATIO</th></tr>
                        </thead>
                        <tbody className="divide-y">
                          <tr><td className="p-2">Liquidity Ratio (Assets/Liabilities)</td><td className="p-2 text-right font-bold text-emerald-800">2.5 : 1</td></tr>
                          <tr><td className="p-2">Expense / Revenue Percentage</td><td className="p-2 text-right font-bold text-rose-700">100.80%</td></tr>
                          <tr><td className="p-2">Bank Collection Account Segregation</td><td className="p-2 text-right font-bold text-emerald-600">100.00% Verified</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Financial metrics list */}
                  <div className="space-y-3 pt-4">
                    <h4 className="font-bold uppercase text-slate-900 underline font-mono">Certified Regulatory Auditor Balances (KES SHILLINGS)</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono border p-4 rounded bg-slate-50">
                      <div className="space-y-2">
                        <div className="flex justify-between border-b pb-1"><span>Members' Deposits:</span><span className="font-bold">KES {reportFinancials.membersDeposits.toLocaleString()}.00</span></div>
                        <div className="flex justify-between border-b pb-1"><span>Statutory Reserve:</span><span className="font-bold">KES ({Math.abs(reportFinancials.statutoryReserve).toLocaleString()}.00)</span></div>
                        <div className="flex justify-between border-b pb-1"><span>Retained Earnings deficit:</span><span className="font-bold">KES ({Math.abs(reportFinancials.retainedEarnings).toLocaleString()}.00)</span></div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between border-b pb-1"><span>Total Consolidated Assets:</span><span className="font-bold">KES {reportFinancials.totalAssets.toLocaleString()}.00</span></div>
                        <div className="flex justify-between border-b pb-1"><span>Active Member Loans Ledger:</span><span className="font-bold">KES {reportFinancials.loansToMembers.toLocaleString()}.00</span></div>
                        <div className="flex justify-between border-b pb-1"><span>Total Liabilities:</span><span className="font-bold">KES {reportFinancials.totalLiabilities.toLocaleString()}.00</span></div>
                      </div>
                    </div>
                  </div>

                </div>
              )}

              {/* STATEMENT OF MANAGEMENT RESPONSIBILITIES (PAGE 4) */}
              {complianceActivePage === 'resp' && (
                <div className="space-y-6 animate-fade-in text-xs text-slate-800 leading-relaxed text-justify">
                  <div className="border-b pb-2 flex justify-between items-center font-mono">
                    <span className="font-bold text-slate-500">C/S NO. {reportRegNo}</span>
                    <span className="font-bold">MANAGEMENT COMMITTEE RESPONSIBILITIES</span>
                  </div>

                  <h3 className="text-sm font-black uppercase text-slate-900 border-b pb-1 font-display">
                    Statement of Management Committee Responsibilities
                  </h3>

                  <p>
                    The Co-operative Societies Act Cap 490 requires the Management Committee to prepare accounts for each financial year, which give a true and fair view of the state of affairs of the Society at the end of the financial year and its operating results for that year in accordance with International Financial Reporting Standards (IFRS).
                  </p>

                  <p>
                    The Management Committee is also responsible for safeguarding the assets of the Society and ensuring that the business is conducted in accordance to its objectives, by-laws and any other resolutions made at the general meetings.
                  </p>

                  <p>
                    The Management Committee accepts responsibility for the preparation of Annual financial statements, which have been prepared using appropriate accounting policies supported by reasonable and prudent judgments and estimates, in conformity with IFRS and the Co-operative Societies Act.
                  </p>

                  <p>
                    Nothing has come to the attention of the Management Committee to indicate that the Society will not remain a going concern for at least the next twelve months from the date of this statement.
                  </p>

                  <p className="font-bold">Approved by the Management Committee on behalf of the Sacco:</p>

                  <div className="grid grid-cols-3 gap-4 pt-12 text-center font-mono text-[10px]">
                    <div>
                      <div className="h-8 border-b border-slate-400 flex items-end justify-center text-slate-400 italic">
                        {chairmanName}
                      </div>
                      <p className="mt-1 font-bold">CHAIRPERSON</p>
                    </div>

                    <div>
                      <div className="h-8 border-b border-slate-400 flex items-end justify-center text-slate-400 italic">
                        {treasurerName}
                      </div>
                      <p className="mt-1 font-bold">TREASURER</p>
                    </div>

                    <div>
                      <div className="h-8 border-b border-slate-400 flex items-end justify-center text-slate-400 italic">
                        {secretaryName}
                      </div>
                      <p className="mt-1 font-bold">SECRETARY</p>
                    </div>
                  </div>

                  <p className="text-center font-bold font-mono pt-4 text-slate-700">Date: 7th May {parseInt(reportYear) + 1}</p>
                </div>
              )}

              {/* INDEPENDENT AUDITOR'S REPORT (PAGE 5) */}
              {complianceActivePage === 'auditor' && (
                <div className="space-y-6 animate-fade-in text-xs text-slate-800 leading-relaxed text-justify">
                  <div className="border-b pb-2 flex justify-between items-center font-mono">
                    <span className="font-bold text-slate-500">C/S NO. {reportRegNo}</span>
                    <span className="font-bold">INDEPENDENT AUDITOR REPORT</span>
                  </div>

                  <h3 className="text-sm font-black uppercase text-slate-900 border-b pb-1 font-display">
                    Report of the Independent Auditor to Sacco Members
                  </h3>

                  <p>
                    We have audited the financial statements of <strong>{reportSaccoName} Savings &amp; Credit Co-operative Society Ltd</strong>, which comprise the Balance Sheet as at 31st December {reportYear}, the Income Statement, and Cash Flow Statement for the year then ended.
                  </p>

                  <h4 className="font-bold uppercase text-slate-900 font-mono underline">Auditor opinion:</h4>
                  <p>
                    In our opinion, the accompanying financial statements give a true and fair view of the state of the Society's financial position as at 31st December {reportYear} and of its financial performance and cash flows for the year then ended in accordance with International Financial Reporting Standards (IFRS) and have been prepared in accordance with the Kenyan Co-operative Societies Act Cap 490.
                  </p>

                  <h4 className="font-bold uppercase text-slate-900 font-mono underline">Basis for Opinion:</h4>
                  <p>
                    We conducted our audit in accordance with International Standards on Auditing. Our responsibilities under those standards are further described in the Auditor's Responsibilities section of our report. We are independent of the Society in accordance with international ethical requirements. We believe that the audit evidence we have obtained is sufficient and appropriate to provide a basis for our opinion.
                  </p>

                  <div className="pt-6 border-t border-slate-200 grid grid-cols-2 gap-4">
                    <div>
                      <p className="font-bold">CPA BETTY C. RONO</p>
                      <p className="font-mono text-[10px] text-slate-500">DEPUTY COUNTY DIRECTOR CO-OP AUDIT</p>
                      <p className="font-mono text-[10px] text-slate-500">NAIROBI CITY COUNTY</p>
                    </div>
                    <div className="flex flex-col items-end">
                      <p className="font-mono font-bold">Date: 14th May {parseInt(reportYear) + 1}</p>
                      <div className="mt-2 border-2 border-slate-950 px-2 py-1 bg-slate-50 font-mono text-[10px] font-black text-slate-800 rotate-2 text-center uppercase tracking-widest">
                        NAIROBI COUNTY AUDIT CLEARANCE
                      </div>
                    </div>
                  </div>

                </div>
              )}

              {/* CERTIFIED BALANCE SHEET (PAGE 7) */}
              {complianceActivePage === 'balance' && (
                <div className="space-y-6 animate-fade-in text-xs text-slate-800">
                  <div className="border-b pb-2 flex justify-between items-center font-mono">
                    <span className="font-bold text-slate-500">C/S NO. {reportRegNo}</span>
                    <span className="font-bold">RECONCILED BALANCE SHEET</span>
                  </div>

                  <div className="text-center">
                    <h2 className="text-sm font-black uppercase font-display">{reportSaccoName} SAVINGS &amp; CREDIT CO-OPERATIVE SOCIETY LTD</h2>
                    <h3 className="text-xs font-bold font-mono tracking-wider text-slate-600 mt-0.5">CERTIFIED BALANCE SHEET AS AT 31ST DECEMBER {reportYear}</h3>
                  </div>

                  <table className="w-full text-left font-mono border-t border-b-2 border-slate-900 mt-4">
                    <thead>
                      <tr className="bg-slate-50 text-[10px] border-b border-slate-900">
                        <th className="px-4 py-2 font-bold uppercase">ASSETS DESCRIPTION</th>
                        <th className="px-4 py-2 font-bold uppercase text-center">NOTES</th>
                        <th className="px-4 py-2 font-bold uppercase text-right">KES SHILLINGS ({reportYear})</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {/* ASSETS */}
                      <tr className="bg-slate-100/50"><td className="px-4 py-1.5 font-bold uppercase" colSpan={3}>NON-CURRENT &amp; CURRENT ASSETS</td></tr>
                      <tr>
                        <td className="px-4 py-2">Cash and cash equivalents</td>
                        <td className="px-4 py-2 text-center font-bold">6</td>
                        <td className="px-4 py-2 text-right font-bold">{reportFinancials.cashAndEquiv.toLocaleString()}.00</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2">Trade and other receivables</td>
                        <td className="px-4 py-2 text-center font-bold">-</td>
                        <td className="px-4 py-2 text-right font-bold">{reportFinancials.otherReceivables.toLocaleString()}.00</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2">Loans and Advances to Members</td>
                        <td className="px-4 py-2 text-center font-bold">8</td>
                        <td className="px-4 py-2 text-right font-bold">{reportFinancials.loansToMembers.toLocaleString()}.00</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2">Property, Plant and Equipment (PPE Net)</td>
                        <td className="px-4 py-2 text-center font-bold">13</td>
                        <td className="px-4 py-2 text-right font-bold underline">{reportFinancials.ppeCarrying.toLocaleString()}.00</td>
                      </tr>
                      <tr className="bg-slate-50 font-bold border-b border-slate-900">
                        <td className="px-4 py-2 uppercase text-slate-900 font-black">TOTAL AUDITED ASSETS</td>
                        <td className="px-4 py-2"></td>
                        <td className="px-4 py-2 text-right text-slate-900 font-black border-double border-b-4 border-slate-900">
                          KES {reportFinancials.totalAssets.toLocaleString()}.00
                        </td>
                      </tr>

                      {/* LIABILITIES */}
                      <tr className="bg-slate-100/50"><td className="px-4 py-1.5 font-bold uppercase" colSpan={3}>SACCO LIABILITIES</td></tr>
                      <tr>
                        <td className="px-4 py-2">Members savings &amp; deposits</td>
                        <td className="px-4 py-2 text-center font-bold">8</td>
                        <td className="px-4 py-2 text-right font-bold">{reportFinancials.membersDeposits.toLocaleString()}.00</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2">Trade, payables &amp; accrued expenses</td>
                        <td className="px-4 py-2 text-center font-bold">11</td>
                        <td className="px-4 py-2 text-right font-bold underline">{reportFinancials.tradePayables.toLocaleString()}.00</td>
                      </tr>
                      <tr className="bg-slate-50 font-bold border-b">
                        <td className="px-4 py-2 uppercase">TOTAL LIABILITIES</td>
                        <td className="px-4 py-2"></td>
                        <td className="px-4 py-2 text-right text-slate-900">KES {reportFinancials.totalLiabilities.toLocaleString()}.00</td>
                      </tr>

                    </tbody>
                  </table>

                  {/* Certified Approval Block with Wax Seal drawing */}
                  <div className="pt-8 flex justify-between items-center">
                    <div className="space-y-4 font-mono text-[9px]">
                      <p className="font-bold uppercase">The financial statements were authorized for release by Management Committee on:</p>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div><div className="border-b border-slate-400 h-6"></div><p className="mt-1">CHAIRMAN</p></div>
                        <div><div className="border-b border-slate-400 h-6"></div><p className="mt-1">SECRETARY</p></div>
                        <div><div className="border-b border-slate-400 h-6"></div><p className="mt-1">TREASURER</p></div>
                      </div>
                    </div>

                    {/* Official wax seal representation */}
                    <div className="relative w-24 h-24 flex items-center justify-center shrink-0">
                      <div className="absolute inset-0 bg-red-600 rounded-full opacity-90 animate-pulse border-4 border-double border-red-700 flex flex-col items-center justify-center text-white text-[7px] font-black font-mono uppercase text-center p-2 shadow-md rotate-12">
                        <p>SOWETAMU SACCO</p>
                        <p className="border-y border-white my-0.5">SEAL OF APPROVAL</p>
                        <p>NAIROBI</p>
                      </div>
                    </div>
                  </div>

                </div>
              )}

              {/* NOTES AND PPE SCHEDULE (PAGE 10) */}
              {complianceActivePage === 'notes' && (
                <div className="space-y-6 animate-fade-in text-xs text-slate-800">
                  <div className="border-b pb-2 flex justify-between items-center font-mono">
                    <span className="font-bold text-slate-500">C/S NO. {reportRegNo}</span>
                    <span className="font-bold">NOTES TO CERTIFIED ACCOUNTS</span>
                  </div>

                  <h3 className="text-sm font-black uppercase text-slate-900 border-b pb-1 font-display">
                    Certified Audit Notes &amp; Schedules
                  </h3>

                  <div className="space-y-4 leading-relaxed font-mono">
                    <div>
                      <h4 className="font-bold uppercase text-slate-900 underline text-xs">Note 6: Cash and Cash Equivalents</h4>
                      <p className="mt-1">
                        Consists of bank collection accounts and floating reserve account balances merged for immediate operations clearance:
                      </p>
                      <table className="w-full text-left mt-2 border text-xs">
                        <tbody>
                          <tr className="border-b"><td className="p-2">Co-op Operations / Daily Account 48277</td><td className="p-2 text-right">KES {vehicleNet.toLocaleString()}.00</td></tr>
                          <tr className="border-b"><td className="p-2">Co-op Member Savings Account 871671</td><td className="p-2 text-right">KES {utilityNet.toLocaleString()}.00</td></tr>
                          <tr className="border-b"><td className="p-2">Floating Cash Box / Petty drawer</td><td className="p-2 text-right font-bold">KES {cashNet.toLocaleString()}.00</td></tr>
                          <tr className="bg-slate-50 font-bold"><td className="p-2">Total cash equivalents balance in books</td><td className="p-2 text-right">KES {reportFinancials.cashAndEquiv.toLocaleString()}.00</td></tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="pt-2">
                      <h4 className="font-bold uppercase text-slate-900 underline text-xs">Note 13: Property, Plant and Equipment Depreciation Schedule</h4>
                      <table className="w-full text-left mt-2 border text-xs">
                        <thead className="bg-slate-50 font-bold">
                          <tr>
                            <th className="p-2">ASSET TYPE</th>
                            <th className="p-2 text-right">COMPUTERS (25%)</th>
                            <th className="p-2 text-right">FURNITURE (12.5%)</th>
                            <th className="p-2 text-right">TOTAL KES SHILLINGS</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          <tr>
                            <td className="p-2 font-bold">Cost as at 31/12/{reportYear}</td>
                            <td className="p-2 text-right">78,000.00</td>
                            <td className="p-2 text-right">130,000.00</td>
                            <td className="p-2 text-right">208,000.00</td>
                          </tr>
                          <tr>
                            <td className="p-2 font-bold">Charge for the year</td>
                            <td className="p-2 text-right text-rose-600">(19,500.00)</td>
                            <td className="p-2 text-right text-rose-600">(16,250.00)</td>
                            <td className="p-2 text-right text-rose-600">(35,750.00)</td>
                          </tr>
                          <tr className="bg-slate-100 font-bold">
                            <td className="p-2 uppercase text-slate-900 font-black">Carrying Net Value</td>
                            <td className="p-2 text-right text-slate-900">58,500.00</td>
                            <td className="p-2 text-right text-slate-900">113,750.00</td>
                            <td className="p-2 text-right text-slate-900">172,250.00</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="pt-2 border-t mt-4 text-[10px] text-slate-500 text-justify italic">
                      <strong>General Regulatory Observation:</strong> "The Management Committee is advised to maintain an operating budget to control administrative expenditures in future cycles as recommended by the State Department for Co-operatives."
                    </div>
                  </div>

                </div>
              )}

              {/* Document footer page indicator */}
              <div className="absolute bottom-6 left-12 right-12 flex justify-between items-center text-[10px] text-slate-400 font-mono border-t pt-2 mt-8 print:hidden">
                <span>SOWETAMU SACCO AUDIT ARCHIVE</span>
                <span className="font-bold">PAGE {complianceActivePage === 'cover' ? 'I' : complianceActivePage === 'demand' ? 'II' : 'P' + complianceActivePage}</span>
              </div>

            </div>
          </div>

        </div>
      )}

      {/* RENDER ACCOUNTANT GENERAL LEDGER & ADJUSTMENTS SECTION */}
      {activeSection === 'accountant' && (
        <div className="space-y-6 animate-fade-in">
          
          {/* TOP RATIOS & HEALTH BOARD (SASRA REGULATION COMPLIANT) */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            
            {/* Liquidity Ratio */}
            <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm flex items-center justify-between">
              <div>
                <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-widest block">Liquidity Ratio</span>
                <span className="text-xl font-bold font-mono text-emerald-700 block mt-1">
                  {((reportFinancials.cashAndEquiv / (reportFinancials.membersDeposits || 1)) * 100).toFixed(1)}%
                </span>
                <span className="text-[10px] text-slate-500 mt-1 block">SASRA Min: <span className="font-bold">15.0%</span></span>
              </div>
              <div className="bg-emerald-50 text-emerald-800 p-2.5 rounded-lg border border-emerald-100">
                <Percent className="w-5 h-5" />
              </div>
            </div>

            {/* Operating Expense Ratio */}
            <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm flex items-center justify-between">
              <div>
                <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-widest block">OpEx Ratio</span>
                <span className="text-xl font-bold font-mono text-amber-700 block mt-1">
                  {((totalDebits / (totalCredits || 1)) * 100).toFixed(1)}%
                </span>
                <span className="text-[10px] text-slate-500 mt-1 block">Target Efficiency: <span className="font-bold">&lt; 35%</span></span>
              </div>
              <div className="bg-amber-50 text-amber-800 p-2.5 rounded-lg border border-amber-100">
                <TrendingUp className="w-5 h-5 text-amber-600" />
              </div>
            </div>

            {/* Total recorded assets */}
            <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm flex items-center justify-between">
              <div>
                <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-widest block">Total Recorded Assets</span>
                <span className="text-xl font-bold font-mono text-slate-900 block mt-1">
                  KES {reportFinancials.totalAssets.toLocaleString()}
                </span>
                <span className="text-[10px] text-emerald-600 font-bold mt-1 block flex items-center">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full mr-1 animate-pulse"></span> Audited Safe
                </span>
              </div>
              <div className="bg-slate-50 text-slate-800 p-2.5 rounded-lg border border-slate-200">
                <Coins className="w-5 h-5 text-slate-600" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* LEFT COLUMN: JOURNAL VOUCHER RECORD & ALERTS (5 Cols) */}
            <div className="lg:col-span-5 space-y-6">
              
              {/* Journal Voucher Input Card */}
              <div className="bg-white border-2 border-emerald-800 rounded-lg overflow-hidden shadow-xs">
                <div className="bg-emerald-800 text-white p-4 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <PenTool className="w-4 h-4 text-emerald-300" />
                    <h3 className="text-xs font-black uppercase tracking-wider font-mono">Journal Voucher Entry</h3>
                  </div>
                  <span className="text-[9px] font-mono bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded font-bold uppercase">
                    Audit Safe Double-Entry
                  </span>
                </div>

                <form onSubmit={async (e) => {
                  e.preventDefault();
                  if (!onAddTransaction) {
                    setJournalError("System database interface not available.");
                    return;
                  }
                  const amt = parseFloat(journalAmount);
                  if (isNaN(amt) || amt <= 0) {
                    setJournalError("Please enter a valid numeric amount greater than zero.");
                    return;
                  }
                  if (!journalDescription.trim()) {
                    setJournalError("A clear audit narrative/description is required.");
                    return;
                  }
                  if (!journalRefCode.trim()) {
                    setJournalError("A bank reference or cash voucher code is required.");
                    return;
                  }
                  if (journalRequiresRegistration) {
                    const member = members.find(item => item.id === journalMemberId && item.status === 'Active');
                    if (!member) {
                      setJournalError('Select an active registered member.');
                      return;
                    }
                    if (journalVehiclePlate) {
                      const vehicle = vehicles.find(item => item.plateNumber === journalVehiclePlate && item.status === 'Active');
                      if (!vehicle) {
                        setJournalError(`Car/V.REG "${journalVehiclePlate}" is not registered.`);
                        return;
                      }
                      if (vehicle.ownerId !== member.id) {
                        setJournalError(`Car/V.REG "${journalVehiclePlate}" is not registered under ${member.name}.`);
                        return;
                      }
                    }
                  }

                  try {
                    await onAddTransaction({
                      type: journalType,
                      category: journalCategory,
                      amount: amt,
                      description: journalDescription.trim(),
                      refCode: journalRefCode.toUpperCase().trim(),
                      tillNumber: journalTill,
                      memberId: journalRequiresRegistration ? journalMemberId : undefined,
                      memberName: journalRequiresRegistration ? members.find(m => m.id === journalMemberId)?.name : undefined,
                      vehiclePlate: journalRequiresRegistration ? journalVehiclePlate : undefined
                    });

                    setJournalSuccess(`Journal voucher successfully posted and written to Ledger! Ref: ${journalRefCode.toUpperCase()}`);
                    setJournalError('');
                    setJournalAmount('');
                    setJournalDescription('');
                    setJournalRefCode('');
                    setJournalMemberId('');
                    setJournalVehiclePlate('');
                    
                    setTimeout(() => {
                      setJournalSuccess('');
                    }, 5000);
                  } catch (error: any) {
                    setJournalError(error.message || 'Ledger posting failed.');
                    setJournalSuccess('');
                  }
                }} className="p-5 space-y-4 text-xs">
                  
                  {journalSuccess && (
                    <div className="bg-emerald-50 border border-emerald-500 text-emerald-950 p-3 rounded font-bold text-[11px]">
                      {journalSuccess}
                    </div>
                  )}

                  {journalError && (
                    <div className="bg-rose-50 border border-rose-500 text-rose-950 p-3 rounded font-bold text-[11px]">
                      {journalError}
                    </div>
                  )}

                  {/* Role Warning / Simulation Mode */}
                  {!canRole(currentUser ?? null, JOURNAL_WRITE_ROLES) ? (
                    <div className="bg-amber-50 border border-amber-300 text-amber-950 p-3 rounded space-y-2">
                      <p className="font-bold text-[11px] leading-tight">
                        Warning: Your current active profile [{currentUser?.role || 'Guest'}] is not a designated Accountant or Treasurer.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          // Allow posting anyway for this session with visual label
                          setJournalError('');
                        }}
                        className="w-full text-center bg-amber-600 hover:bg-amber-700 text-white font-bold py-1 rounded text-[10px] uppercase tracking-wide transition-all"
                      >
                        Bypass Profile Check (Simulation Accountant Access)
                      </button>
                    </div>
                  ) : (
                    <div className="bg-slate-50 p-2.5 rounded border border-slate-200 font-mono text-[10px] text-slate-600">
                      Posting ledger entry as Sacco Accountant: <span className="font-bold text-emerald-700">{currentUser?.name || 'Beatrice Ndwiga'}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Voucher Type</label>
                      <div className="grid grid-cols-2 gap-1.5 bg-slate-100 p-1 rounded-md border">
                        <button
                          type="button"
                          onClick={() => setJournalType('Credit')}
                          className={`py-1 rounded text-center text-[10px] font-bold transition-all ${
                            journalType === 'Credit'
                              ? 'bg-emerald-600 text-white'
                              : 'text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          Credit (In)
                        </button>
                        <button
                          type="button"
                          onClick={() => setJournalType('Debit')}
                          className={`py-1 rounded text-center text-[10px] font-bold transition-all ${
                            journalType === 'Debit'
                              ? 'bg-rose-600 text-white'
                              : 'text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          Debit (Out)
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Target Till Allocation</label>
                      <select
                        value={journalTill}
                        onChange={(e) => setJournalTill(e.target.value as any)}
                        className="w-full p-2 border border-slate-200 rounded font-mono text-xs focus:ring-1 focus:ring-emerald-600 focus:outline-none bg-white"
                      >
                        <option value="VehicleTill">Operations / Daily Account 48277</option>
                        <option value="UtilityTill">Member Savings Account 871671</option>
                        <option value="None">Floating Petty Cash Drawer</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Journal Account / Category</label>
                      <select
                        value={journalCategory}
                        onChange={(e) => {
                          const nextCategory = e.target.value as Transaction['category'];
                          setJournalCategory(nextCategory);
                          if (nextCategory === 'Savings Contribution') {
                            setJournalType('Credit');
                            setJournalTill('UtilityTill');
                          } else if (isExpenseTransactionCategory(nextCategory)) {
                            setJournalType('Debit');
                            setJournalTill('VehicleTill');
                          } else {
                            setJournalTill('VehicleTill');
                          }
                          if (!requiresRegisteredMember(nextCategory)) {
                            setJournalMemberId('');
                            setJournalVehiclePlate('');
                          }
                        }}
                        className="w-full p-2 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-emerald-600 focus:outline-none bg-white"
                      >
                        <option value="Daily Contribution">Daily Contribution</option>
                        <option value="Savings Contribution">Savings Contribution</option>
                        <option value="Registration Fee">Registration Fee</option>
                        <option value="Management Fee">Management Fee</option>
                        <option value="Office Expenses">Office Expenses</option>
                        <option value="Petty Cash">Petty Cash Adjustments</option>
                        <option value="Penalty">Fine / Penalty</option>
                        <option value="Utilities">Utilities &amp; Licences</option>
                        <option value="Equipment">Capital Asset / Equipment</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">KES Voucher Amount</label>
                      <input
                      type="number"
                      value={journalAmount}
                      onChange={(e) => setJournalAmount(sanitizeDecimalInput(e.target.value))}
                      inputMode="decimal"
                        className="w-full p-2 border border-slate-200 rounded font-mono text-xs focus:ring-1 focus:ring-emerald-600 focus:outline-none"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase">Audit Ref Code</label>
                        <button
                          type="button"
                          onClick={() => {
                            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                            let code = 'MPX';
                            for (let i = 0; i < 7; i++) {
                              code += chars.charAt(Math.floor(Math.random() * chars.length));
                            }
                            setJournalRefCode(code);
                          }}
                          className="text-[9px] text-emerald-700 hover:underline font-bold"
                        >
                          Auto-Generate Ref
                        </button>
                      </div>
                      <input
                      type="text"
                      value={journalRefCode}
                      onChange={(e) => setJournalRefCode(sanitizeReferenceCode(e.target.value))}
                        className="w-full p-2 border border-slate-200 rounded font-mono text-xs focus:ring-1 focus:ring-emerald-600 focus:outline-none uppercase"
                        required
                      />
                    </div>

                    {journalRequiresRegistration ? (
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Registered Member *</label>
                        <select
                          required
                          value={journalMemberId}
                          onChange={(e) => {
                            const nextMemberId = e.target.value;
                            setJournalMemberId(nextMemberId);
                            setJournalVehiclePlate('');
                          }}
                          className="w-full p-2 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-emerald-600 focus:outline-none bg-white"
                        >
                          <option value="">Select a registered member...</option>
                          {eligibleJournalMembers.map(m => (
                            <option key={m.id} value={m.id}>{m.name} ({m.idNumber})</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="rounded border border-rose-100 bg-rose-50 p-2 text-[10px] font-semibold text-rose-700">
                        Expense entries may be posted for an external person or supplier without a member or vehicle.
                      </div>
                    )}
                  </div>

                  {journalRequiresRegistration && (
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Onboarded Vehicle / V.REG (Optional)</label>
                      <select
                        value={journalVehiclePlate}
                        onChange={(e) => setJournalVehiclePlate(e.target.value)}
                        className="w-full p-2 border border-slate-200 rounded font-mono text-xs focus:ring-1 focus:ring-emerald-600 focus:outline-none bg-white"
                      >
                        <option value="">No vehicle attached</option>
                        {eligibleJournalVehicles.map(v => (
                          <option key={v.id} value={v.plateNumber}>{v.plateNumber} - {v.route}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Voucher Description / Audit Narrative</label>
                    <textarea
                      value={journalDescription}
                      onChange={(e) => setJournalDescription(e.target.value)}
                      rows={2}
                      className="w-full p-2 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-emerald-600 focus:outline-none"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 bg-emerald-800 hover:bg-emerald-900 text-white font-bold text-xs uppercase tracking-wider rounded-md shadow-xs transition-colors flex items-center justify-center space-x-2"
                  >
                    <PlusCircle className="w-4 h-4" />
                    <span>Post Journal Adjustment Entry</span>
                  </button>

                </form>
              </div>

            </div>

            {/* RIGHT COLUMN: GENERAL LEDGER TRIAL BALANCE & LEDGER EXPLORER (7 Cols) */}
            <div className="lg:col-span-7 space-y-6">
              
              {/* TRIAL BALANCE SHEET */}
              <div className="bg-white border-2 border-slate-900 rounded-lg overflow-hidden shadow-xs">
                <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Scale className="w-4 h-4 text-amber-400" />
                    <h3 className="text-xs font-black uppercase tracking-wider font-mono">Dynamic Sacco Trial Balance</h3>
                  </div>
                  <span className="text-[9px] font-mono bg-emerald-500 text-slate-950 px-2 py-0.5 rounded font-black">
                    Live Entries Only
                  </span>
                </div>

                <div className="p-4">
                  <p className="text-[10px] text-slate-500 mb-3 uppercase font-semibold font-mono border-b pb-1.5">
                    As of Audit Date: {new Date().toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </p>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left font-mono text-[11px] divide-y divide-slate-200">
                      <thead className="bg-slate-50 text-[10px] font-black text-slate-600 uppercase tracking-wider">
                        <tr>
                          <th className="p-2.5">Ledger Account</th>
                          <th className="p-2.5 text-right">Debit Balance (KES)</th>
                          <th className="p-2.5 text-right">Credit Balance (KES)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {/* 1. Cash and bank equivalents */}
                        <tr>
                          <td className="p-2.5 font-bold">Cash at Bank &amp; Collection Accounts</td>
                          <td className="p-2.5 text-right text-emerald-800">
                            {reportFinancials.cashAndEquiv >= 0 ? reportFinancials.cashAndEquiv.toLocaleString() + '.00' : '-'}
                          </td>
                          <td className="p-2.5 text-right text-rose-800">
                            {reportFinancials.cashAndEquiv < 0 ? (-reportFinancials.cashAndEquiv).toLocaleString() + '.00' : '-'}
                          </td>
                        </tr>

                        {/* 2. Loans Advanced to Members */}
                        <tr>
                          <td className="p-2.5 font-bold">Loans Advanced to Sacco Members</td>
                          <td className="p-2.5 text-right text-emerald-800">
                            {reportFinancials.loansToMembers.toLocaleString()}.00
                          </td>
                          <td className="p-2.5 text-right text-rose-800">-</td>
                        </tr>

                        {/* 3. Trade and Other Receivables */}
                        <tr>
                          <td className="p-2.5 font-bold">Accounts &amp; Regulatory Receivables</td>
                          <td className="p-2.5 text-right text-emerald-800">
                            {reportFinancials.otherReceivables.toLocaleString()}.00
                          </td>
                          <td className="p-2.5 text-right text-rose-800">-</td>
                        </tr>

                        {/* 4. Property, Plant and Equipment Carrying Value */}
                        <tr>
                          <td className="p-2.5 font-bold">Property, Plant &amp; Equipment Assets</td>
                          <td className="p-2.5 text-right text-emerald-800">
                            {reportFinancials.ppeCarrying.toLocaleString()}.00
                          </td>
                          <td className="p-2.5 text-right text-rose-800">-</td>
                        </tr>

                        {/* 5. Members' Deposits / Savings */}
                        <tr>
                          <td className="p-2.5 font-bold">Sacco Members Savings &amp; Deposits</td>
                          <td className="p-2.5 text-right text-emerald-800">-</td>
                          <td className="p-2.5 text-right text-rose-800">
                            {reportFinancials.membersDeposits.toLocaleString()}.00
                          </td>
                        </tr>

                        {/* 6. Trade Payables and Auditing Accruals */}
                        <tr>
                          <td className="p-2.5 font-bold">Trade Payables &amp; Supervision Accruals</td>
                          <td className="p-2.5 text-right text-emerald-800">-</td>
                          <td className="p-2.5 text-right text-rose-800">
                            {reportFinancials.tradePayables.toLocaleString()}.00
                          </td>
                        </tr>

                        {/* 7. Sacco Accumulated Deficit / Retained Earnings */}
                        <tr>
                          <td className="p-2.5 font-bold">Sacco Retained Reserves &amp; Earnings</td>
                          <td className="p-2.5 text-right text-emerald-800">
                            {reportFinancials.retainedEarnings < 0 ? (-reportFinancials.retainedEarnings).toLocaleString() + '.00' : '-'}
                          </td>
                          <td className="p-2.5 text-right text-rose-800">
                            {reportFinancials.retainedEarnings >= 0 ? reportFinancials.retainedEarnings.toLocaleString() + '.00' : '-'}
                          </td>
                        </tr>

                        {/* Double check math balances */}
                        <tr className="bg-slate-950 text-white font-black text-xs">
                          <td className="p-3 text-slate-300 uppercase tracking-wider font-sans">TOTAL LEDGER BALANCES</td>
                          <td className="p-3 text-right text-amber-400">
                            KES {(
                              (reportFinancials.cashAndEquiv >= 0 ? reportFinancials.cashAndEquiv : 0) +
                              reportFinancials.loansToMembers +
                              reportFinancials.otherReceivables +
                              reportFinancials.ppeCarrying +
                              (reportFinancials.retainedEarnings < 0 ? -reportFinancials.retainedEarnings : 0)
                            ).toLocaleString()}.00
                          </td>
                          <td className="p-3 text-right text-amber-400">
                            KES {(
                              (reportFinancials.cashAndEquiv < 0 ? -reportFinancials.cashAndEquiv : 0) +
                              reportFinancials.membersDeposits +
                              reportFinancials.tradePayables +
                              (reportFinancials.retainedEarnings >= 0 ? reportFinancials.retainedEarnings : 0)
                            ).toLocaleString()}.00
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-3 flex items-center space-x-2 bg-blue-50 border border-blue-300 text-blue-950 p-3 rounded text-[11px] leading-relaxed">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>
                      <strong>Live-data note:</strong> Only recorded ledger, member savings and equipment entries are shown. Unsupported accounts remain zero until their registers are implemented.
                    </span>
                  </div>
                </div>
              </div>

              {/* GENERAL LEDGER EXPLORER LOGS */}
              <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-4">
                
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
                  <div>
                    <h3 className="text-sm font-bold font-display text-slate-800">Interactive General Ledger (GL) Audit Log</h3>
                    <p className="text-xs text-slate-500">Filters and search controls tailored to accounting logs search</p>
                  </div>

                  {/* CSV download Button */}
                  <button
                    onClick={() => triggerDownload('CSV')}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold uppercase tracking-wider rounded flex items-center space-x-1.5 transition-all"
                  >
                    <Download className="w-3 h-3" />
                    <span>Export Ledger (CSV)</span>
                  </button>
                </div>

                {/* Filter bar */}
                <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {/* Search */}
                  <div className="relative">
                    <input
                      type="text"
                      value={ledgerSearch}
                      onChange={(e) => setLedgerSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-emerald-600 focus:outline-none"
                    />
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                  </div>

                  {/* Category Filter */}
                  <select
                    value={ledgerCategoryFilter}
                    onChange={(e) => setLedgerCategoryFilter(e.target.value)}
                    className="w-full p-1.5 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-emerald-600 focus:outline-none bg-white"
                  >
                    <option value="All">All Categories</option>
                    <option value="Daily Contribution">Daily Contributions</option>
                    <option value="Savings Contribution">Savings Contributions</option>
                    <option value="Registration Fee">Registration Fees</option>
                    <option value="Management Fee">Management Fees</option>
                    <option value="Office Expenses">Office Expenses</option>
                    <option value="Petty Cash">Petty Cash</option>
                    <option value="Penalty">Penalties / Fines</option>
                    <option value="Utilities">Utilities &amp; Licences</option>
                    <option value="Equipment">Asset &amp; Equipment</option>
                  </select>

                  {/* Debit/Credit Filter */}
                  <select
                    value={ledgerTypeFilter}
                    onChange={(e) => setLedgerTypeFilter(e.target.value)}
                    className="w-full p-1.5 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-emerald-600 focus:outline-none bg-white"
                  >
                    <option value="All">All Entry Types</option>
                    <option value="Credit">Credit (Inflow)</option>
                    <option value="Debit">Debit (Outflow)</option>
                  </select>

                  <select
                    value={ledgerTillFilter}
                    onChange={(e) => setLedgerTillFilter(e.target.value)}
                    className="w-full p-1.5 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-emerald-600 focus:outline-none bg-white"
                  >
                    <option value="All">All Accounts</option>
                    <option value="VehicleTill">Operations Account 48277</option>
                    <option value="UtilityTill">Savings Account 871671</option>
                    <option value="None">No Till</option>
                  </select>

                  <input
                    type="date"
                    value={ledgerDateFrom}
                    onChange={(e) => setLedgerDateFrom(e.target.value)}
                    className="w-full p-1.5 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-emerald-600 focus:outline-none bg-white"
                    title="Filter from date"
                  />

                  <input
                    type="date"
                    value={ledgerDateTo}
                    onChange={(e) => setLedgerDateTo(e.target.value)}
                    className="w-full p-1.5 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-emerald-600 focus:outline-none bg-white"
                    title="Filter to date"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 font-mono">Filtered Entries</p>
                    <p className="text-sm font-black text-slate-900 mt-1">{filteredLedgerTransactions.length}</p>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                    <p className="text-[9px] font-black uppercase tracking-wider text-emerald-700 font-mono">Credits</p>
                    <p className="text-sm font-black text-emerald-800 mt-1">KES {filteredLedgerCredits.toLocaleString()}</p>
                  </div>
                  <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
                    <p className="text-[9px] font-black uppercase tracking-wider text-rose-700 font-mono">Debits</p>
                    <p className="text-sm font-black text-rose-800 mt-1">KES {filteredLedgerDebits.toLocaleString()}</p>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-[9px] font-black uppercase tracking-wider text-blue-700 font-mono">Net</p>
                    <p className={`text-sm font-black mt-1 ${filteredLedgerNet >= 0 ? 'text-blue-800' : 'text-rose-800'}`}>
                      KES {filteredLedgerNet.toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Ledger Log List */}
                <div className="overflow-x-auto max-h-[300px] overflow-y-auto border rounded-lg">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b font-mono text-[10px] text-slate-600 uppercase">
                      <tr>
                        <th className="p-2.5">Date</th>
                        <th className="p-2.5">Ref Code</th>
                        <th className="p-2.5">Narrative</th>
                        <th className="p-2.5">Category</th>
                        <th className="p-2.5 text-right">Debit (KES)</th>
                        <th className="p-2.5 text-right">Credit (KES)</th>
                        <th className="p-2.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y font-mono text-[11px] text-slate-700">
                      {filteredLedgerTransactions
                        .map(t => {
                          const isReversal = Boolean(t.reversalOf);
                          const hasReversal = transactions.some(tx => tx.reversalOf === t.id);
                          const canReverse = Boolean(onReverseTransaction && !isReversal && !hasReversal && canRole(currentUser ?? null, JOURNAL_WRITE_ROLES));
                          const canEdit = Boolean(onUpdateTransaction && !isReversal && !hasReversal && canRole(currentUser ?? null, JOURNAL_WRITE_ROLES));

                          return (
                          <tr key={t.id} className={`hover:bg-slate-50 transition-all ${isReversal ? 'bg-amber-50/40' : ''}`}>
                            <td className="p-2.5 whitespace-nowrap text-slate-500">{t.timestamp.substring(0, 10)}</td>
                            <td className="p-2.5 whitespace-nowrap font-bold text-slate-900">
                              {t.refCode}
                              {isReversal && (
                                <span className="block text-[8px] text-amber-700 uppercase tracking-wider">Reversal</span>
                              )}
                            </td>
                            <td className="p-2.5 max-w-[200px] truncate" title={t.description}>
                              {t.description} {t.memberName && ` - [Member: ${t.memberName}]`} {t.vehiclePlate && ` - [Fleet: ${t.vehiclePlate}]`}
                            </td>
                            <td className="p-2.5 whitespace-nowrap">
                              <span className="text-[10px] bg-slate-100 text-slate-800 px-2 py-0.5 rounded border">
                                {t.category}
                              </span>
                            </td>
                            <td className="p-2.5 text-right font-bold text-rose-600">
                              {t.type === 'Debit' ? t.amount.toLocaleString() + '.00' : '-'}
                            </td>
                            <td className="p-2.5 text-right font-bold text-emerald-700">
                              {t.type === 'Credit' ? t.amount.toLocaleString() + '.00' : '-'}
                            </td>
                            <td className="p-2.5 text-right">
                              <div className="inline-flex items-center gap-1">
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingTransaction(t);
                                    setEditAmount(String(t.amount));
                                    setEditDescription(t.description);
                                    setEditVehiclePlate(t.vehiclePlate || '');
                                    setEditType(t.type);
                                    setEditCategory(t.category);
                                    setEditTill(t.tillNumber);
                                  }}
                                  className="inline-flex items-center justify-center p-1.5 rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                                  title="Edit erroneous ledger entry"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {canReverse ? (
                                <button
                                  type="button"
                                  disabled={reversingTransactionId === t.id}
                                  onClick={async () => {
                                    if (!onReverseTransaction) return;
                                    const confirmed = window.confirm(`Reverse ledger entry ${t.refCode}? This will create an opposite audit entry.`);
                                    if (!confirmed) return;
                                    try {
                                      setReversingTransactionId(t.id);
                                      await onReverseTransaction(t.id);
                                      setJournalSuccess(`Ledger entry ${t.refCode} reversed with an audit-safe counter-entry.`);
                                      setJournalError('');
                                    } catch (error: any) {
                                      setJournalError(error.message || 'Transaction reversal failed.');
                                      setJournalSuccess('');
                                    } finally {
                                      setReversingTransactionId('');
                                    }
                                  }}
                                  className="inline-flex items-center justify-center p-1.5 rounded border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                                  title="Create reversal entry"
                                >
                                  <RotateCcw className={`w-3.5 h-3.5 ${reversingTransactionId === t.id ? 'animate-spin' : ''}`} />
                                </button>
                              ) : hasReversal ? (
                                <span className="text-[9px] text-amber-700 font-bold uppercase">Reversed</span>
                              ) : !canEdit ? (
                                <span className="text-slate-300">-</span>
                              ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                        })
                      }
                    </tbody>
                  </table>
                </div>

              </div>

            </div>

          </div>

        </div>
      )}

      {editingTransaction && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!onUpdateTransaction) return;
              const amount = Number(editAmount);
              if (!Number.isFinite(amount) || amount <= 0) {
                setJournalError('Corrected amount must be greater than zero.');
                return;
              }
              try {
                const otherBreakdown = Number(editingTransaction.entranceFee || 0) + Number(editingTransaction.loanRepay || 0) +
                  Number(editingTransaction.savingsContribution || 0) + Number(editingTransaction.sTicket || 0) +
                  Number(editingTransaction.legalFee || 0) - Number(editingTransaction.expenseDeduction || 0);
                const correctedOperation = editingTransaction.operationAmount === undefined
                  ? undefined
                  : Math.max(0, amount - otherBreakdown);
                await onUpdateTransaction(editingTransaction.id, {
                  amount,
                  description: editDescription.trim(),
                  vehiclePlate: editVehiclePlate.trim().toUpperCase(),
                  type: editType,
                  category: editCategory,
                  tillNumber: editTill,
                  ...(correctedOperation !== undefined ? {
                    operationAmount: correctedOperation,
                    grossAmount: amount + Number(editingTransaction.expenseDeduction || 0)
                  } : {})
                });
                setJournalSuccess(`Ledger entry ${editingTransaction.refCode} corrected successfully.`);
                setJournalError('');
                setEditingTransaction(null);
              } catch (error: any) {
                setJournalError(error.message || 'Ledger correction failed.');
              }
            }}
            className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
          >
            <div className="border-b border-slate-200 pb-3">
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">Correct Ledger Entry</h3>
              <p className="mt-1 text-[10px] text-slate-500">Reference {editingTransaction.refCode} is retained for audit traceability.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[10px] font-bold uppercase text-slate-500">Amount (KES)
                <input type="number" min="0.01" step="0.01" value={editAmount} onChange={e => setEditAmount(sanitizeDecimalInput(e.target.value))} inputMode="decimal" className="mt-1 w-full rounded-lg border p-2 text-xs" required />
              </label>
              <label className="text-[10px] font-bold uppercase text-slate-500">V.REG
                <select
                  value={editVehiclePlate}
                  onChange={e => setEditVehiclePlate(e.target.value)}
                  className="mt-1 w-full rounded-lg border bg-white p-2 font-mono text-xs uppercase"
                >
                  <option value="">No vehicle / V.REG (optional)</option>
                  {vehicles
                    .filter(vehicle => vehicle.status === 'Active' && (!editingTransaction.memberId || vehicle.ownerId === editingTransaction.memberId))
                    .map(vehicle => <option key={vehicle.id} value={vehicle.plateNumber}>{vehicle.plateNumber}</option>)}
                </select>
              </label>
              <label className="text-[10px] font-bold uppercase text-slate-500">Entry Type
                <select value={editType} onChange={e => setEditType(e.target.value as 'Credit' | 'Debit')} className="mt-1 w-full rounded-lg border bg-white p-2 text-xs"><option value="Credit">Credit</option><option value="Debit">Debit</option></select>
              </label>
              <label className="text-[10px] font-bold uppercase text-slate-500">Till
                <select value={editTill} onChange={e => setEditTill(e.target.value as Transaction['tillNumber'])} className="mt-1 w-full rounded-lg border bg-white p-2 text-xs"><option value="VehicleTill">Operations Account 48277</option><option value="UtilityTill">Savings Account 871671</option><option value="None">None</option></select>
              </label>
            </div>
            <label className="block text-[10px] font-bold uppercase text-slate-500">Category
              <select value={editCategory} onChange={e => {
                const nextCategory = e.target.value as Transaction['category'];
                setEditCategory(nextCategory);
                if (!requiresRegisteredMember(nextCategory)) setEditVehiclePlate('');
              }} className="mt-1 w-full rounded-lg border bg-white p-2 text-xs">
                {(['Daily Contribution','Savings Contribution','Registration Fee','Management Fee','Office Expenses','Petty Cash','Penalty','Utilities','Equipment'] as Transaction['category'][])
                  .filter(category => !requiresRegisteredMember(category) || Boolean(editingTransaction.memberId))
                  .map(category => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <label className="block text-[10px] font-bold uppercase text-slate-500">Description
              <textarea value={editDescription} onChange={e => setEditDescription(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border p-2 text-xs" required />
            </label>
            <div className="flex justify-end gap-2 border-t pt-4">
              <button type="button" onClick={() => setEditingTransaction(null)} className="rounded-lg border px-4 py-2 text-xs font-bold uppercase text-slate-600">Cancel</button>
              <button type="submit" className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold uppercase text-white hover:bg-blue-800">Save Correction</button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
