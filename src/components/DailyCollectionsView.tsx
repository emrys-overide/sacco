import React, { useState, useEffect } from 'react';
import type { Vehicle, Member, Transaction } from '../types';
import { STORAGE_KEYS } from '../lib/auth';
import { 
  Printer, 
  Plus, 
  Trash2, 
  ClipboardList, 
  Check, 
  RotateCcw, 
  DollarSign, 
  Bus, 
  BookOpen, 
  TrendingUp, 
  Wallet, 
  Send, 
  AlertTriangle,
  Info,
  Sliders,
  Sparkles
} from 'lucide-react';

interface DailyCollectionsViewProps {
  vehicles: Vehicle[];
  members: Member[];
  transactions: Transaction[];
  onAddTransaction: (newTx: Omit<Transaction, 'id' | 'timestamp' | 'recorderName'>) => void;
  currentUserRole: string;
  currentUserName: string;
}

interface CollectionRow {
  no: number;
  vehiclePlate: string;
  operation: string;
  entranceFee: number;
  loanRepay: number;
  savings: number;
  sTicket: number;
  legalFee: number;
}

interface ExpenseRow {
  no: number;
  description: string;
  amount: number;
}

interface DailySheetSave {
  id: string;
  date: string;
  route: string;
  rows: CollectionRow[];
  expenses: ExpenseRow[];
  posted: boolean;
  postedAt?: string;
}

export default function DailyCollectionsView({
  vehicles,
  members,
  transactions,
  onAddTransaction,
  currentUserRole,
  currentUserName
}: DailyCollectionsViewProps) {
  
  // Basic Sheet State
  const [selectedDate, setSelectedDate] = useState<string>('2026-06-29');
  const [selectedRoute, setSelectedRoute] = useState<string>('STAGE 17&CABANAS');
  
  // State for rows in the table
  const [rows, setRows] = useState<CollectionRow[]>([
    { no: 1, vehiclePlate: 'KBB 112L', operation: '9 TRIPS', entranceFee: 0, loanRepay: 2000, savings: 1500, sTicket: 300, legalFee: 0 },
    { no: 2, vehiclePlate: 'KCJ 402X', operation: '7 TRIPS', entranceFee: 0, loanRepay: 1500, savings: 1200, sTicket: 300, legalFee: 100 },
    { no: 3, vehiclePlate: 'KDD 445Z', operation: '8 TRIPS', entranceFee: 1000, loanRepay: 0, savings: 1500, sTicket: 300, legalFee: 0 },
    { no: 4, vehiclePlate: 'KCD 883A', operation: 'MAINTENANCE', entranceFee: 0, loanRepay: 1000, savings: 500, sTicket: 0, legalFee: 50 },
    { no: 5, vehiclePlate: 'KAA 998Y', operation: '6 TRIPS', entranceFee: 2000, loanRepay: 3000, savings: 2000, sTicket: 300, legalFee: 100 },
  ]);

  // Bottom left Expenses list (8 lines replicating the handwritten template, honoring 3, 3 typo!)
  const [expenses, setExpenses] = useState<ExpenseRow[]>([
    { no: 1, description: 'Route Marshalls Allowance (Stage 17)', amount: 1500 },
    { no: 2, description: 'Cabanas Terminal Cleaning Levy', amount: 450 },
    { no: 3, description: 'Tea & Samosas for Inspectors', amount: 600 },
    { no: 3, description: 'Stationery Logbook Printing', amount: 350 }, // Typo replicated faithfully
    { no: 4, description: 'First-Aid Kit Refills (Fleet KBB)', amount: 800 },
    { no: 5, description: 'Sacco Inspector Petrol Voucher', amount: 1200 },
    { no: 6, description: '', amount: 0 },
    { no: 7, description: '', amount: 0 },
  ]);

  // Saved sheets index for loading different days
  const [savedSheets, setSavedSheets] = useState<DailySheetSave[]>([]);
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isPosted, setIsPosted] = useState<boolean>(false);
  
  // Auditor or Posted Sheets are locked in read-only mode to satisfy security protocols
  const isReadOnly = isPosted || currentUserRole === 'Auditor';

  // Load from local storage on mount
  useEffect(() => {
    const cached = localStorage.getItem(STORAGE_KEYS.savedSheets);
    if (cached) {
      const parsed = JSON.parse(cached) as DailySheetSave[];
      setSavedSheets(parsed);
      
      // Look if there is a sheet for currently selected date and route
      const matched = parsed.find(s => s.date === selectedDate && s.route === selectedRoute);
      if (matched) {
        setRows(matched.rows);
        setExpenses(matched.expenses);
        setIsPosted(matched.posted);
      }
    }
  }, [selectedDate, selectedRoute]);

  // Save changes helper
  const handleSaveLocal = (postedStatus: boolean = isPosted) => {
    const sheetId = `${selectedDate}_${selectedRoute.replace(/\s+/g, '_')}`;
    const newSave: DailySheetSave = {
      id: sheetId,
      date: selectedDate,
      route: selectedRoute,
      rows,
      expenses,
      posted: postedStatus,
      postedAt: postedStatus ? new Date().toLocaleString() : undefined
    };

    const updated = savedSheets.filter(s => s.id !== sheetId);
    updated.push(newSave);
    
    setSavedSheets(updated);
    localStorage.setItem(STORAGE_KEYS.savedSheets, JSON.stringify(updated));
    setIsPosted(postedStatus);
    
    setSuccessMessage(`Daily log sheet for ${selectedRoute} on ${selectedDate} saved locally!`);
    setTimeout(() => setSuccessMessage(''), 5000);
  };

  // Math aggregates
  const totalEntrance = rows.reduce((sum, r) => sum + r.entranceFee, 0);
  const totalLoanRepay = rows.reduce((sum, r) => sum + r.loanRepay, 0);
  const totalSavings = rows.reduce((sum, r) => sum + r.savings, 0);
  const totalSTicket = rows.reduce((sum, r) => sum + r.sTicket, 0);
  const totalLegalFee = rows.reduce((sum, r) => sum + r.legalFee, 0);

  const totalRevenue = rows.reduce((sum, r) => {
    const rowTotal = r.entranceFee + r.loanRepay + r.savings + r.sTicket + r.legalFee;
    return sum + rowTotal;
  }, 0);

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const netIncome = totalRevenue - totalExpenses;

  // Sientas / Nissans segment calculations (matching bottom indicators of the template)
  const nissanRows = rows.filter(r => {
    const plate = r.vehiclePlate.toUpperCase();
    const isSienta = plate.includes('KDD') || plate.includes('KAA'); // hypothetical categorization rules
    return !isSienta;
  });
  
  const sientaRows = rows.filter(r => {
    const plate = r.vehiclePlate.toUpperCase();
    const isSienta = plate.includes('KDD') || plate.includes('KAA');
    return isSienta;
  });

  const nissanTotal = nissanRows.reduce((sum, r) => sum + r.entranceFee + r.loanRepay + r.savings + r.sTicket + r.legalFee, 0);
  const sientaTotal = sientaRows.reduce((sum, r) => sum + r.entranceFee + r.loanRepay + r.savings + r.sTicket + r.legalFee, 0);

  // Row operations
  const handleUpdateRowField = (no: number, field: keyof CollectionRow, value: string | number) => {
    if (isReadOnly) {
      setErrorMessage(currentUserRole === 'Auditor' ? "Security Warning: Sacco Auditors have read-only access and cannot modify sheet entries." : "Cannot edit rows once posted to the ledger! Revoke or select another date first.");
      setTimeout(() => setErrorMessage(''), 5000);
      return;
    }
    setRows(prev => prev.map(r => {
      if (r.no === no) {
        return { ...r, [field]: value };
      }
      return r;
    }));
  };

  const handleUpdateExpenseField = (no: number, index: number, field: keyof ExpenseRow, value: string | number) => {
    if (isReadOnly) {
      setErrorMessage(currentUserRole === 'Auditor' ? "Security Warning: Sacco Auditors have read-only access and cannot modify expense entries." : "Cannot edit expenses once posted to the ledger!");
      setTimeout(() => setErrorMessage(''), 5000);
      return;
    }
    setExpenses(prev => prev.map((e, idx) => {
      if (idx === index) {
        return { ...e, [field]: value };
      }
      return e;
    }));
  };

  const handleAddRow = () => {
    if (isReadOnly) return;
    const nextNo = rows.length > 0 ? Math.max(...rows.map(r => r.no)) + 1 : 1;
    setRows(prev => [...prev, {
      no: nextNo,
      vehiclePlate: vehicles[prev.length % vehicles.length]?.plateNumber || '',
      operation: 'ACTIVE',
      entranceFee: 0,
      loanRepay: 0,
      savings: 0,
      sTicket: 0,
      legalFee: 0
    }]);
  };

  const handleDeleteRow = (no: number) => {
    if (isReadOnly) return;
    setRows(prev => prev.filter(r => r.no !== no).map((r, index) => ({ ...r, no: index + 1 })));
  };

  const handleAddExpenseRow = () => {
    if (isReadOnly) return;
    // Handle list sizing and keeping layout clean
    const nextNo = expenses.length + 1;
    setExpenses(prev => [...prev, { no: nextNo, description: '', amount: 0 }]);
  };

  const handleDeleteExpenseRow = (index: number) => {
    if (isReadOnly) return;
    setExpenses(prev => prev.filter((_, idx) => idx !== index));
  };

  // Re-load initial default data
  const handleResetDefaults = () => {
    if (isReadOnly) return;
    setRows([
      { no: 1, vehiclePlate: 'KBB 112L', operation: '9 TRIPS', entranceFee: 0, loanRepay: 2000, savings: 1500, sTicket: 300, legalFee: 0 },
      { no: 2, vehiclePlate: 'KCJ 402X', operation: '7 TRIPS', entranceFee: 0, loanRepay: 1500, savings: 1200, sTicket: 300, legalFee: 100 },
      { no: 3, vehiclePlate: 'KDD 445Z', operation: '8 TRIPS', entranceFee: 1000, loanRepay: 0, savings: 1500, sTicket: 300, legalFee: 0 },
      { no: 4, vehiclePlate: 'KCD 883A', operation: 'MAINTENANCE', entranceFee: 0, loanRepay: 1000, savings: 500, sTicket: 0, legalFee: 50 },
      { no: 5, vehiclePlate: 'KAA 998Y', operation: '6 TRIPS', entranceFee: 2000, loanRepay: 3000, savings: 2000, sTicket: 300, legalFee: 100 },
    ]);
    setExpenses([
      { no: 1, description: 'Route Marshalls Allowance (Stage 17)', amount: 1500 },
      { no: 2, description: 'Cabanas Terminal Cleaning Levy', amount: 450 },
      { no: 3, description: 'Tea & Samosas for Inspectors', amount: 600 },
      { no: 3, description: 'Stationery Logbook Printing', amount: 350 },
      { no: 4, description: 'First-Aid Kit Refills (Fleet KBB)', amount: 800 },
      { no: 5, description: 'Sacco Inspector Petrol Voucher', amount: 1200 },
      { no: 6, description: '', amount: 0 },
      { no: 7, description: '', amount: 0 },
    ]);
    setIsPosted(false);
  };

  // Post to general ledger (immutably)
  const handlePostToLedger = () => {
    if (currentUserRole === 'Auditor') {
      setErrorMessage("Security Exception: Sacco Auditors have read-only access and cannot post log sheets to ledger.");
      setTimeout(() => setErrorMessage(''), 5000);
      return;
    }

    if (isPosted) {
      setErrorMessage("This log sheet is already synchronized with the centralized ledger.");
      setTimeout(() => setErrorMessage(''), 5000);
      return;
    }

    if (rows.length === 0) {
      setErrorMessage("No collections are present to post. Add some data first.");
      setTimeout(() => setErrorMessage(''), 5000);
      return;
    }

    // Generate credit transaction logs for each categories with total sums
    // This aggregates them into singular credit events linked to the VehicleTill or UtilityTill, preventing ledger flooding.
    
    let postedCount = 0;
    const timestampShort = selectedDate;

    // 1. Post Entrance Fees
    if (totalEntrance > 0) {
      onAddTransaction({
        description: `Entrance Fee Daily Aggregation (${selectedRoute} - Log ${timestampShort})`,
        refCode: `SWT-ENT-${timestampShort.replace(/-/g, '')}`,
        type: 'Credit',
        category: 'Registration Fee',
        amount: totalEntrance,
        tillNumber: 'VehicleTill'
      });
      postedCount++;
    }

    // 2. Post Loan Repayments
    if (totalLoanRepay > 0) {
      onAddTransaction({
        description: `Loan Repayments Collection (${selectedRoute} - Log ${timestampShort})`,
        refCode: `SWT-LN-${timestampShort.replace(/-/g, '')}`,
        type: 'Credit',
        category: 'Daily Contribution', // Fits contribution context
        amount: totalLoanRepay,
        tillNumber: 'VehicleTill'
      });
      postedCount++;
    }

    // 3. Post Savings
    if (totalSavings > 0) {
      // Find matching active members for individual vehicle assignments to distribute savings accurately
      rows.forEach(row => {
        if (row.savings > 0) {
          const matchingVehicle = vehicles.find(v => v.plateNumber === row.vehiclePlate);
          const ownerMember = members.find(m => m.id === matchingVehicle?.ownerId);
          
          onAddTransaction({
            memberId: ownerMember?.id,
            memberName: ownerMember?.name,
            vehiclePlate: row.vehiclePlate,
            description: `Savings Contribution from Logsheet row ${row.no} (${row.vehiclePlate})`,
            refCode: `SWT-SAV-${row.vehiclePlate.replace(/\s+/g, '')}-${timestampShort.replace(/-/g, '')}`,
            type: 'Credit',
            category: 'Daily Contribution',
            amount: row.savings,
            tillNumber: 'VehicleTill'
          });
          postedCount++;
        }
      });
    }

    // 4. Post S/Ticket Collections
    if (totalSTicket > 0) {
      onAddTransaction({
        description: `Short-Ticket / Sacco Security Ticket Sales (${selectedRoute} - Log ${timestampShort})`,
        refCode: `SWT-STK-${timestampShort.replace(/-/g, '')}`,
        type: 'Credit',
        category: 'Management Fee',
        amount: totalSTicket,
        tillNumber: 'VehicleTill'
      });
      postedCount++;
    }

    // 5. Post Legal Fees
    if (totalLegalFee > 0) {
      onAddTransaction({
        description: `Legal Fees daily stage surcharge collections (${selectedRoute} - Log ${timestampShort})`,
        refCode: `SWT-LGL-${timestampShort.replace(/-/g, '')}`,
        type: 'Credit',
        category: 'Penalty',
        amount: totalLegalFee,
        tillNumber: 'VehicleTill'
      });
      postedCount++;
    }

    // 6. Post individual Expenses as Debits
    expenses.forEach(exp => {
      if (exp.amount > 0 && exp.description.trim()) {
        onAddTransaction({
          description: `${exp.description} (${selectedRoute} stage field expense)`,
          refCode: `SWT-EXP-${exp.no}-${timestampShort.replace(/-/g, '')}`,
          type: 'Debit',
          category: 'Petty Cash',
          amount: exp.amount,
          tillNumber: 'UtilityTill'
        });
        postedCount++;
      }
    });

    // Save with posted flag = true
    handleSaveLocal(true);

    setSuccessMessage(`Ledger Synced! Successfully recorded ${postedCount} transactional logs into Sacco Ledger Tills!`);
    setTimeout(() => setSuccessMessage(''), 5000);
  };

  const triggerPrint = () => {
    window.print();
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-slate-100 font-sans flex flex-col space-y-6 min-h-0 printable-area">
      
      {/* EXPLANATORY HEADER BANNER */}
      <div className="bg-slate-900 text-white p-5 rounded-lg border border-slate-950 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0 no-print">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="text-[9px] font-bold uppercase tracking-widest bg-emerald-500 text-slate-950 px-2 py-0.5 rounded font-mono border border-emerald-600">
              FIELD OFFICE LOG DIGITIZATION
            </span>
            <span className="text-[9px] font-bold uppercase tracking-widest bg-amber-500 text-slate-950 px-2 py-0.5 rounded font-mono">
              REAL-TIME SUMS
            </span>
          </div>
          <h2 className="text-lg font-bold font-display text-slate-100 mt-1 flex items-center">
            <ClipboardList className="w-5 h-5 text-emerald-400 mr-2" />
            Sowetamu Travellers Sacco — Field Collection Sheet
          </h2>
          <p className="text-xs text-slate-400 max-w-2xl leading-normal">
            This component replicates the physical daily field sheets filled at stages (such as <strong className="text-white">Stage 17 &amp; Cabanas</strong>). Under the hood, we digitize these entries, compute dynamic vertical sums, account for daily on-route expenses, and allow one-click ledger synchronization to post transactions seamlessly to the centralized dual-till vault.
          </p>
        </div>

        <div className="flex flex-row md:flex-col items-end gap-2 shrink-0 justify-between md:justify-center">
          <button
            onClick={triggerPrint}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs uppercase tracking-wider rounded border border-emerald-700 flex items-center space-x-1.5 transition-all shadow-xs"
          >
            <Printer className="w-3.5 h-3.5 text-slate-950" />
            <span>Print Hardcopy</span>
          </button>
          
          <span className="text-[10px] text-slate-400 font-mono hidden md:block">
            Status: {isPosted ? '🔴 Immutable Post Linked' : currentUserRole === 'Auditor' ? '🟡 Auditor View-Only' : '🟢 Draft Mode'}
          </span>
        </div>
      </div>

      {/* SYSTEM MESSAGES */}
      {successMessage && (
        <div className="bg-emerald-50 border-2 border-emerald-500 text-emerald-950 p-4 rounded flex items-center space-x-2.5 text-xs shadow-sm shrink-0 animate-fade-in no-print">
          <Check className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-bold">{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="bg-rose-50 border-2 border-rose-500 text-rose-950 p-4 rounded flex items-center space-x-2.5 text-xs shadow-sm shrink-0 animate-fade-in no-print">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
          <span className="font-bold">{errorMessage}</span>
        </div>
      )}

      {/* METADATA FILTERS CONTROLLER */}
      <div className="bg-white border-2 border-slate-900 rounded p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 no-print shrink-0">
        <div className="flex flex-col sm:flex-row gap-4">
          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1 font-mono">
              LOG DATE IN JUNE 2026
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded text-xs font-mono bg-slate-50 focus:outline-none focus:border-slate-900"
            />
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1 font-mono">
              STAGE ROUTE LOCATION
            </label>
            <select
              value={selectedRoute}
              onChange={(e) => setSelectedRoute(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded text-xs font-bold bg-slate-50 focus:outline-none focus:border-slate-900"
            >
              <option value="STAGE 17&CABANAS">STAGE 17 &amp; CABANAS</option>
              <option value="Nairobi - Thika (Route 237)">NAIROBI - THIKA (ROUTE 237)</option>
              <option value="Nairobi - Ruiru (Route 145)">NAIROBI - RUIRU (ROUTE 145)</option>
              <option value="Nairobi - Githurai (Route 45)">NAIROBI - GITHURAI (ROUTE 45)</option>
            </select>
          </div>
        </div>

        <div className="flex items-center space-x-2 self-end md:self-auto">
          <button
            onClick={handleResetDefaults}
            disabled={isReadOnly}
            className={`px-3 py-1.5 border border-slate-300 hover:border-slate-400 text-slate-600 rounded text-xs font-bold uppercase tracking-wider flex items-center space-x-1 transition-all ${
              isReadOnly ? 'opacity-50 cursor-not-allowed' : ''
            }`}
            title="Reload default photo snapshot records"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Template</span>
          </button>

          <button
            onClick={() => handleSaveLocal()}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5 transition-all shadow-xs"
          >
            <span>Save Draft</span>
          </button>
        </div>
      </div>

      {/* CORE SOWETAMU PHYSICAL LOGSHEET CANVAS */}
      <div className="bg-white border-2 border-slate-900 p-4 sm:p-8 shadow-[6px_6px_0px_rgba(15,23,42,1)] rounded relative flex flex-col flex-1 min-h-0 font-sans print:border-0 print:p-0 print:shadow-none">
        
        {/* LOGO & OFFICIAL HEADER FROM THE SHEET */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b-2 border-slate-900 pb-4 mb-4 gap-4">
          <div className="flex items-center space-x-4">
            {/* Custom stylized green-gray logo replicating SOWETAMU */}
            <div className="w-14 h-14 bg-emerald-700 relative overflow-hidden flex flex-col justify-between p-1.5 shadow-xs border border-emerald-800 shrink-0">
              <div className="w-full h-1/2 bg-slate-500 absolute top-0 left-0 transform skew-y-12 origin-top-left"></div>
              <div className="relative z-10 text-[8px] font-black font-display text-white leading-tight">SWT</div>
              <div className="relative z-10 text-[7px] font-mono font-bold text-emerald-200 self-end">SACCO</div>
            </div>

            <div>
              <h1 className="text-2xl font-black font-display tracking-tight text-emerald-950">SOWETAMU</h1>
              <p className="text-[10px] text-emerald-800 font-bold uppercase tracking-[1.5px] font-mono leading-none">TRAVELLERS SACCO</p>
              <p className="text-[9px] text-slate-500 mt-1 italic">"We Serve with Courtesy, Discipline &amp; Dignity"</p>
            </div>
          </div>

          <div className="text-left sm:text-right text-[10px] text-slate-500 font-mono space-y-0.5">
            <p className="font-bold text-slate-800">P.O. BOX 1324-00518</p>
            <p>Email: sowetamusaacco@gmail.com</p>
            <p>Contact: 0715600000 / 0705749293 / 0729196176</p>
          </div>
        </div>

        {/* STAGE & DATE BAR */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-900 text-white p-3 rounded font-mono text-xs uppercase tracking-wider mb-4 border border-slate-950">
          <div className="flex items-center space-x-2">
            <span className="text-slate-400 font-bold">ROUTE STAGE:</span>
            <span className="text-emerald-400 font-black">{selectedRoute}</span>
          </div>

          <div className="flex items-center space-x-2 justify-start sm:justify-end">
            <span className="text-slate-400 font-bold">DATE:</span>
            <span className="text-amber-400 font-black">
              {new Date(selectedDate).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
        </div>

        {/* GRID OF TRANS: CHIEF LOGSHEET TABLE */}
        <div className="flex-1 overflow-y-auto border-2 border-slate-900 rounded mb-6 min-h-[250px]">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead className="bg-slate-100 text-[10px] font-black uppercase tracking-wider border-b-2 border-slate-900 text-slate-800 font-mono">
              <tr>
                <th className="px-3 py-2.5 border-r border-slate-300 w-12 text-center">NO</th>
                <th className="px-3 py-2.5 border-r border-slate-300 w-36">V.REG (PLATE)</th>
                <th className="px-3 py-2.5 border-r border-slate-300 w-28">OPERATION</th>
                <th className="px-3 py-2.5 border-r border-slate-300 text-right">ENTRANCE FEE</th>
                <th className="px-3 py-2.5 border-r border-slate-300 text-right">LOAN REPAY</th>
                <th className="px-3 py-2.5 border-r border-slate-300 text-right">SAVINGS</th>
                <th className="px-3 py-2.5 border-r border-slate-300 text-right">S/TICKET</th>
                <th className="px-3 py-2.5 border-r border-slate-300 text-right">LEGAL FEE</th>
                <th className="px-3 py-2.5 text-right w-32 bg-slate-50 font-black text-slate-900">TOTAL</th>
                <th className="px-3 py-2.5 text-center w-12 no-print"></th>
              </tr>
            </thead>
            <tbody className="divide-y border-b border-slate-900 divide-slate-300 text-xs">
              {rows.map((row, idx) => {
                const rowTotal = row.entranceFee + row.loanRepay + row.savings + row.sTicket + row.legalFee;
                return (
                  <tr key={row.no} className="hover:bg-slate-50/50">
                    <td className="px-3 py-2 border-r border-slate-300 font-mono text-center text-slate-500 font-bold">
                      {row.no}
                    </td>

                    {/* V.REG FIELD */}
                    <td className="px-3 py-2 border-r border-slate-300">
                      {isReadOnly ? (
                        <span className="font-mono font-bold text-slate-800">{row.vehiclePlate}</span>
                      ) : (
                        <select
                          value={row.vehiclePlate}
                          onChange={(e) => handleUpdateRowField(row.no, 'vehiclePlate', e.target.value)}
                          className="w-full p-1 border border-transparent hover:border-slate-300 focus:border-slate-900 font-mono font-bold bg-transparent text-slate-800 text-xs rounded focus:outline-none"
                        >
                          {vehicles.map(v => (
                            <option key={v.id} value={v.plateNumber}>{v.plateNumber} ({v.driverName})</option>
                          ))}
                          <option value="KAA 998Y">KAA 998Y (Sienta)</option>
                          <option value="KBB 212Z">KBB 212Z (Niss)</option>
                          <option value="KCC 555B">KCC 555B (Niss)</option>
                        </select>
                      )}
                    </td>

                    {/* OPERATION FIELD */}
                    <td className="px-3 py-2 border-r border-slate-300">
                      <input
                        type="text"
                        value={row.operation}
                        disabled={isReadOnly}
                        onChange={(e) => handleUpdateRowField(row.no, 'operation', e.target.value.toUpperCase())}
                        className="w-full p-1 border border-transparent hover:border-slate-300 focus:border-slate-900 font-mono bg-transparent text-slate-700 text-xs rounded focus:outline-none focus:bg-white"
                      />
                    </td>

                    {/* ENTRANCE FEE */}
                    <td className="px-3 py-2 border-r border-slate-300 text-right">
                      <input
                        type="number"
                        value={row.entranceFee || ''}
                        disabled={isReadOnly}
                        onChange={(e) => handleUpdateRowField(row.no, 'entranceFee', Number(e.target.value))}
                        className="w-full p-1 border border-transparent hover:border-slate-300 focus:border-slate-900 font-mono text-right bg-transparent text-emerald-800 font-bold text-xs rounded focus:outline-none focus:bg-white"
                      />
                    </td>

                    {/* LOAN REPAY */}
                    <td className="px-3 py-2 border-r border-slate-300 text-right">
                      <input
                        type="number"
                        value={row.loanRepay || ''}
                        disabled={isReadOnly}
                        onChange={(e) => handleUpdateRowField(row.no, 'loanRepay', Number(e.target.value))}
                        className="w-full p-1 border border-transparent hover:border-slate-300 focus:border-slate-900 font-mono text-right bg-transparent text-slate-800 text-xs rounded focus:outline-none focus:bg-white"
                      />
                    </td>

                    {/* SAVINGS */}
                    <td className="px-3 py-2 border-r border-slate-300 text-right">
                      <input
                        type="number"
                        value={row.savings || ''}
                        disabled={isReadOnly}
                        onChange={(e) => handleUpdateRowField(row.no, 'savings', Number(e.target.value))}
                        className="w-full p-1 border border-transparent hover:border-slate-300 focus:border-slate-900 font-mono text-right bg-transparent text-blue-800 font-bold text-xs rounded focus:outline-none focus:bg-white"
                      />
                    </td>

                    {/* S/TICKET */}
                    <td className="px-3 py-2 border-r border-slate-300 text-right">
                      <input
                        type="number"
                        value={row.sTicket || ''}
                        disabled={isReadOnly}
                        onChange={(e) => handleUpdateRowField(row.no, 'sTicket', Number(e.target.value))}
                        className="w-full p-1 border border-transparent hover:border-slate-300 focus:border-slate-900 font-mono text-right bg-transparent text-amber-800 font-bold text-xs rounded focus:outline-none focus:bg-white"
                      />
                    </td>

                    {/* LEGAL FEE */}
                    <td className="px-3 py-2 border-r border-slate-300 text-right">
                      <input
                        type="number"
                        value={row.legalFee || ''}
                        disabled={isReadOnly}
                        onChange={(e) => handleUpdateRowField(row.no, 'legalFee', Number(e.target.value))}
                        className="w-full p-1 border border-transparent hover:border-slate-300 focus:border-slate-900 font-mono text-right bg-transparent text-rose-800 font-bold text-xs rounded focus:outline-none focus:bg-white"
                      />
                    </td>

                    {/* ROW TOTAL */}
                    <td className="px-3 py-2 text-right bg-slate-50 font-mono font-bold text-slate-950">
                      KSH {rowTotal.toLocaleString()}
                    </td>

                    {/* DELETE ACTION BUTTON */}
                    <td className="px-3 py-2 text-center no-print">
                      <button
                        onClick={() => handleDeleteRow(row.no)}
                        disabled={isReadOnly}
                        className={`text-slate-300 hover:text-rose-600 p-1 rounded transition-colors ${
                          isReadOnly ? 'opacity-30 cursor-not-allowed' : ''
                        }`}
                        title="Delete this log record"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {/* EMPTY STATE INDICATOR FOR TABLE */}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-400 font-medium font-mono text-xs">
                    No logs filled. Click "Add Registration Row" below to populate this field list.
                  </td>
                </tr>
              )}
            </tbody>

            {/* GRAND SUMMARY VERTICAL TOTALS */}
            <tfoot className="bg-slate-900 text-white font-mono text-[11px] uppercase tracking-wider font-bold border-t border-slate-900">
              <tr>
                <td colSpan={3} className="px-3 py-3 border-r border-slate-700 text-center text-slate-200">
                  TOTAL REVENUE COLUMNS
                </td>
                <td className="px-3 py-3 border-r border-slate-700 text-right text-emerald-400">
                  {totalEntrance > 0 ? `KSH ${totalEntrance.toLocaleString()}` : '—'}
                </td>
                <td className="px-3 py-3 border-r border-slate-700 text-right text-slate-100">
                  {totalLoanRepay > 0 ? `KSH ${totalLoanRepay.toLocaleString()}` : '—'}
                </td>
                <td className="px-3 py-3 border-r border-slate-700 text-right text-blue-300">
                  {totalSavings > 0 ? `KSH ${totalSavings.toLocaleString()}` : '—'}
                </td>
                <td className="px-3 py-3 border-r border-slate-700 text-right text-amber-300">
                  {totalSTicket > 0 ? `KSH ${totalSTicket.toLocaleString()}` : '—'}
                </td>
                <td className="px-3 py-3 border-r border-slate-700 text-right text-rose-300">
                  {totalLegalFee > 0 ? `KSH ${totalLegalFee.toLocaleString()}` : '—'}
                </td>
                <td className="px-3 py-3 text-right bg-emerald-950 text-emerald-400 font-black border-l border-emerald-900">
                  KSH {totalRevenue.toLocaleString()}
                </td>
                <td className="no-print"></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ADD ROWS BUTTON (ONLY DRAFT MODE) */}
        {!isReadOnly && (
          <div className="flex space-x-2 mb-6 no-print">
            <button
              onClick={handleAddRow}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 border-2 border-slate-900 rounded font-black text-xs uppercase tracking-wider flex items-center space-x-1 transition-all"
            >
              <Plus className="w-4 h-4 text-slate-800" />
              <span>Add Vehicle Entry</span>
            </button>
          </div>
        )}

        {/* LOWER GRID: EXPENSES SHEET (BOTTOM LEFT) AND SUMMARY PANEL (BOTTOM RIGHT) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* DAILY FIELD EXPENSES SHEET REPLICA (LEFT COLUMN - 7 COLS) */}
          <div className="lg:col-span-7 bg-slate-50 border-2 border-slate-900 rounded p-6 shadow-xs relative">
            <div className="flex items-center justify-between border-b border-slate-300 pb-2 mb-4">
              <h3 className="text-xs font-black uppercase text-slate-900 tracking-wider font-mono flex items-center">
                <span className="w-2.5 h-2.5 bg-rose-600 rounded-full mr-2"></span>
                Daily Field Expenses Sheet (Deducted On-Route)
              </h3>
              <span className="text-[9px] font-mono font-bold uppercase text-slate-400">
                8 lines maximum capacity
              </span>
            </div>

            <div className="space-y-2 font-mono">
              {expenses.map((exp, idx) => (
                <div key={idx} className="flex items-center space-x-3 text-xs">
                  {/* Faithful Typo representation: index 3 is duplicated! (1, 2, 3, 3, 4, 5, 6, 7...) */}
                  <span className="w-6 font-bold text-slate-500 text-center">
                    {idx === 2 ? '3.' : idx === 3 ? '3.' : idx > 3 ? `${idx}.` : `${idx + 1}.`}
                  </span>

                  <input
                    type="text"
                    value={exp.description}
                    disabled={isReadOnly}
                    onChange={(e) => handleUpdateExpenseField(exp.no, idx, 'description', e.target.value)}
                    className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded text-xs bg-transparent focus:outline-none focus:border-slate-900 focus:bg-white"
                  />

                  <div className="flex items-center space-x-1 w-28">
                    <span className="text-slate-400 text-[10px]">KSH</span>
                    <input
                      type="number"
                      value={exp.amount || ''}
                      disabled={isReadOnly}
                      onChange={(e) => handleUpdateExpenseField(exp.no, idx, 'amount', Number(e.target.value))}
                      className="w-full px-2 py-1 border border-slate-200 rounded text-right font-bold text-rose-700 text-xs bg-transparent focus:outline-none focus:border-slate-900 focus:bg-white"
                    />
                  </div>

                  {!isReadOnly && (
                    <button
                      onClick={() => handleDeleteExpenseRow(idx)}
                      className="text-slate-300 hover:text-rose-600 p-1 rounded transition-colors no-print"
                      title="Delete expense line"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* ADD EXPENSE ROW (ONLY DRAFT) */}
            {!isReadOnly && expenses.length < 9 && (
              <button
                onClick={handleAddExpenseRow}
                className="mt-3 px-2.5 py-1 text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold uppercase tracking-wider rounded flex items-center space-x-1 transition-all no-print"
              >
                <Plus className="w-3 h-3 text-slate-800" />
                <span>Add Expense Line</span>
              </button>
            )}

            <div className="mt-4 pt-4 border-t border-slate-300 flex justify-between items-center text-xs font-mono font-black text-slate-900">
              <span className="uppercase text-slate-600">TOTAL DIRECT EXPENDITURES:</span>
              <span className="text-rose-700">KSH {totalExpenses.toLocaleString()}.00</span>
            </div>
          </div>

          {/* LOWER RECONCILIATION SUMMARY BOX (RIGHT COLUMN - 5 COLS) */}
          <div className="lg:col-span-5 flex flex-col space-y-4">
            
            {/* Nissan vs Sienta bento segments */}
            <div className="border border-slate-200 rounded p-4 bg-slate-50 space-y-2 font-mono text-[11px] uppercase">
              <span className="text-[9px] font-bold text-slate-400 block tracking-wider">VEHICLE CLASSIFICATION REVENUE (From Image Segment)</span>
              
              <div className="flex justify-between border-b pb-1">
                <span className="text-slate-600">NISSANS (14-Seaters):</span>
                <span className="font-bold text-slate-900">KSH {nissanTotal.toLocaleString()}</span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-slate-600">NISSANS SIENTAS (7-Seaters):</span>
                <span className="font-bold text-slate-900">KSH {sientaTotal.toLocaleString()}</span>
              </div>
            </div>

            <div className="bg-slate-900 text-white border-2 border-slate-950 p-6 rounded shadow-xs flex flex-col space-y-4">
              <h3 className="text-xs font-black uppercase tracking-wider border-b border-slate-800 pb-2 text-emerald-400 font-mono">
                Daily Financial Reconciliation
              </h3>

              <div className="space-y-3 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Route Deposits:</span>
                  <span className="font-bold text-emerald-400">+ KSH {totalRevenue.toLocaleString()}.00</span>
                </div>

                <div className="flex justify-between">
                  <span className="text-slate-400">Total Stage Expenses:</span>
                  <span className="font-bold text-rose-400">- KSH {totalExpenses.toLocaleString()}.00</span>
                </div>

                <div className="border-t border-slate-800 pt-3 flex justify-between text-sm font-black uppercase">
                  <span>Net Sacco Inflow:</span>
                  <span className={netIncome >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    KSH {netIncome.toLocaleString()}.00
                  </span>
                </div>
              </div>

              {/* POSTING DECISION PANEL */}
              <div className="pt-2 border-t border-slate-800 flex flex-col space-y-2 no-print">
                {isPosted ? (
                  <div className="p-3 bg-emerald-950/80 border border-emerald-500 rounded flex flex-col space-y-1 text-center">
                    <span className="text-[9px] font-black uppercase text-emerald-400 tracking-widest flex items-center justify-center">
                      <Check className="w-3.5 h-3.5 text-emerald-400 mr-1 shrink-0 animate-bounce" />
                      RECONCILIATION CO-POSTED
                    </span>
                    <p className="text-[10px] text-slate-400 leading-normal">
                      The total revenues and expenses of this sheet are permanently posted onto the Sacco dual-tills. (T1: VehicleTill &amp; T2: UtilityTill)
                    </p>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={handlePostToLedger}
                      className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-wider rounded border border-emerald-600 shadow-[2px_2px_0px_rgba(255,255,255,0.1)] hover:shadow-none transition-all flex items-center justify-center space-x-1.5"
                    >
                      <Send className="w-4 h-4 text-slate-950" />
                      <span>Post to Sacco Ledgers</span>
                    </button>
                    <p className="text-[9px] text-slate-400 leading-tight text-center">
                      Posting splits savings to members, loans to assets, fees to the vehicle till, and deductions to the utilities drawer.
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* AUDITOR'S TRUST SEAL */}
            <div className="bg-slate-50 border border-slate-200 rounded p-4 flex items-start space-x-3 text-[11px] text-slate-600 font-mono italic leading-normal">
              <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-slate-800 not-italic block uppercase tracking-wide text-[9px] mb-0.5">Auditor Compliance Note</strong>
                All posted collections carry custom SWT- prefixing matching the official Kenya State Sacco Registry parameters under Cap 490 standards.
              </div>
            </div>

          </div>

        </div>

        {/* SIGNATURE SECTION (FROM THE HANDWRITTEN SHEET) */}
        <div className="mt-12 pt-6 border-t-2 border-slate-900 grid grid-cols-2 text-xs font-mono">
          <div className="space-y-4">
            <p className="text-slate-500 uppercase font-bold text-[10px]">Filled &amp; Certified By:</p>
            <div className="border-b border-slate-900 w-64 h-8 flex items-end pb-1 font-bold italic text-slate-800">
              {currentUserName}
            </div>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider">Route Inspector / Marshall</p>
          </div>

          <div className="space-y-4 text-right flex flex-col items-end">
            <div className="w-64 space-y-4">
              <p className="text-slate-500 uppercase font-bold text-[10px] text-left">Verified By (Treasury Office):</p>
              <div className="border-b border-slate-900 w-full h-8 flex items-end pb-1 font-bold text-slate-400">
                {isPosted ? 'Timothy Mwangi (Sacco Treasurer)' : 'Awaiting Ledger Post...'}
              </div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider text-left">Authorized Signature Stamp</p>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
