import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Member, UserRole, Transaction } from '../types';
import { 
  Search, 
  UserPlus, 
  Phone, 
  CreditCard, 
  ShieldCheck, 
  UserCheck, 
  CheckCircle, 
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  Wallet,
  DollarSign,
  Layers,
  Calendar,
  TrendingUp,
  User,
  FileText,
  CheckCircle2,
  Download,
  Activity,
  ChevronRight,
  Sparkles,
  ClipboardCheck,
  Building
} from 'lucide-react';
import {
  isValidPersonName,
  isValidPhoneNumber,
  sanitizeDecimalInput,
  sanitizeIntegerInput,
  sanitizePersonName,
  sanitizePhoneNumber,
  sanitizeVehiclePlate
} from '../lib/inputValidation';

interface MembersViewProps {
  members: Member[];
  onAddMember: (newMember: Omit<Member, 'id' | 'dateRegistered' | 'sharesAmount' | 'savingsAmount'>) => Promise<void>;
  currentUserRole: UserRole;
  transactions: Transaction[];
}

export default function MembersView({ members, onAddMember, currentUserRole, transactions }: MembersViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Pending'>('All');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberTxSearch, setMemberTxSearch] = useState('');
  const [downloadSuccessMessage, setDownloadSuccessMessage] = useState('');
  const [copiedSuccess, setCopiedSuccess] = useState(false);

  // New Member Form State
  const [name, setName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [assignedVehicle, setAssignedVehicle] = useState('');
  const [openingLoanBalance, setOpeningLoanBalance] = useState('');
  const [error, setError] = useState('');

  // Role validation
  const canRegister = currentUserRole === 'Chairman' || currentUserRole === 'Secretary' || currentUserRole === 'Treasurer';

  const filteredMembers = members.filter(member => {
    const matchesSearch = member.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          member.idNumber.includes(searchTerm) ||
                          member.phoneNumber.includes(searchTerm);
    const matchesFilter = statusFilter === 'All' || member.status === statusFilter;
    return matchesSearch && matchesFilter;
  });

  // Automatically select the active member (defaults to first matching item if none selected or if selection invalid)
  const activeSelectedMember = filteredMembers.find(m => m.id === selectedMemberId) || filteredMembers[0] || null;

  // Personal Transaction Ledger History
  const memberTransactions = activeSelectedMember 
    ? transactions.filter(t => t.memberId === activeSelectedMember.id || (activeSelectedMember.vehicleAssigned && t.vehiclePlate === activeSelectedMember.vehicleAssigned))
    : [];

  // Filter within member's transactions
  const filteredMemberTx = memberTransactions.filter(t => 
    t.refCode.toLowerCase().includes(memberTxSearch.toLowerCase()) ||
    t.category.toLowerCase().includes(memberTxSearch.toLowerCase()) ||
    t.description.toLowerCase().includes(memberTxSearch.toLowerCase())
  );

  // Financial calculations for the selected member
  const totalDeposited = memberTransactions.filter(t => t.type === 'Credit').reduce((acc, t) => acc + t.amount, 0);
  const totalLevies = memberTransactions.filter(t => t.type === 'Debit').reduce((acc, t) => acc + t.amount, 0);
  const totalFleetTill = memberTransactions.filter(t => t.tillNumber === 'VehicleTill' && t.type === 'Credit').reduce((acc, t) => acc + t.amount, 0);
  const totalUtilityTill = memberTransactions.filter(t => t.tillNumber === 'UtilityTill' && t.type === 'Credit').reduce((acc, t) => acc + t.amount, 0);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !idNumber.trim() || !phoneNumber.trim()) {
      setError('Please fill in all required fields.');
      return;
    }
    if (!isValidPersonName(name)) {
      setError('Full name must use letters only.');
      return;
    }
    if (!isValidPhoneNumber(phoneNumber)) {
      setError('Enter a valid phone number using digits only.');
      return;
    }
    try {
      await onAddMember({
        name,
        idNumber,
        phoneNumber,
        status: 'Active',
        vehicleAssigned: assignedVehicle.trim() || undefined,
        initialLoanAmount: Number(openingLoanBalance) || 0,
        loanBalance: Number(openingLoanBalance) || 0
      });
    } catch (error: any) {
      setError(error?.message || 'Member registration failed. Check the server connection and retry.');
      return;
    }
    // Reset Form
    setName('');
    setIdNumber('');
    setPhoneNumber('');
    setAssignedVehicle('');
    setOpeningLoanBalance('');
    setError('');
    setShowAddModal(false);
  };

  const copyMemberDossierToClipboard = (member: Member) => {
  const details = `MEMBER PROFILE - SOWETAMU SACCO\n-----------------------\nName: ${member.name}\nNational ID: ${member.idNumber}\nPhone No: ${member.phoneNumber}\nAssigned Plate: ${member.vehicleAssigned || 'None'}\nSavings: KES ${member.savingsAmount.toLocaleString()}\nShares: KES ${member.sharesAmount.toLocaleString()}\nOutstanding Loan: KES ${(member.loanBalance || 0).toLocaleString()}\nRegistered: ${member.dateRegistered || 'N/A'}\nStatus: ${member.status}`;
    navigator.clipboard.writeText(details).then(() => {
      setCopiedSuccess(true);
      setTimeout(() => setCopiedSuccess(false), 2000);
    });
  };

  const triggerMemberReportDownload = (member: Member, txs: Transaction[]) => {
    let content = `======================================================\n`;
    content += `         SOWETAMU TRAVELLERS SACCO MEMBER ACCOUNT REPORT\n`;
    content += `         MEMBER: ${member.name.toUpperCase()}\n`;
    content += `         Generated on: ${new Date().toLocaleString()}\n`;
    content += `======================================================\n\n`;

    content += `PERSONAL BIO-DATA:\n`;
    content += `------------------------------------------------------\n`;
    content += `Full Name              : ${member.name}\n`;
    content += `National ID Number     : ${member.idNumber}\n`;
    content += `Phone Number (M-Pesa)  : ${member.phoneNumber}\n`;
    content += `Sacco Registration Date: ${member.dateRegistered || 'N/A'}\n`;
    content += `Membership Status      : ${member.status}\n`;
    content += `Assigned Vehicle Plate : ${member.vehicleAssigned || 'No vehicle currently assigned'}\n\n`;

    content += `FINANCIAL BALANCES:\n`;
    content += `------------------------------------------------------\n`;
    content += `Current Sacco Savings  : KES ${member.savingsAmount.toLocaleString()}.00\n`;
    content += `Current Shares Capital : KES ${member.sharesAmount.toLocaleString()}.00\n`;
    content += `Outstanding Loan       : KES ${(member.loanBalance || 0).toLocaleString()}.00\n`;
    content += `Total Logged Deposits  : KES ${totalDeposited.toLocaleString()}.00\n`;
    content += `Total Penalties/Debits : KES ${totalLevies.toLocaleString()}.00\n\n`;

    content += `TILL SEGREGATION ACTIVITY LOG:\n`;
    content += `------------------------------------------------------\n`;
    content += `Operations / Daily Account 48277 Deposits : KES ${totalFleetTill.toLocaleString()}.00\n`;
    content += `Member Savings Account 871671 Deposits : KES ${totalUtilityTill.toLocaleString()}.00\n\n`;

    content += `DETAILED PERSONAL AUDIT TRAIL:\n`;
    content += `------------------------------------------------------\n`;
    content += `Date       Till Type       Ref Code      Type    Category             Amount\n`;
    txs.forEach(t => {
      const dateStr = t.timestamp.substring(0, 10);
      const tillStr = (t.tillNumber === 'VehicleTill' ? 'Acct 48277' : t.tillNumber === 'UtilityTill' ? 'Acct 871671' : 'Cash Drawer').padEnd(15);
      const refCode = t.refCode.padEnd(13);
      const typeStr = t.type.padEnd(7);
      const catStr = t.category.padEnd(20);
      const amountStr = `KES ${t.amount.toLocaleString()}`;
      content += `${dateStr} ${tillStr} ${refCode} ${typeStr} ${catStr} ${amountStr}\n`;
    });
    content += `\n======================================================\n`;
    content += `       End of Personal Audit Ledger for ${member.name}\n`;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Sowetamu_Sacco_Member_${member.name.replace(/\s+/g, '_')}_Statement.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setDownloadSuccessMessage(`Success! Personal statement for ${member.name} exported.`);
    setTimeout(() => setDownloadSuccessMessage(''), 4000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="flex-1 p-4 sm:p-8 overflow-y-auto md:overflow-hidden bg-slate-50 font-sans flex flex-col space-y-6 h-full"
    >
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-slate-200 shrink-0 gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-[9px] font-bold uppercase tracking-widest bg-slate-900 text-white px-2 py-0.5 rounded font-mono border border-slate-950">
              Audit-Ready Sacco Registry
            </span>
          </div>
          <h2 className="text-xl font-bold font-display text-slate-800 mt-1">Sacco Members Directory &amp; dossiers</h2>
          <p className="text-xs text-slate-500">Live search query profiles, dual-till balance ledgers, and transaction history cards</p>
        </div>
        
        {canRegister ? (
          <button
            onClick={() => setShowAddModal(true)}
            id="open-register-member-modal"
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded uppercase tracking-wider flex items-center space-x-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] border border-slate-900 transition-all self-start md:self-auto"
          >
            <UserPlus className="w-4 h-4" />
            <span>Register New Sacco Member</span>
          </button>
        ) : (
          <div className="text-[11px] bg-amber-50 border border-amber-200 text-amber-800 px-3 py-1.5 rounded">
            Role <strong>{currentUserRole}</strong> does not have member registration rights.
          </div>
        )}
      </div>

      {downloadSuccessMessage && (
        <div className="bg-emerald-50 border-2 border-emerald-500 text-emerald-950 p-4 rounded flex items-center space-x-2.5 text-xs shadow-sm shrink-0">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-bold">{downloadSuccessMessage}</span>
        </div>
      )}

      {/* Main Interactive Split Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 flex-1 min-h-0 overflow-y-auto md:overflow-hidden">
        
        {/* LEFT COLUMN: Search & Live Directory Stream */}
        <div className="xl:col-span-5 flex flex-col space-y-4 min-h-[400px] md:min-h-0 md:overflow-hidden">
          
          {/* Filters Deck */}
          <div className="bg-white p-4 rounded border border-slate-200 flex flex-col md:flex-row gap-3 items-center justify-between shrink-0 shadow-xs">
            <div className="relative w-full">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded text-xs bg-slate-50 focus:outline-none focus:border-slate-900 focus:bg-white transition-colors"
              />
            </div>

            <div className="flex space-x-1 shrink-0 w-full md:w-auto">
              {(['All', 'Active', 'Pending'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setStatusFilter(filter)}
                  className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded transition-colors border ${
                    statusFilter === filter
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          {/* Members Feed */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden flex-1 flex flex-col min-h-0 shadow-xs">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
              <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">
                Matching Members ({filteredMembers.length})
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                Click any row to view ledger dossier
              </span>
            </div>

            <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
              {filteredMembers.length > 0 ? (
                filteredMembers.map((member) => {
                  const isActive = activeSelectedMember?.id === member.id;
                  return (
                    <button
                      key={member.id}
                      onClick={() => {
                        setSelectedMemberId(member.id);
                        setMemberTxSearch('');
                      }}
                      className={`w-full text-left p-4 transition-all flex items-center justify-between border-l-4 ${
                        isActive 
                          ? 'bg-slate-50 border-slate-900 shadow-inner' 
                          : 'border-transparent hover:bg-slate-50/50'
                      }`}
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        {/* Avatar */}
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                          isActive ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {member.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                        </div>

                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 text-xs truncate">{member.name}</p>
                          <div className="flex items-center space-x-1.5 mt-0.5 text-[10px] text-slate-500">
                            <span className="font-mono">{member.idNumber}</span>
                            <span>&bull;</span>
                            <span>{member.vehicleAssigned ? `Plate: ${member.vehicleAssigned}` : 'No Matatu'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <p className="text-[11px] font-black text-emerald-800 font-mono">
                          KES {member.savingsAmount.toLocaleString()}
                        </p>
                        <p className="text-[9px] text-slate-400 font-mono uppercase mt-0.5">
                          Shares: KES {member.sharesAmount.toLocaleString()}
                        </p>
                        <p className="text-[9px] text-amber-700 font-mono uppercase mt-0.5">
                          Loan: KES {(member.loanBalance || 0).toLocaleString()}
                        </p>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="p-8 text-center text-slate-400 text-xs flex flex-col items-center justify-center space-y-2">
                  <User className="w-8 h-8 text-slate-300" />
                  <p>No Sacco members matched the search conditions.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Interactive High-Fidelity Member Detail Dossier */}
        <div className="xl:col-span-7 flex flex-col min-h-[500px] md:min-h-0 md:overflow-hidden">
          {activeSelectedMember ? (
            <div className="bg-white border-2 border-slate-900 rounded overflow-hidden flex-1 flex flex-col min-h-0 shadow-[4px_4px_0px_rgba(15,23,42,1)]">
              
              {/* Profile Card Header Banner (Geometric styled) */}
              <div className="p-6 bg-slate-950 text-white relative shrink-0 overflow-hidden border-b-2 border-slate-900">
                <div className="absolute right-0 top-0 opacity-10 pointer-events-none transform translate-x-12 -translate-y-6">
                  <User className="w-48 h-48" />
                </div>

                <div className="flex flex-col md:flex-row justify-between items-start md:items-center relative z-10 gap-4">
                  <div className="flex items-center space-x-4">
                    {/* Large Avatar */}
                    <div className="w-14 h-14 rounded bg-white text-slate-950 flex items-center justify-center font-black text-lg border-2 border-white shadow-md">
                      {activeSelectedMember.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                    </div>

                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="text-lg font-black tracking-tight font-display text-white">
                          {activeSelectedMember.name}
                        </h3>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-black tracking-widest uppercase font-mono ${
                          activeSelectedMember.status === 'Active'
                            ? 'bg-emerald-500 text-slate-950'
                            : 'bg-amber-500 text-slate-950'
                        }`}>
                          {activeSelectedMember.status}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-300 mt-1.5 font-mono">
                        <span className="flex items-center">
                          <Phone className="w-3.5 h-3.5 mr-1 text-slate-400" />
                          {activeSelectedMember.phoneNumber}
                        </span>
                        <span>&bull;</span>
                        <span>ID: {activeSelectedMember.idNumber}</span>
                        <span>&bull;</span>
                        <span className="flex items-center">
                          <Calendar className="w-3.5 h-3.5 mr-1 text-slate-400" />
                          Reg: {activeSelectedMember.dateRegistered || '2026-01-10'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Deck */}
                  <div className="flex space-x-2 w-full md:w-auto self-stretch md:self-auto justify-end">
                    <button
                      onClick={() => copyMemberDossierToClipboard(activeSelectedMember)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold uppercase tracking-wider rounded border border-slate-700 flex items-center space-x-1 transition-colors"
                    >
                      {copiedSuccess ? (
                        <>
                          <ClipboardCheck className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Copied Dossier</span>
                        </>
                      ) : (
                        <>
                          <FileText className="w-3.5 h-3.5" />
                          <span>Copy Info</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => triggerMemberReportDownload(activeSelectedMember, memberTransactions)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-wider rounded flex items-center space-x-1 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download statement</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Dossier Content Area */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                
                {/* Financial Bento Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {/* Card 1: Savings Account */}
                  <div className="border border-slate-200 rounded p-4 bg-slate-50/50">
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="text-[9px] font-bold uppercase tracking-wider font-mono">Sacco Savings Pool</span>
                      <Wallet className="w-4 h-4 text-emerald-600" />
                    </div>
                    <p className="text-xl font-black text-emerald-950 font-mono mt-2">
                      KES {activeSelectedMember.savingsAmount.toLocaleString()}
                    </p>
                    <div className="w-full bg-slate-200 h-1 rounded-full mt-3 overflow-hidden">
                      <div className="bg-emerald-600 h-full rounded-full" style={{ width: '65%' }}></div>
                    </div>
                    <p className="text-[9px] text-slate-400 mt-1.5 font-medium">Reconciled daily M-Pesa ledger</p>
                  </div>

                  {/* Card 2: Shares Capital */}
                  <div className="border border-slate-200 rounded p-4 bg-slate-50/50">
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="text-[9px] font-bold uppercase tracking-wider font-mono">Shares Capital (40%)</span>
                      <Layers className="w-4 h-4 text-blue-600" />
                    </div>
                    <p className="text-xl font-black text-blue-950 font-mono mt-2">
                      KES {activeSelectedMember.sharesAmount.toLocaleString()}
                    </p>
                    <div className="w-full bg-slate-200 h-1 rounded-full mt-3 overflow-hidden">
                      <div className="bg-blue-600 h-full rounded-full" style={{ width: '40%' }}></div>
                    </div>
                    <p className="text-[9px] text-slate-400 mt-1.5 font-medium">Secured Sacco asset-buffer capital</p>
                  </div>

                  {/* Card 3: Assigned Matatu Info */}
                  <div className="border border-slate-200 rounded p-4 bg-amber-50/50">
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="text-[9px] font-bold uppercase tracking-wider font-mono">Outstanding Loan</span>
                      <DollarSign className="w-4 h-4 text-amber-600" />
                    </div>
                    <p className="text-xl font-black text-amber-900 font-mono mt-2">
                      KES {(activeSelectedMember.loanBalance || 0).toLocaleString()}
                    </p>
                    <p className="text-[9px] text-slate-400 mt-1.5 font-medium">Daily Loan Repay amounts reduce this balance</p>
                  </div>

                  {/* Card 4: Assigned Matatu Info */}
                  <div className="border border-slate-200 rounded p-4 bg-slate-50/50">
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="text-[9px] font-bold uppercase tracking-wider font-mono">Assigned Matatu Plate</span>
                      <Building className="w-4 h-4 text-amber-600" />
                    </div>
                    {activeSelectedMember.vehicleAssigned ? (
                      <div>
                        <p className="text-xl font-black text-slate-900 font-mono mt-2 uppercase tracking-tight">
                          {activeSelectedMember.vehicleAssigned}
                        </p>
                        <span className="inline-flex items-center px-1.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded text-[9px] font-bold uppercase tracking-wider mt-2.5">
                          Fleet Active Spec
                        </span>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm font-bold text-slate-400 mt-2.5">No Matatu Assigned</p>
                        <p className="text-[9px] text-slate-400 mt-1.5 font-medium">No active plate registered</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Till Assignment Segregation Metrics */}
                <div className="bg-slate-50 border border-slate-200 rounded p-4">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-3 font-mono">
                    Member Dual-Till Segment Allocation
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    
                    {/* Till 1 */}
                    <div className="bg-white border border-slate-200 p-3.5 rounded flex items-center justify-between">
                      <div>
                        <span className="text-[9px] font-bold text-slate-400 block font-mono">OPERATIONS / DAILY ACCOUNT (48277)</span>
                        <span className="text-xs text-slate-600 mt-1 block">Contributions &amp; fees</span>
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-bold text-emerald-800 block text-sm">
                          KES {totalFleetTill.toLocaleString()}
                        </span>
                        <span className="text-[9px] text-emerald-600 font-semibold uppercase tracking-wider font-mono">Deposited</span>
                      </div>
                    </div>

                    {/* Till 2 */}
                    <div className="bg-white border border-slate-200 p-3.5 rounded flex items-center justify-between">
                      <div>
                        <span className="text-[9px] font-bold text-slate-400 block font-mono">MEMBER SAVINGS ACCOUNT (871671)</span>
                        <span className="text-xs text-slate-600 mt-1 block">Charges, offices &amp; debits</span>
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-bold text-rose-700 block text-sm">
                          KES {totalUtilityTill.toLocaleString()}
                        </span>
                        <span className="text-[9px] text-rose-600 font-semibold uppercase tracking-wider font-mono">Deducted</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Interactive Transaction History for this member */}
                <div className="space-y-3">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-slate-100 pb-2">
                    <div className="flex items-center space-x-2">
                      <Activity className="w-4 h-4 text-slate-900" />
                      <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 font-display">
                        Personal Sacco Audit Ledger
                      </h4>
                    </div>

                    {/* Search inside Member's transactions */}
                    <div className="relative w-full md:w-48">
                      <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-slate-400">
                        <Search className="w-3 h-3" />
                      </span>
                      <input
                        type="text"
                        value={memberTxSearch}
                        onChange={(e) => setMemberTxSearch(e.target.value)}
                        className="w-full pl-7 pr-3 py-1 border border-slate-200 rounded text-[11px] bg-slate-50 focus:outline-none focus:border-slate-900 focus:bg-white"
                      />
                    </div>
                  </div>

                  {filteredMemberTx.length === 0 ? (
                    <div className="text-center py-10 border border-dashed border-slate-200 rounded text-xs text-slate-400 flex flex-col items-center justify-center space-y-2">
                      <FileText className="w-6 h-6 text-slate-300" />
                      <p>No transaction history matched filter for {activeSelectedMember.name}.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-slate-200 rounded">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 text-[9px] text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                          <tr>
                            <th className="px-4 py-2">Date / Code</th>
                            <th className="px-4 py-2">Till Account</th>
                            <th className="px-4 py-2">Category</th>
                            <th className="px-4 py-2">Memo Description</th>
                            <th className="px-4 py-2 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-[11px]">
                          {filteredMemberTx.map(t => (
                            <tr key={t.id} className="hover:bg-slate-50/60">
                              <td className="px-4 py-3 font-mono text-slate-600">
                                <div>{t.timestamp.substring(0, 10)}</div>
                                <div className="text-[9px] text-slate-400 uppercase font-black tracking-wider mt-0.5">
                                  {t.refCode}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                                  t.tillNumber === 'VehicleTill' 
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                                    : t.tillNumber === 'UtilityTill' 
                                    ? 'bg-blue-50 text-blue-800 border-blue-200' 
                                    : 'bg-slate-100 text-slate-700 border-slate-200'
                                }`}>
                                  {t.tillNumber === 'VehicleTill' ? 'Account: 48277' : t.tillNumber === 'UtilityTill' ? 'Account: 871671' : 'Cash Drawer'}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-slate-700 font-medium">
                                {t.category}
                              </td>
                              <td className="px-4 py-3 text-slate-500 max-w-xs truncate" title={t.description}>
                                {t.description}
                                <div className="text-[9px] text-slate-400 font-normal mt-0.5">
                                  Rec: {t.recorderName}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right font-mono font-bold">
                                <span className={t.type === 'Credit' ? 'text-emerald-700' : 'text-rose-600'}>
                                  {t.type === 'Credit' ? '+' : '-'} KES {t.amount.toLocaleString()}.00
                                </span>
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
          ) : (
            <div className="bg-white border border-slate-200 rounded p-12 text-center text-slate-400 text-xs flex flex-col items-center justify-center space-y-3 shadow-xs h-full">
              <UserCheck className="w-12 h-12 text-slate-300" />
              <h3 className="font-bold text-slate-700 text-sm">No Active Sacco Member Profile Selected</h3>
              <p className="max-w-xs">Select any member from the left stream registry directory or type a name to inspect full dossier files.</p>
            </div>
          )}
        </div>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border-4 border-slate-200 rounded max-w-md w-full p-6 shadow-xl">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 border-b border-slate-100 pb-2 mb-4 font-display">
              Register New Sacco Member
            </h3>
            
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                  Full Name (ID card match) *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(sanitizePersonName(e.target.value))}
                  inputMode="text"
                  pattern="[A-Za-z .'-]+"
                  title="Letters only."
                  className="w-full p-2 border border-slate-200 rounded text-xs focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                    National ID Number *
                  </label>
                  <input
                  type="text"
                  required
                  value={idNumber}
                  onChange={(e) => setIdNumber(sanitizeIntegerInput(e.target.value, 12))}
                  inputMode="numeric"
                  pattern="[0-9]+"
                  title="Numbers only."
                    className="w-full p-2 border border-slate-200 rounded text-xs font-mono focus:outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                    Phone Number (M-Pesa linked) *
                  </label>
                  <input
                  type="tel"
                  required
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(sanitizePhoneNumber(e.target.value))}
                  inputMode="tel"
                  pattern="[+]?[0-9]{9,15}"
                  title="Use a phone number only."
                    className="w-full p-2 border border-slate-200 rounded text-xs focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                  Assigned Matatu Plate (Optional)
                </label>
                <input
                  type="text"
                  value={assignedVehicle}
                  onChange={(e) => setAssignedVehicle(sanitizeVehiclePlate(e.target.value))}
                  className="w-full p-2 border border-slate-200 rounded text-xs font-mono uppercase focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                  Opening Loan Balance (KES)
                </label>
                <input
                  type="number"
                  min="0"
                  value={openingLoanBalance}
                  onChange={(e) => setOpeningLoanBalance(sanitizeDecimalInput(e.target.value))}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full p-2 border border-slate-200 rounded text-xs font-mono focus:outline-none focus:border-emerald-600"
                />
                <p className="mt-1 text-[9px] text-slate-400">Loan Repay amounts in Daily Collections will reduce this balance.</p>
              </div>

              {error && <p className="text-xs text-rose-600 font-bold">{error}</p>}

              <div className="flex justify-end space-x-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setError('');
                  }}
                  className="px-3 py-1.5 border border-slate-200 rounded text-xs font-bold text-slate-500 uppercase tracking-wider"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="register-member-submit"
                  className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-bold uppercase tracking-wider shadow-sm"
                >
                  Confirm Registration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </motion.div>
  );
}
