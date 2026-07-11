import React, { useState } from 'react';
import { Transaction, UserRole, TillType } from '../types';
import { sanitizeDecimalInput } from '../lib/inputValidation';
import { 
  Plus, 
  Search, 
  DollarSign, 
  X, 
  AlertCircle, 
  Calendar, 
  ArrowDownLeft, 
  Wallet, 
  Tag, 
  User, 
  Check, 
  FileText, 
  Printer, 
  Receipt,
  Sparkles,
  Layers,
  ChevronRight,
  ChevronDown,
  Building
} from 'lucide-react';

interface ExpensesViewProps {
  transactions: Transaction[];
  onAddTransaction: (newTx: Omit<Transaction, 'id' | 'timestamp' | 'recorderName'>) => void;
  currentUserRole: UserRole;
  currentUserName: string;
}

export default function ExpensesView({ 
  transactions, 
  onAddTransaction, 
  currentUserRole,
  currentUserName 
}: ExpensesViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [tillFilter, setTillFilter] = useState<string>('All');
  const [showAddModal, setShowAddModal] = useState(false);
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [printVoucherId, setPrintVoucherId] = useState<string | null>(null);

  // Form State
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<'Office Expenses' | 'Petty Cash' | 'Utilities' | 'Equipment'>('Office Expenses');
  const [amount, setAmount] = useState('');
  const [refCode, setRefCode] = useState('');
  const [tillNumber, setTillNumber] = useState<'UtilityTill' | 'None' | 'VehicleTill'>('UtilityTill');
  const [recipient, setRecipient] = useState('');
  const [notes, setNotes] = useState('');

  // Sacco role restrictions
  const canRecordExpense = currentUserRole === 'Treasurer' || currentUserRole === 'Chairman';

  // Extract all debit (expense) transactions
  const expenses = transactions.filter(t => t.type === 'Debit');

  // Calculations for Expense Stats Card
  const totalExpensesAmount = expenses.reduce((acc, t) => acc + t.amount, 0);
  
  // Calculate expenses for current month
  const currentMonthStr = new Date().toISOString().slice(0, 7); // e.g. "2026-06"
  const monthlyExpensesAmount = expenses
    .filter(t => t.timestamp.startsWith(currentMonthStr))
    .reduce((acc, t) => acc + t.amount, 0);

  // Source till aggregates
  const utilityTillExpenses = expenses
    .filter(t => t.tillNumber === 'UtilityTill')
    .reduce((acc, t) => acc + t.amount, 0);

  const cashDrawerExpenses = expenses
    .filter(t => t.tillNumber === 'None')
    .reduce((acc, t) => acc + t.amount, 0);

  // Auto-generate voucher ref code on opening modal
  const openModalWithRefCode = () => {
    let generatedRef = '';
    let isUnique = false;
    let attempts = 0;
    
    while (!isUnique && attempts < 50) {
      const randomSuffix = Math.floor(100000 + Math.random() * 900000);
      generatedRef = `VCH-${randomSuffix}`;
      isUnique = !transactions.some(t => t.refCode.toUpperCase() === generatedRef);
      attempts++;
    }

    setRefCode(generatedRef);
    setTitle('');
    setAmount('');
    setRecipient('');
    setNotes('');
    setCategory('Office Expenses');
    setTillNumber('UtilityTill');
    setShowAddModal(true);
    setErrorMessage('');
  };

  const handleCreateExpense = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!canRecordExpense) {
      setErrorMessage(`Access Denied: Your current role [${currentUserRole}] is not authorized to register ledger debits.`);
      return;
    }

    if (!title.trim()) {
      setErrorMessage('Expense title or description is required.');
      return;
    }

    const numericAmount = Number(amount);
    if (!amount || numericAmount <= 0) {
      setErrorMessage('Please enter a valid expense amount greater than KES 0.');
      return;
    }

    if (!refCode.trim()) {
      setErrorMessage('Voucher or reference receipt code is required.');
      return;
    }

    // Verify unique voucher / ref code
    const refExists = transactions.some(t => t.refCode.toUpperCase() === refCode.toUpperCase().trim());
    if (refExists) {
      setErrorMessage(`Voucher ID ${refCode.toUpperCase()} already exists in Sacco audit ledger. Please use a unique voucher key.`);
      return;
    }

    // Assemble description with details
    const fullDescription = `${title.trim()}${recipient ? ` (Paid to: ${recipient.trim()})` : ''}${notes ? ` - ${notes.trim()}` : ''}`;

    onAddTransaction({
      description: fullDescription,
      refCode: refCode.toUpperCase().trim(),
      type: 'Debit',
      category: category,
      amount: numericAmount,
      tillNumber: tillNumber
    });

    setSuccessMessage(`Success: Expense voucher ${refCode.toUpperCase()} for KES ${numericAmount.toLocaleString()} logged and approved!`);
    setShowAddModal(false);
    setTimeout(() => setSuccessMessage(''), 5000);
  };

  // Filtered expenses
  const filteredExpenses = expenses.filter(t => {
    const matchesSearch = 
      t.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.refCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.recorderName.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = categoryFilter === 'All' || t.category === categoryFilter;
    const matchesTill = tillFilter === 'All' || t.tillNumber === tillFilter;

    return matchesSearch && matchesCategory && matchesTill;
  });

  const toggleExpand = (id: string) => {
    if (expandedTxId === id) {
      setExpandedTxId(null);
    } else {
      setExpandedTxId(id);
    }
  };

  // Safe parse function to get custom fields back out of description
  const parseExpenseDetails = (desc: string) => {
    // Expected format: Title (Paid to: Recipient) - Notes
    let parsedTitle = desc;
    let parsedRecipient = '';
    let parsedNotes = '';

    const paidToMatch = desc.match(/\(Paid to: (.*?)\)/);
    if (paidToMatch) {
      parsedRecipient = paidToMatch[1];
      parsedTitle = desc.replace(paidToMatch[0], '').split(' - ')[0].trim();
    }

    const notesSplit = desc.split(' - ');
    if (notesSplit.length > 1) {
      parsedNotes = notesSplit.slice(1).join(' - ').trim();
      if (!parsedRecipient) {
        parsedTitle = notesSplit[0].trim();
      }
    }

    return {
      title: parsedTitle || 'Sacco Operating Expense',
      recipient: parsedRecipient || 'General Vendor / Administrative',
      notes: parsedNotes || 'No additional explanatory notes filed.'
    };
  };

  const handlePrintMock = (tx: Transaction) => {
    setPrintVoucherId(tx.id);
    setTimeout(() => {
      window.print();
      setPrintVoucherId(null);
    }, 400);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6 font-sans bg-slate-50 relative no-print-container" id="expenses-directory-view">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-5 no-print">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-1.5 bg-rose-50 border border-rose-100 rounded-lg text-rose-600">
              <Receipt className="w-5 h-5" />
            </span>
            <h2 className="text-lg font-black text-slate-800 uppercase tracking-tight font-display">
              Administrative Expenses Center
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Log, authorize, and audit Sacco office expenditures, fuel vouchers, licensing costs, and utility pay-outs.
          </p>
        </div>

        <div>
          {currentUserRole === 'Auditor' ? (
            <div className="flex items-center space-x-1 px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-xs font-bold font-mono">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Auditor Read-Only</span>
            </div>
          ) : (
            <button
              onClick={openModalWithRefCode}
              id="record-expense-btn"
              className="flex items-center space-x-1 px-4 py-2 bg-rose-600 text-white rounded hover:bg-rose-700 shadow-sm transition-all font-bold text-xs uppercase tracking-wider"
            >
              <Plus className="w-4 h-4" />
              <span>Record Expense Voucher</span>
            </button>
          )}
        </div>
      </div>

      {/* Success Alerts */}
      {successMessage && (
        <div className="p-4 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-800 text-xs rounded-r shadow-sm flex items-start space-x-2 no-print" id="expense-success-alert">
          <Check className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
          <p className="font-bold">{successMessage}</p>
        </div>
      )}

      {/* Summary KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 no-print">
        {/* Card 1: Total Sacco Debit Outflow */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.015)] hover:shadow-md transition-all flex items-center space-x-4">
          <div className="p-3 bg-rose-50 border border-rose-100 text-rose-600 rounded-xl">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Total Expenditures</p>
            <h3 className="text-xl font-black text-slate-800 mt-1 font-display">
              KES {totalExpensesAmount.toLocaleString()}
            </h3>
            <p className="text-[10px] text-slate-400 mt-0.5">Cumulative Debit Entries</p>
          </div>
        </div>

        {/* Card 2: Current Month Outflow */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.015)] hover:shadow-md transition-all flex items-center space-x-4">
          <div className="p-3 bg-amber-50 border border-amber-100 text-amber-600 rounded-xl">
            <Calendar className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">This Month (June)</p>
            <h3 className="text-xl font-black text-slate-800 mt-1 font-display">
              KES {monthlyExpensesAmount.toLocaleString()}
            </h3>
            <p className="text-[10px] text-amber-600 font-bold flex items-center mt-0.5">
              <Sparkles className="w-3 h-3 mr-1" /> Office Admin Budget
            </p>
          </div>
        </div>

        {/* Card 3: Utility Till Funded */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.015)] hover:shadow-md transition-all flex items-center space-x-4">
          <div className="p-3 bg-blue-50 border border-blue-100 text-blue-600 rounded-xl">
            <Wallet className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Utility Account Pay</p>
            <h3 className="text-xl font-black text-slate-800 mt-1 font-display">
              KES {utilityTillExpenses.toLocaleString()}
            </h3>
            <p className="text-[10px] text-blue-500 font-bold mt-0.5">Till 4810294 Source</p>
          </div>
        </div>

        {/* Card 4: Petty Cash Drawer */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.015)] hover:shadow-md transition-all flex items-center space-x-4">
          <div className="p-3 bg-slate-100 border border-slate-200 text-slate-600 rounded-xl">
            <ArrowDownLeft className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Cash Drawer Vouchers</p>
            <h3 className="text-xl font-black text-slate-800 mt-1 font-display">
              KES {cashDrawerExpenses.toLocaleString()}
            </h3>
            <p className="text-[10px] text-slate-400 mt-0.5">Direct Petty Cash Draws</p>
          </div>
        </div>
      </div>

      {/* Main Panel: Filter & Log Table */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.015)] no-print">
        {/* Header and Filter Controls */}
        <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-4 mb-6 pb-6 border-b border-slate-100">
          <div>
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider font-display">
              Expenditure &amp; Outflow Ledger
            </h3>
            <p className="text-[10px] text-slate-400 mt-0.5">
              Auditable records of Sacco operating capital usage. Filter by category, reference code, or date.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-4 py-1.5 w-full sm:w-56 border border-slate-200 rounded text-xs focus:outline-none focus:border-emerald-600 bg-slate-50"
              />
            </div>

            {/* Category Dropdown */}
            <div>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full sm:w-36 p-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:border-emerald-600 bg-white"
              >
                <option value="All">All Categories</option>
                <option value="Office Expenses">Office Expenses</option>
                <option value="Petty Cash">Petty Cash</option>
                <option value="Utilities">Utilities</option>
                <option value="Equipment">Equipment</option>
              </select>
            </div>

            {/* Source Till Dropdown */}
            <div>
              <select
                value={tillFilter}
                onChange={(e) => setTillFilter(e.target.value)}
                className="w-full sm:w-36 p-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:border-emerald-600 bg-white"
              >
                <option value="All">All Sources</option>
                <option value="UtilityTill">Utility Till</option>
                <option value="None">Petty Cash</option>
                <option value="VehicleTill">Vehicle Till</option>
              </select>
            </div>
          </div>
        </div>

        {/* Expenses List */}
        {filteredExpenses.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-slate-200 rounded-xl">
            <Receipt className="w-10 h-10 text-slate-300 mx-auto stroke-[1.5] mb-2" />
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider font-display">No expenditures matched search filters</p>
            <p className="text-[10px] text-slate-400 mt-1 max-w-sm mx-auto">Try resetting category filters, checking reference codes, or record a new administrative expense voucher.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredExpenses.map((tx) => {
              const isExpanded = expandedTxId === tx.id;
              const details = parseExpenseDetails(tx.description);
              
              return (
                <div 
                  key={tx.id} 
                  className={`border rounded-xl transition-all ${
                    isExpanded 
                      ? 'border-rose-200 bg-rose-50/5' 
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/40 bg-white'
                  }`}
                >
                  {/* Summary Card Bar */}
                  <div 
                    onClick={() => toggleExpand(tx.id)}
                    className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 cursor-pointer select-none"
                  >
                    <div className="flex items-center space-x-3.5">
                      <div className="p-2 bg-rose-50 border border-rose-100 rounded-lg text-rose-600 shrink-0">
                        <ArrowDownLeft className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                          <span className="font-bold text-slate-800 text-xs sm:text-sm">{details.title}</span>
                          <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-100 uppercase tracking-wide">
                            {tx.refCode}
                          </span>
                        </div>
                        <div className="flex items-center space-x-3 mt-1 text-[10px] text-slate-400 flex-wrap gap-y-1">
                          <span className="font-mono text-slate-500 font-medium">
                            {new Date(tx.timestamp).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span>&bull;</span>
                          <span className="flex items-center">
                            <Tag className="w-3 h-3 mr-1 text-slate-300" />
                            {tx.category}
                          </span>
                          <span>&bull;</span>
                          <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[9px] text-slate-600 font-semibold">
                            {tx.tillNumber === 'UtilityTill' ? 'Utility Till 4810294' : tx.tillNumber === 'VehicleTill' ? 'Fleet Till 8249102' : 'Petty Cash'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-4 self-end sm:self-auto shrink-0">
                      <div className="text-right">
                        <p className="text-sm font-black text-rose-600 font-mono">
                          - KES {tx.amount.toLocaleString()}.00
                        </p>
                        <p className="text-[9px] font-bold text-slate-400 font-mono uppercase tracking-widest">
                          Debit Logged
                        </p>
                      </div>
                      <div>
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-slate-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-slate-300" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Detail Panel */}
                  {isExpanded && (
                    <div className="border-t border-rose-100 p-5 bg-rose-50/10 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Details Block */}
                        <div className="space-y-3 col-span-2">
                          <div>
                            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Paid To / Recipient</h4>
                            <p className="text-xs font-black text-slate-700 mt-0.5 flex items-center space-x-1">
                              <Building className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span>{details.recipient}</span>
                            </p>
                          </div>

                          <div>
                            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Expense Description &amp; Details</h4>
                            <p className="text-xs text-slate-600 leading-relaxed bg-white/70 p-3 rounded-lg border border-slate-100 mt-1">
                              {details.notes}
                            </p>
                          </div>
                        </div>

                        {/* Audit Verification Block */}
                        <div className="bg-white rounded-xl p-4 border border-slate-200/80 shadow-sm space-y-3.5">
                          <div>
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono border border-emerald-100 uppercase tracking-widest">
                              Audited &amp; Approved
                            </span>
                          </div>

                          <div className="space-y-1">
                            <div className="flex justify-between text-[10px]">
                              <span className="text-slate-400">Recorded By:</span>
                              <span className="font-bold text-slate-700 flex items-center">
                                <User className="w-3 h-3 mr-0.5 text-slate-400" /> {tx.recorderName}
                              </span>
                            </div>
                            <div className="flex justify-between text-[10px]">
                              <span className="text-slate-400">Funding Source:</span>
                              <span className="font-bold text-slate-700 font-mono">
                                {tx.tillNumber === 'UtilityTill' ? 'Till 4810294' : tx.tillNumber === 'VehicleTill' ? 'Till 8249102' : 'Office Drawer'}
                              </span>
                            </div>
                            <div className="flex justify-between text-[10px]">
                              <span className="text-slate-400">Voucher Key:</span>
                              <span className="font-bold font-mono text-slate-700 uppercase">{tx.refCode}</span>
                            </div>
                          </div>

                          <button
                            onClick={() => handlePrintMock(tx)}
                            className="w-full py-2 bg-slate-900 text-white rounded font-bold text-[10px] uppercase tracking-wider hover:bg-slate-800 transition-all flex items-center justify-center space-x-1"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>Print Voucher Receipt</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Record Expense Modal popup */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 no-print">
          <div className="bg-white border-4 border-slate-200 rounded-3xl max-w-md w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center space-x-1 font-display">
                <Receipt className="w-4 h-4 text-rose-600" />
                <span>Issue Expense Voucher</span>
              </h3>
              <button 
                onClick={() => setShowAddModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateExpense} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 font-mono">
                  Expense Category *
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as any)}
                  className="w-full p-2.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-rose-600 bg-white"
                >
                  <option value="Office Expenses">Office Expenses</option>
                  <option value="Petty Cash">Petty Cash</option>
                  <option value="Utilities">Utilities</option>
                  <option value="Equipment">Equipment</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 font-mono">
                  Funding Capital Source *
                </label>
                <select
                  value={tillNumber}
                  onChange={(e) => setTillNumber(e.target.value as any)}
                  className="w-full p-2.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-rose-600 bg-white font-mono"
                >
                  <option value="UtilityTill">Till 4810294 (Sacco Administrative Utility Account)</option>
                  <option value="None">Direct Office Cash Drawer Draw (Petty Cash)</option>
                  <option value="VehicleTill">Till 8249102 (Paid directly from Fleet Account)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 font-mono">
                  Expense Title / Purpose *
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full p-2.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-rose-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 font-mono">
                    Amount (KES) *
                  </label>
                  <input
                  type="number"
                  required
                  value={amount}
                  onChange={(e) => setAmount(sanitizeDecimalInput(e.target.value))}
                  inputMode="decimal"
                    className="w-full p-2.5 border border-slate-200 rounded-xl text-xs font-mono focus:outline-none focus:border-rose-600"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 font-mono">
                    Recipient / Supplier Name
                  </label>
                  <input
                    type="text"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    className="w-full p-2.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-rose-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 font-mono">
                  Additional Notes / Details
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full p-2.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-rose-600 resize-none"
                />
              </div>

              {errorMessage && (
                <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg text-[11px] text-rose-700 font-bold flex items-start space-x-1.5" id="expense-modal-error">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-500 rounded-xl text-xs font-bold uppercase tracking-wider"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="submit-expense-voucher-btn"
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-sm transition-all"
                >
                  Approve &amp; Post Voucher
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSS printing override stylesheet */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          .no-print, .no-print-container *, #security-denial-modal, aside, header, footer {
            display: none !important;
            visibility: hidden !important;
            height: 0 !important;
            width: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          #print-voucher-billboard, #print-voucher-billboard * {
            visibility: visible !important;
            display: block !important;
          }
          #print-voucher-billboard {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 600px !important;
            background: white !important;
            color: black !important;
            padding: 40px !important;
            border: 1px solid black !important;
          }
        }
      `}</style>

      {/* MOCK VOUCHER FOR PRINTING */}
      {printVoucherId && (
        (() => {
          const pTx = expenses.find(t => t.id === printVoucherId);
          if (!pTx) return null;
          const pDetails = parseExpenseDetails(pTx.description);
          return (
            <div id="print-voucher-billboard" className="hidden border border-dashed border-slate-400 p-8 rounded-2xl max-w-md bg-white font-mono text-slate-800 text-xs shadow-lg space-y-4">
              <div className="text-center border-b-2 border-dashed border-slate-300 pb-4">
                <h2 className="text-base font-black uppercase">Sowetamu Matatu Sacco Ltd</h2>
                <p className="text-[9px] text-slate-500 mt-1 uppercase">CS/NO. 22239 &bull; Nairobi, Kenya</p>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-700 mt-2 bg-slate-100 p-1 rounded">
                  OFFICIAL DEBIT DISBURSEMENT VOUCHER
                </p>
              </div>

              <div className="space-y-2 py-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Voucher Key:</span>
                  <span className="font-bold text-slate-900 uppercase">{pTx.refCode}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Date/Time:</span>
                  <span className="font-bold text-slate-900">{new Date(pTx.timestamp).toLocaleString('en-KE')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Expense Category:</span>
                  <span className="font-bold text-slate-900">{pTx.category}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Disbursement Account:</span>
                  <span className="font-bold text-slate-900">{pTx.tillNumber === 'UtilityTill' ? 'Till 4810294 (Admin)' : pTx.tillNumber === 'VehicleTill' ? 'Till 8249102 (Fleet)' : 'Cash Drawer'}</span>
                </div>
              </div>

              <div className="border-y border-slate-300 py-3 my-2 space-y-2">
                <div>
                  <span className="text-slate-500 text-[10px] block uppercase font-bold">Purpose / Title:</span>
                  <span className="font-black text-slate-900 text-xs">{pDetails.title}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] block uppercase font-bold">Paid To / Recipient:</span>
                  <span className="font-bold text-slate-800 text-xs">{pDetails.recipient}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] block uppercase font-bold">Audit Memo Note:</span>
                  <span className="text-slate-600 text-[11px] leading-relaxed block bg-slate-50 p-2 rounded border border-slate-100">{pDetails.notes}</span>
                </div>
              </div>

              <div className="flex justify-between items-center py-2 border-b-2 border-dashed border-slate-300">
                <span className="font-black text-xs uppercase">Authorized Payout:</span>
                <span className="text-base font-black text-rose-600">
                  KES {pTx.amount.toLocaleString()}.00
                </span>
              </div>

              <div className="pt-4 space-y-3.5">
                <div className="flex justify-between text-[9px] text-slate-500">
                  <span>Recorder: ___________________</span>
                  <span>Approver: ___________________</span>
                </div>
                <div className="text-center text-[10px] text-slate-500">
                  <p className="font-bold">{pTx.recorderName}</p>
                  <p className="text-[8px] mt-1 text-emerald-600 font-bold">LEGAL IMMUTABLE SOWETAMU AUDIT TRAIL RECORD</p>
                  <p className="text-[7px] text-slate-400 mt-0.5">Secure hash: SACCO-VCH-{pTx.id}-{pTx.refCode}</p>
                </div>
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}
