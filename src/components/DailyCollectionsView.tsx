import React, { useState, useEffect, useCallback } from "react";
import type { Vehicle, Member, Transaction, VehicleClass } from "../types";
import { sanitizeDecimalInput } from "../lib/inputValidation";
import { 
  Printer, 
  Plus, 
  Trash2, 
  ClipboardList, 
  Check, 
  RotateCcw, 
  AlertTriangle, 
  Send 
} from "lucide-react";

interface DailyCollectionsViewProps {
  vehicles: Vehicle[];
  members: Member[];
  transactions: Transaction[];
  onAddTransaction: (newTx: Omit<Transaction, "id" | "timestamp" | "recorderName">) => Promise<Transaction>;
  onUpdateTransaction: (transactionId: string, changes: Partial<Transaction>) => Promise<Transaction>;
  onDeleteTransaction?: (transactionId: string) => Promise<void>;
  currentUserRole: string;
  currentUserName: string;
}

interface CollectionRow {
  transactionId?: string;
  no: number;
  vehiclePlate: string;
  vehicleClass: VehicleClass;
  operation: number;
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
  transactionId?: string;
}

export default function DailyCollectionsView({
  vehicles,
  members,
  transactions,
  onAddTransaction,
  onUpdateTransaction,
  onDeleteTransaction,
  currentUserRole,
  currentUserName
}: DailyCollectionsViewProps) {
  
  // Basic Sheet State
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [selectedRoute, setSelectedRoute] = useState<string>("Stage 17 to Machakos");
  
  // State for rows in the table
  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  
  const [successMessage, setSuccessMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isAutoSaving, setIsAutoSaving] = useState<boolean>(false);
  
  const isReadOnly = currentUserRole === "Auditor";
  const activeVehicles = vehicles.filter(vehicle => vehicle.status === "Active");

  const getRowTotal = (r: CollectionRow) =>
    Number(r.operation || 0) + Number(r.entranceFee || 0) + Number(r.loanRepay || 0) +
    Number(r.savings || 0) + Number(r.sTicket || 0) + Number(r.legalFee || 0);

  // Sync state from backend transactions for the selected date
  useEffect(() => {
    const dailyTxs = transactions.filter(tx =>
      tx.category === "Daily Contribution" &&
      tx.timestamp.slice(0, 10) === selectedDate &&
      tx.type === "Credit" &&
      !tx.reversalOf
    );

    const expenseTxs = transactions.filter(tx =>
      (tx.category === "Petty Cash" || tx.category === "Office Expenses") &&
      tx.timestamp.slice(0, 10) === selectedDate &&
      tx.type === "Debit" &&
      tx.tillNumber === "VehicleTill" &&
      !tx.reversalOf
    );

    setRows(prevRows => {
      const syncedRows: CollectionRow[] = dailyTxs.map((tx, index) => ({
        transactionId: tx.id,
        no: index + 1,
        vehiclePlate: tx.vehiclePlate || "",
        vehicleClass: tx.vehicleClass || "Nissan",
        operation: Number(tx.operationAmount || 0),
        entranceFee: Number(tx.entranceFee || 0),
        loanRepay: Number(tx.loanRepay || 0),
        savings: Number(tx.savingsContribution || 0),
        sTicket: Number(tx.sTicket || 0),
        legalFee: Number(tx.legalFee || 0)
      }));

      // Preserve unposted new draft rows that the user is currently typing
      const unpostedDrafts = prevRows.filter(r => !r.transactionId && (r.vehiclePlate || getRowTotal(r) > 0));
      const nextRows = [...syncedRows];
      unpostedDrafts.forEach((draft, idx) => {
        nextRows.push({ ...draft, no: syncedRows.length + idx + 1 });
      });

      return nextRows;
    });

    setExpenses(prevExpenses => {
      const syncedExpenses: ExpenseRow[] = expenseTxs.map((tx, index) => ({
        transactionId: tx.id,
        no: index + 1,
        description: tx.description.replace(/\s*\([^)]*\)\s*$/, "").trim() || tx.description,
        amount: Number(tx.amount || 0)
      }));

      // Preserve unposted draft expenses
      const unpostedDraftExpenses = prevExpenses.filter(e => !e.transactionId && (e.description || e.amount > 0));
      const nextExpenses = [...syncedExpenses];
      unpostedDraftExpenses.forEach((draft, idx) => {
        nextExpenses.push({ ...draft, no: syncedExpenses.length + idx + 1 });
      });

      return nextExpenses;
    });
  }, [selectedDate, transactions]);

  // Auto-save a modified existing transaction to the backend ledger
  const autoSaveRow = useCallback(async (rowToSave: CollectionRow) => {
    if (!rowToSave.transactionId || isReadOnly) return;
    try {
      setIsAutoSaving(true);
      const grossAmount = getRowTotal(rowToSave);
      const original = transactions.find(tx => tx.id === rowToSave.transactionId);
      const deduction = Number(original?.expenseDeduction || 0);

      await onUpdateTransaction(rowToSave.transactionId, {
        vehiclePlate: rowToSave.vehiclePlate.trim().toUpperCase(),
        vehicleClass: rowToSave.vehicleClass,
        operationAmount: rowToSave.operation,
        entranceFee: rowToSave.entranceFee,
        loanRepay: rowToSave.loanRepay,
        savingsContribution: rowToSave.savings,
        sTicket: rowToSave.sTicket,
        legalFee: rowToSave.legalFee,
        grossAmount,
        amount: Math.max(0, grossAmount - deduction),
        description: `${rowToSave.vehicleClass} daily collection (${selectedRoute || "field sheet"} - row ${rowToSave.no})`
      });

      setSuccessMessage(`Auto-saved updates for ${rowToSave.vehiclePlate || `Row ${rowToSave.no}`}`);
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err: any) {
      console.error("Auto-save error:", err);
      setErrorMessage(err.message || "Failed to auto-save changes.");
      setTimeout(() => setErrorMessage(""), 5000);
    } finally {
      setIsAutoSaving(false);
    }
  }, [isReadOnly, onUpdateTransaction, selectedRoute, transactions]);

  // Row update handlers
  const handleUpdateRowField = (no: number, field: keyof CollectionRow, value: string | number) => {
    if (isReadOnly) return;
    setRows(prev => prev.map(r => r.no === no ? { ...r, [field]: value } : r));
  };

  const handleRowBlur = (no: number) => {
    const targetRow = rows.find(r => r.no === no);
    if (targetRow && targetRow.transactionId) {
      void autoSaveRow(targetRow);
    }
  };

  const handleVehicleClassChange = (no: number, vehicleClass: VehicleClass) => {
    if (isReadOnly) return;
    setRows(prev => {
      const updated = prev.map(r => r.no === no ? { ...r, vehicleClass } : r);
      const targetRow = updated.find(r => r.no === no);
      if (targetRow && targetRow.transactionId) {
        void autoSaveRow(targetRow);
      }
      return updated;
    });
  };

  const handleVehiclePlateChange = (no: number, plate: string) => {
    if (isReadOnly) return;
    const cleanPlate = plate.toUpperCase().trim();
    const matchedVehicle = vehicles.find(v => v.plateNumber.replace(/\s+/g, "").toUpperCase() === cleanPlate.replace(/\s+/g, ""));

    setRows(prev => {
      const updated = prev.map(r => {
        if (r.no === no) {
          return {
            ...r,
            vehiclePlate: cleanPlate,
            vehicleClass: matchedVehicle?.capacity === 7 ? "Sienta" : (r.vehicleClass || "Nissan")
          };
        }
        return r;
      });
      return updated;
    });
  };

  const handleAddRow = () => {
    if (isReadOnly) return;
    const nextNo = rows.length > 0 ? Math.max(...rows.map(r => r.no)) + 1 : 1;
    const availablePlate = activeVehicles[rows.length % Math.max(activeVehicles.length, 1)]?.plateNumber || "";
    setRows(prev => [...prev, {
      no: nextNo,
      vehiclePlate: availablePlate,
      vehicleClass: "Nissan",
      operation: 0,
      entranceFee: 0,
      loanRepay: 0,
      savings: 0,
      sTicket: 0,
      legalFee: 0
    }]);
  };

  const handleDeleteRow = async (no: number) => {
    if (isReadOnly) return;
    const targetRow = rows.find(r => r.no === no);
    const confirmed = window.confirm(
      `Delete daily collection row ${no} (${targetRow?.vehiclePlate || "Entry"})? This will permanently delete the transaction from the database.`
    );
    if (!confirmed) return;

    if (targetRow?.transactionId && onDeleteTransaction) {
      try {
        await onDeleteTransaction(targetRow.transactionId);
        setSuccessMessage(`Transaction for ${targetRow.vehiclePlate || `Row ${no}`} deleted from database.`);
        setTimeout(() => setSuccessMessage(""), 4000);
      } catch (err: any) {
        setErrorMessage(err.message || "Failed to delete transaction from database.");
        return;
      }
    }

    setRows(prev => prev.filter(r => r.no !== no).map((r, index) => ({ ...r, no: index + 1 })));
  };

  const handleAddExpenseRow = () => {
    if (isReadOnly) return;
    const nextNo = expenses.length + 1;
    setExpenses(prev => [...prev, { no: nextNo, description: "", amount: 0 }]);
  };

  const handleUpdateExpenseField = (no: number, index: number, field: keyof ExpenseRow, value: string | number) => {
    if (isReadOnly) return;
    setExpenses(prev => prev.map((e, idx) => idx === index ? { ...e, [field]: value } : e));
  };

  const handleExpenseBlur = async (index: number) => {
    const targetExp = expenses[index];
    if (targetExp && targetExp.transactionId && !isReadOnly) {
      try {
        await onUpdateTransaction(targetExp.transactionId, {
          description: `${targetExp.description} (${selectedRoute || "field sheet"} expense)`,
          amount: Number(targetExp.amount || 0)
        });
        setSuccessMessage(`Expense line ${index + 1} updated.`);
        setTimeout(() => setSuccessMessage(""), 3000);
      } catch (err: any) {
        setErrorMessage(err.message || "Failed to update expense line.");
      }
    }
  };

  const handleDeleteExpenseRow = async (index: number) => {
    if (isReadOnly) return;
    const targetExp = expenses[index];
    const confirmed = window.confirm(
      `Delete expense line ${index + 1}? This will permanently delete the transaction from the database.`
    );
    if (!confirmed) return;

    if (targetExp?.transactionId && onDeleteTransaction) {
      try {
        await onDeleteTransaction(targetExp.transactionId);
        setSuccessMessage(`Expense line ${index + 1} deleted from database.`);
        setTimeout(() => setSuccessMessage(""), 4000);
      } catch (err: any) {
        setErrorMessage(err.message || "Failed to delete expense transaction.");
        return;
      }
    }

    setExpenses(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleResetDefaults = async () => {
    if (isReadOnly) return;
    const confirmed = window.confirm(
      "Clear this daily sheet? All collection and expense entries on this sheet (including posted database records) will be completely removed. Do you want to proceed?"
    );
    if (!confirmed) return;

    if (onDeleteTransaction) {
      const allTxIds = [
        ...rows.map(r => r.transactionId),
        ...expenses.map(e => e.transactionId)
      ].filter(Boolean) as string[];

      for (const txId of allTxIds) {
        try {
          await onDeleteTransaction(txId);
        } catch (err) {
          console.error("Error deleting transaction during sheet clear:", err);
        }
      }
    }

    setRows([]);
    setExpenses([]);
    setSuccessMessage("Daily sheet cleared successfully.");
    setTimeout(() => setSuccessMessage(""), 4000);
  };

  // Manual explicit "Save Changes" button handler
  const handleSaveChanges = async () => {
    if (currentUserRole === "Auditor") {
      setErrorMessage("Security Exception: Sacco Auditors have read-only access and cannot post log sheets to ledger.");
      setTimeout(() => setErrorMessage(""), 5000);
      return;
    }

    const timestampShort = selectedDate;
    const unpostedRows = rows.filter(row => !row.transactionId && (row.vehiclePlate || getRowTotal(row) > 0));
    const unpostedExpenses = expenses.filter(exp => !exp.transactionId && exp.amount > 0 && exp.description.trim());

    try {
      let savedCount = 0;
      const createdRowIds = new Map<number, string>();

      // Post unposted rows
      for (const row of unpostedRows) {
        const grossAmount = getRowTotal(row);
        if (grossAmount <= 0 && !row.vehiclePlate.trim()) continue;

        const effectiveTimestamp = new Date(`${selectedDate}T${new Date().toTimeString().slice(0, 8)}`).toISOString();
        const transaction = await onAddTransaction({
          vehiclePlate: row.vehiclePlate.trim().toUpperCase(),
          vehicleClass: row.vehicleClass,
          operationAmount: row.operation,
          entranceFee: row.entranceFee,
          loanRepay: row.loanRepay,
          savingsContribution: row.savings,
          sTicket: row.sTicket,
          legalFee: row.legalFee,
          grossAmount,
          description: `${row.vehicleClass} daily collection (${selectedRoute || "field sheet"} - row ${row.no})`,
          refCode: `SWT-DLY-${row.vehiclePlate.replace(/\s+/g, "")}-${timestampShort.replace(/-/g, "")}-${row.no}`,
          type: "Credit",
          category: "Daily Contribution",
          amount: grossAmount,
          tillNumber: "VehicleTill",
          timestamp: effectiveTimestamp
        } as any);

        createdRowIds.set(row.no, transaction.id);
        savedCount++;
      }

      // Post unposted expenses
      const createdExpenseIds = new Map<number, string>();
      for (const expense of unpostedExpenses) {
        const effectiveTimestamp = new Date(`${selectedDate}T${new Date().toTimeString().slice(0, 8)}`).toISOString();
        const transaction = await onAddTransaction({
          description: `${expense.description} (${selectedRoute || "field sheet"} expense)`,
          refCode: `SWT-EXP-${timestampShort.replace(/-/g, "")}-${expense.no}`,
          type: "Debit",
          category: "Petty Cash",
          amount: expense.amount,
          tillNumber: "VehicleTill",
          timestamp: effectiveTimestamp
        } as any);

        createdExpenseIds.set(expense.no, transaction.id);
        savedCount++;
      }

      // Update existing posted rows
      for (const row of rows.filter(r => r.transactionId)) {
        await autoSaveRow(row);
      }

      // Update local state with newly assigned IDs
      setRows(prev => prev.map(r => createdRowIds.has(r.no) ? { ...r, transactionId: createdRowIds.get(r.no) } : r));
      setExpenses(prev => prev.map(e => createdExpenseIds.has(e.no) ? { ...e, transactionId: createdExpenseIds.get(e.no) } : e));

      setSuccessMessage(`All daily collection changes and ${savedCount} new entries successfully saved to the ledger!`);
      setTimeout(() => setSuccessMessage(""), 5000);
    } catch (error: any) {
      setErrorMessage(error?.message || "Could not save entries to the ledger.");
      setTimeout(() => setErrorMessage(""), 5000);
    }
  };

  const triggerPrint = () => {
    window.print();
  };

  // Math aggregates
  const totalOperation = rows.reduce((sum, r) => sum + Number(r.operation || 0), 0);
  const totalEntrance = rows.reduce((sum, r) => sum + Number(r.entranceFee || 0), 0);
  const totalLoanRepay = rows.reduce((sum, r) => sum + Number(r.loanRepay || 0), 0);
  const totalSavings = rows.reduce((sum, r) => sum + Number(r.savings || 0), 0);
  const totalSTicket = rows.reduce((sum, r) => sum + Number(r.sTicket || 0), 0);
  const totalLegalFee = rows.reduce((sum, r) => sum + Number(r.legalFee || 0), 0);

  const totalRevenue = rows.reduce((sum, r) => sum + getRowTotal(r), 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const netIncome = totalRevenue - totalExpenses;

  // Segmenting Nissan vs Sienta
  const nissanRows = rows.filter(r => r.vehicleClass === "Nissan");
  const sientaRows = rows.filter(r => r.vehicleClass === "Sienta" || r.vehicleClass === "Member Contribution");

  const nissanTotal = nissanRows.reduce((sum, r) => sum + getRowTotal(r), 0);
  const sientaTotal = sientaRows.reduce((sum, r) => sum + getRowTotal(r), 0);

  const nissanOperation = nissanRows.reduce((sum, r) => sum + Number(r.operation || 0), 0);
  const nissanEntrance = nissanRows.reduce((sum, r) => sum + Number(r.entranceFee || 0), 0);
  const nissanLoanRepay = nissanRows.reduce((sum, r) => sum + Number(r.loanRepay || 0), 0);
  const nissanSavings = nissanRows.reduce((sum, r) => sum + Number(r.savings || 0), 0);
  const nissanSTicket = nissanRows.reduce((sum, r) => sum + Number(r.sTicket || 0), 0);
  const nissanLegalFee = nissanRows.reduce((sum, r) => sum + Number(r.legalFee || 0), 0);

  const sientaOperation = sientaRows.reduce((sum, r) => sum + Number(r.operation || 0), 0);
  const sientaEntrance = sientaRows.reduce((sum, r) => sum + Number(r.entranceFee || 0), 0);
  const sientaLoanRepay = sientaRows.reduce((sum, r) => sum + Number(r.loanRepay || 0), 0);
  const sientaSavings = sientaRows.reduce((sum, r) => sum + Number(r.savings || 0), 0);
  const sientaSTicket = sientaRows.reduce((sum, r) => sum + Number(r.sTicket || 0), 0);
  const sientaLegalFee = sientaRows.reduce((sum, r) => sum + Number(r.legalFee || 0), 0);

  return (
    <div className="flex-1 p-4 sm:p-8 overflow-y-auto bg-slate-100 font-sans flex flex-col space-y-6 min-h-0">
      
      {/* =========================================================================
          SCREEN-ONLY VIEW (Interactive Form, UI Filters, Save & Print Buttons)
          ========================================================================= */}
      <div className="flex flex-col space-y-6 print:hidden">

        {/* EXPLANATORY HEADER BANNER */}
        <div className="bg-slate-900 text-white p-5 rounded-2xl border border-slate-950 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0 no-print">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="text-[9px] font-bold uppercase tracking-widest bg-emerald-500 text-slate-950 px-2 py-0.5 rounded font-mono border border-emerald-600">
                FIELD OFFICE LOG DIGITIZATION
              </span>
              <span className="text-[9px] font-bold uppercase tracking-widest bg-amber-500 text-slate-950 px-2 py-0.5 rounded font-mono">
                REAL-TIME AUTO-SAVE
              </span>
            </div>
            <h2 className="text-lg font-bold font-display text-slate-100 mt-1 flex items-center">
              <ClipboardList className="w-5 h-5 text-emerald-400 mr-2" />
              Sowetamu Sacco — Daily Field Collection Sheet
            </h2>
            <p className="text-xs text-slate-400 max-w-2xl leading-normal">
              Record daily collections for <strong className="text-white">Nissans &amp; Sientas</strong>. Edits automatically sync to the general ledger, and printing separates Nissans and Sientas onto their own high-visibility dedicated pages.
            </p>
          </div>

          <div className="flex flex-row md:flex-col items-end gap-2 shrink-0 justify-between md:justify-center">
            <button
              onClick={triggerPrint}
              className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl border border-emerald-600 flex items-center space-x-2 transition-all shadow-md active:scale-95 cursor-pointer"
              title="Print high-contrast 2-page hardcopy"
            >
              <Printer className="w-4 h-4 text-slate-950" />
              <span>Print Hardcopy (2 Pages)</span>
            </button>
            
            <span className="text-[10px] text-slate-400 font-mono hidden md:block">
              {isAutoSaving ? "🔄 Syncing to Ledger..." : "🟢 Live Ledger Connected"}
            </span>
          </div>
        </div>

        {/* SYSTEM MESSAGES */}
        {successMessage && (
          <div className="bg-emerald-50 border-2 border-emerald-500 text-emerald-950 p-4 rounded-xl flex items-center space-x-2.5 text-xs shadow-sm shrink-0 animate-fade-in no-print">
            <Check className="w-5 h-5 text-emerald-600 shrink-0" />
            <span className="font-bold">{successMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="bg-rose-50 border-2 border-rose-500 text-rose-950 p-4 rounded-xl flex items-center space-x-2.5 text-xs shadow-sm shrink-0 animate-fade-in no-print">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <span className="font-bold">{errorMessage}</span>
          </div>
        )}

        {/* METADATA FILTERS CONTROLLER */}
        <div className="bg-white border-2 border-slate-900 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 no-print shrink-0">
          <div className="flex flex-col sm:flex-row gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1 font-mono">
                COLLECTION DATE *
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono font-bold bg-slate-50 focus:outline-none focus:border-slate-900"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1 font-mono">
                STAGE ROUTE LOCATION
              </label>
              <input
                type="text"
                value={selectedRoute}
                onChange={(e) => setSelectedRoute(e.target.value)}
                placeholder="e.g. Stage 17 to Machakos"
                className="px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold bg-slate-50 focus:outline-none focus:border-slate-900 w-64"
              />
            </div>
          </div>

          <div className="flex items-center space-x-2 self-end md:self-auto">
            <button
              onClick={handleResetDefaults}
              disabled={isReadOnly}
              className="px-3.5 py-2 border border-slate-300 hover:border-slate-400 text-slate-600 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center space-x-1 transition-all cursor-pointer"
              title="Clear this daily sheet"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear Sheet</span>
            </button>

            <button
              onClick={handleSaveChanges}
              disabled={isReadOnly}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5 transition-all shadow-sm cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Save Changes</span>
            </button>
          </div>
        </div>

        {/* INTERACTIVE TABLE SHEET */}
        <div className="bg-white border-2 border-slate-900 p-4 sm:p-6 shadow-md rounded-2xl flex flex-col flex-1 min-h-0">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b-2 border-slate-900 pb-4 mb-4 gap-4">
            <div>
              <h1 className="text-xl font-black font-display tracking-tight text-slate-900">SOWETAMU SACCO DAILY REGISTER</h1>
              <p className="text-xs text-slate-500 font-mono">Route: {selectedRoute} &bull; Date: {selectedDate}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold font-mono px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-lg">
                Nissans (14s): {nissanRows.length}
              </span>
              <span className="text-xs font-bold font-mono px-2.5 py-1 bg-sky-100 text-sky-800 rounded-lg">
                Sientas (7s): {sientaRows.length}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto border-2 border-slate-900 rounded-xl mb-4">
            <table className="w-full text-left border-collapse min-w-[850px]">
              <thead className="bg-slate-100 text-[10px] font-black uppercase tracking-wider border-b-2 border-slate-900 text-slate-800 font-mono">
                <tr>
                  <th className="px-3 py-2.5 border-r border-slate-300 w-12 text-center">NO</th>
                  <th className="px-3 py-2.5 border-r border-slate-300 w-36">V.REG (PLATE)</th>
                  <th className="px-3 py-2.5 border-r border-slate-300 w-28">CLASS</th>
                  <th className="px-3 py-2.5 border-r border-slate-300 text-right">OPERATION</th>
                  <th className="px-3 py-2.5 border-r border-slate-300 text-right">ENTRANCE</th>
                  <th className="px-3 py-2.5 border-r border-slate-300 text-right">LOAN REPAY</th>
                  <th className="px-3 py-2.5 border-r border-slate-300 text-right">SAVINGS</th>
                  <th className="px-3 py-2.5 border-r border-slate-300 text-right">S/TICKET</th>
                  <th className="px-3 py-2.5 border-r border-slate-300 text-right">LEGAL FEE</th>
                  <th className="px-3 py-2.5 text-right w-32 bg-slate-50 font-black text-slate-900">TOTAL</th>
                  <th className="px-3 py-2.5 text-center w-12 no-print"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {rows.map((row) => {
                  const rowTotal = getRowTotal(row);
                  return (
                    <tr key={row.no} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-3 py-2 border-r border-slate-200 text-center font-bold font-mono text-slate-500">
                        {row.no}
                      </td>

                      <td className="px-3 py-2 border-r border-slate-200">
                        <input
                          type="text"
                          value={row.vehiclePlate}
                          disabled={isReadOnly}
                          onChange={(e) => handleVehiclePlateChange(row.no, e.target.value)}
                          onBlur={() => handleRowBlur(row.no)}
                          placeholder="KCA 123A"
                          className="w-full p-1 border border-transparent hover:border-slate-300 focus:border-slate-900 font-mono font-bold uppercase bg-transparent text-slate-900 text-xs rounded focus:outline-none focus:bg-white"
                        />
                      </td>

                      <td className="px-3 py-2 border-r border-slate-200">
                        <select
                          value={row.vehicleClass}
                          disabled={isReadOnly}
                          onChange={(e) => handleVehicleClassChange(row.no, e.target.value as VehicleClass)}
                          className="w-full p-1 border border-transparent hover:border-slate-300 focus:border-slate-900 text-xs font-bold rounded focus:outline-none bg-transparent"
                        >
                          <option value="Nissan">Nissan (14s)</option>
                          <option value="Sienta">Sienta (7s)</option>
                          <option value="Member Contribution">Member Contrib</option>
                        </select>
                      </td>

                      <td className="px-3 py-2 border-r border-slate-200 text-right">
                        <input
                          type="number"
                          value={row.operation || ""}
                          disabled={isReadOnly}
                          onChange={(e) => handleUpdateRowField(row.no, "operation", Number(sanitizeDecimalInput(e.target.value)) || 0)}
                          onBlur={() => handleRowBlur(row.no)}
                          inputMode="decimal"
                          className="w-full p-1 border border-transparent hover:border-slate-300 focus:border-slate-900 font-mono text-right bg-transparent text-slate-900 text-xs rounded focus:outline-none focus:bg-white"
                        />
                      </td>

                      <td className="px-3 py-2 border-r border-slate-200 text-right">
                        <input
                          type="number"
                          value={row.entranceFee || ""}
                          disabled={isReadOnly}
                          onChange={(e) => handleUpdateRowField(row.no, "entranceFee", Number(sanitizeDecimalInput(e.target.value)) || 0)}
                          onBlur={() => handleRowBlur(row.no)}
                          inputMode="decimal"
                          className="w-full p-1 border border-transparent hover:border-slate-300 focus:border-slate-900 font-mono text-right bg-transparent text-slate-900 text-xs rounded focus:outline-none focus:bg-white"
                        />
                      </td>

                      <td className="px-3 py-2 border-r border-slate-200 text-right">
                        <input
                          type="number"
                          value={row.loanRepay || ""}
                          disabled={isReadOnly}
                          onChange={(e) => handleUpdateRowField(row.no, "loanRepay", Number(sanitizeDecimalInput(e.target.value)) || 0)}
                          onBlur={() => handleRowBlur(row.no)}
                          inputMode="decimal"
                          className="w-full p-1 border border-transparent hover:border-slate-300 focus:border-slate-900 font-mono text-right bg-transparent text-slate-900 text-xs rounded focus:outline-none focus:bg-white"
                        />
                      </td>

                      <td className="px-3 py-2 border-r border-slate-200 text-right">
                        <input
                          type="number"
                          value={row.savings || ""}
                          disabled={isReadOnly}
                          onChange={(e) => handleUpdateRowField(row.no, "savings", Number(sanitizeDecimalInput(e.target.value)) || 0)}
                          onBlur={() => handleRowBlur(row.no)}
                          inputMode="decimal"
                          className="w-full p-1 border border-transparent hover:border-slate-300 focus:border-slate-900 font-mono text-right bg-transparent text-blue-800 font-bold text-xs rounded focus:outline-none focus:bg-white"
                        />
                      </td>

                      <td className="px-3 py-2 border-r border-slate-200 text-right">
                        <input
                          type="number"
                          value={row.sTicket || ""}
                          disabled={isReadOnly}
                          onChange={(e) => handleUpdateRowField(row.no, "sTicket", Number(sanitizeDecimalInput(e.target.value)) || 0)}
                          onBlur={() => handleRowBlur(row.no)}
                          inputMode="decimal"
                          className="w-full p-1 border border-transparent hover:border-slate-300 focus:border-slate-900 font-mono text-right bg-transparent text-amber-800 font-bold text-xs rounded focus:outline-none focus:bg-white"
                        />
                      </td>

                      <td className="px-3 py-2 border-r border-slate-200 text-right">
                        <input
                          type="number"
                          value={row.legalFee || ""}
                          disabled={isReadOnly}
                          onChange={(e) => handleUpdateRowField(row.no, "legalFee", Number(sanitizeDecimalInput(e.target.value)) || 0)}
                          onBlur={() => handleRowBlur(row.no)}
                          inputMode="decimal"
                          className="w-full p-1 border border-transparent hover:border-slate-300 focus:border-slate-900 font-mono text-right bg-transparent text-rose-800 font-bold text-xs rounded focus:outline-none focus:bg-white"
                        />
                      </td>

                      <td className="px-3 py-2 text-right bg-slate-50 font-mono font-bold text-slate-950">
                        KSH {rowTotal.toLocaleString()}
                      </td>

                      <td className="px-3 py-2 text-center no-print">
                        <button
                          onClick={() => handleDeleteRow(row.no)}
                          disabled={isReadOnly}
                          className="text-slate-300 hover:text-rose-600 p-1 rounded transition-colors cursor-pointer"
                          title="Delete this log record"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {rows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="py-8 text-center text-slate-400 font-medium font-mono text-xs">
                      No vehicle logs recorded. Click "Add Vehicle Entry" below to add a row.
                    </td>
                  </tr>
                )}
              </tbody>

              <tfoot className="bg-slate-900 text-white font-mono text-[11px] uppercase tracking-wider font-bold border-t-2 border-slate-900">
                <tr>
                  <td colSpan={3} className="px-3 py-3 border-r border-slate-700 text-center text-slate-200">
                    TOTAL SUMS
                  </td>
                  <td className="px-3 py-3 border-r border-slate-700 text-right text-emerald-400">
                    {totalOperation > 0 ? `KSH ${totalOperation.toLocaleString()}` : "—"}
                  </td>
                  <td className="px-3 py-3 border-r border-slate-700 text-right text-emerald-400">
                    {totalEntrance > 0 ? `KSH ${totalEntrance.toLocaleString()}` : "—"}
                  </td>
                  <td className="px-3 py-3 border-r border-slate-700 text-right text-slate-100">
                    {totalLoanRepay > 0 ? `KSH ${totalLoanRepay.toLocaleString()}` : "—"}
                  </td>
                  <td className="px-3 py-3 border-r border-slate-700 text-right text-blue-300">
                    {totalSavings > 0 ? `KSH ${totalSavings.toLocaleString()}` : "—"}
                  </td>
                  <td className="px-3 py-3 border-r border-slate-700 text-right text-amber-300">
                    {totalSTicket > 0 ? `KSH ${totalSTicket.toLocaleString()}` : "—"}
                  </td>
                  <td className="px-3 py-3 border-r border-slate-700 text-right text-rose-300">
                    {totalLegalFee > 0 ? `KSH ${totalLegalFee.toLocaleString()}` : "—"}
                  </td>
                  <td className="px-3 py-3 text-right bg-emerald-950 text-emerald-400 font-black border-l border-emerald-900">
                    KSH {totalRevenue.toLocaleString()}
                  </td>
                  <td className="no-print"></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {!isReadOnly && (
            <div className="flex space-x-2 mb-6 no-print">
              <button
                onClick={handleAddRow}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 border-2 border-slate-900 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center space-x-1.5 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4 text-slate-800" />
                <span>Add Vehicle Entry</span>
              </button>
            </div>
          )}

          {/* LOWER EXPENSES & RECONCILIATION */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-7 bg-slate-50 border-2 border-slate-900 rounded-2xl p-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-300 pb-2 mb-3">
                <h3 className="text-xs font-black uppercase text-slate-900 tracking-wider font-mono flex items-center">
                  <span className="w-2.5 h-2.5 bg-rose-600 rounded-full mr-2"></span>
                  Daily Field Expenses Sheet (Stage Deductions)
                </h3>
              </div>

              <div className="space-y-2 font-mono">
                {expenses.map((exp, idx) => (
                  <div key={idx} className="flex items-center space-x-2 text-xs">
                    <span className="w-6 font-bold text-slate-500 text-center">{idx + 1}.</span>
                    <input
                      type="text"
                      value={exp.description}
                      disabled={isReadOnly}
                      onChange={(e) => handleUpdateExpenseField(exp.no, idx, "description", e.target.value)}
                      onBlur={() => handleExpenseBlur(idx)}
                      placeholder="Expense item (e.g. Stage Marshall)"
                      className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:border-slate-900"
                    />
                    <div className="flex items-center space-x-1 w-32">
                      <span className="text-slate-400 text-[10px]">KSH</span>
                      <input
                        type="number"
                        value={exp.amount || ""}
                        disabled={isReadOnly}
                        onChange={(e) => handleUpdateExpenseField(exp.no, idx, "amount", Number(sanitizeDecimalInput(e.target.value)) || 0)}
                        onBlur={() => handleExpenseBlur(idx)}
                        inputMode="decimal"
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-right font-bold text-rose-700 text-xs bg-white focus:outline-none focus:border-slate-900"
                      />
                    </div>
                    {!isReadOnly && (
                      <button
                        onClick={() => handleDeleteExpenseRow(idx)}
                        className="text-slate-300 hover:text-rose-600 p-1 rounded transition-colors no-print cursor-pointer"
                        title="Delete expense line"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {!isReadOnly && (
                <button
                  onClick={handleAddExpenseRow}
                  className="mt-3 px-3 py-1.5 text-xs bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold uppercase tracking-wider rounded-lg flex items-center space-x-1 transition-all no-print cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-slate-800" />
                  <span>Add Expense Line</span>
                </button>
              )}

              <div className="mt-4 pt-3 border-t border-slate-300 flex justify-between items-center text-xs font-mono font-black text-slate-900">
                <span className="uppercase text-slate-600">TOTAL STAGE EXPENSES:</span>
                <span className="text-rose-700">KSH {totalExpenses.toLocaleString()}.00</span>
              </div>
            </div>

            <div className="lg:col-span-5 bg-slate-900 text-white border-2 border-slate-950 p-5 rounded-2xl shadow-xs space-y-4">
              <h3 className="text-xs font-black uppercase tracking-wider border-b border-slate-800 pb-2 text-emerald-400 font-mono">
                Daily Financial Summary
              </h3>

              <div className="space-y-2.5 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Route Deposits:</span>
                  <span className="font-bold text-emerald-400">+ KSH {totalRevenue.toLocaleString()}.00</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Stage Expenses:</span>
                  <span className="font-bold text-rose-400">- KSH {totalExpenses.toLocaleString()}.00</span>
                </div>
                <div className="border-t border-slate-800 pt-2.5 flex justify-between text-sm font-black uppercase">
                  <span>Net Sacco Inflow:</span>
                  <span className={netIncome >= 0 ? "text-emerald-400" : "text-rose-400"}>
                    KSH {netIncome.toLocaleString()}.00
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================================
          DEDICATED 2-PAGE PRINTABLE DOCUMENT
          (Page 1: Nissan 14-Seaters | Page 2: Sienta 7-Seaters)
          High contrast, large fonts (20px), zero delete buttons, zero UI chrome.
          ========================================================================= */}
      <div className="hidden print:block print-doc text-black bg-white w-full">

        {/* =====================================================================
            PAGE 1: NISSAN (14-SEATER VEHICLES) DAILY COLLECTION SHEET
            ===================================================================== */}
        <div className="print-page-break p-2">
          {/* SOWETAMU OFFICIAL HEADER */}
          <div className="flex justify-between items-center border-b-4 border-black pb-2 mb-2">
            <div>
              <h1 className="text-3xl font-black font-display tracking-tight text-black">SOWETAMU SACCO</h1>
              <p className="text-sm font-bold uppercase tracking-widest font-mono">TRAVELLERS SACCO SOCIETY LTD</p>
              <p className="text-xs italic text-black">"We Serve with Courtesy, Discipline &amp; Dignity"</p>
            </div>
            <div className="text-right text-xs font-mono font-bold space-y-0.5">
              <p>P.O. BOX 1324-00518, NAIROBI</p>
              <p>Email: sowetamusaacco@gmail.com</p>
              <p>Tel: 0715600000 / 0705749293</p>
            </div>
          </div>

          {/* PAGE 1 TITLE & METADATA */}
          <div className="flex justify-between items-center bg-black text-white p-2 mb-2 font-mono font-bold text-sm uppercase">
            <span className="text-base font-black">PAGE 1 &bull; NISSAN (14-SEATERS) DAILY COLLECTION SHEET</span>
            <span>DATE: {selectedDate} | ROUTE: {selectedRoute}</span>
          </div>

          {/* NISSAN TABLE */}
          <table className="print-table">
            <thead>
              <tr>
                <th style={{ width: "45px", textAlign: "center" }}>NO</th>
                <th style={{ width: "160px" }}>V.REG (PLATE)</th>
                <th style={{ textAlign: "right" }}>OPERATION</th>
                <th style={{ textAlign: "right" }}>ENTRANCE</th>
                <th style={{ textAlign: "right" }}>LOAN REPAY</th>
                <th style={{ textAlign: "right" }}>SAVINGS</th>
                <th style={{ textAlign: "right" }}>S/TICKET</th>
                <th style={{ textAlign: "right" }}>LEGAL FEE</th>
                <th style={{ textAlign: "right", width: "140px" }}>TOTAL (KSH)</th>
              </tr>
            </thead>
            <tbody>
              {nissanRows.map((row, idx) => {
                const rTotal = getRowTotal(row);
                return (
                  <tr key={row.no}>
                    <td style={{ textAlign: "center" }}>{idx + 1}</td>
                    <td style={{ fontFamily: "monospace", fontWeight: 900 }}>{row.vehiclePlate || "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.operation > 0 ? row.operation.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.entranceFee > 0 ? row.entranceFee.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.loanRepay > 0 ? row.loanRepay.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.savings > 0 ? row.savings.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.sTicket > 0 ? row.sTicket.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.legalFee > 0 ? row.legalFee.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 900 }}>KSH {rTotal.toLocaleString()}</td>
                  </tr>
                );
              })}

              {nissanRows.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: "16px", color: "#666" }}>
                    No Nissan vehicle collections recorded for this date.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} style={{ textAlign: "center" }}>NISSAN TOTALS</td>
                <td style={{ textAlign: "right" }}>{nissanOperation > 0 ? nissanOperation.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right" }}>{nissanEntrance > 0 ? nissanEntrance.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right" }}>{nissanLoanRepay > 0 ? nissanLoanRepay.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right" }}>{nissanSavings > 0 ? nissanSavings.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right" }}>{nissanSTicket > 0 ? nissanSTicket.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right" }}>{nissanLegalFee > 0 ? nissanLegalFee.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right", fontSize: "20px" }}>KSH {nissanTotal.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>

          {/* PAGE 1 FOOTER: STAGE EXPENSES & SIGNATURES */}
          <div className="grid grid-cols-2 gap-4 mt-2 pt-2 border-t-2 border-black font-mono text-sm">
            <div className="border border-black p-2">
              <p className="font-bold border-b border-black pb-1 mb-1 uppercase">Daily Stage Expenses (Deductions):</p>
              {expenses.length > 0 ? (
                expenses.map((e, i) => (
                  <div key={i} className="flex justify-between text-xs py-0.5">
                    <span>{i + 1}. {e.description}</span>
                    <span className="font-bold">KES {Number(e.amount).toLocaleString()}</span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-gray-500">Nil stage expenses recorded.</p>
              )}
              <div className="flex justify-between font-bold border-t border-black pt-1 mt-1">
                <span>TOTAL EXPENSES:</span>
                <span>KES {totalExpenses.toLocaleString()}</span>
              </div>
            </div>

            <div className="border border-black p-2 flex flex-col justify-between">
              <p className="font-bold border-b border-black pb-1 uppercase">Official Stage Endorsement:</p>
              <div className="space-y-4 text-xs pt-2">
                <div className="flex justify-between">
                  <span>Stage Marshall: _______________________</span>
                  <span>Sign: ___________</span>
                </div>
                <div className="flex justify-between">
                  <span>Cashier / Clerk: {currentUserName || "_______________________"}</span>
                  <span>Sign: ___________</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* =====================================================================
            PAGE 2: SIENTA (7-SEATER VEHICLES) DAILY COLLECTION SHEET
            ===================================================================== */}
        <div className="p-2">
          {/* SOWETAMU OFFICIAL HEADER */}
          <div className="flex justify-between items-center border-b-4 border-black pb-2 mb-2">
            <div>
              <h1 className="text-3xl font-black font-display tracking-tight text-black">SOWETAMU SACCO</h1>
              <p className="text-sm font-bold uppercase tracking-widest font-mono">TRAVELLERS SACCO SOCIETY LTD</p>
              <p className="text-xs italic text-black">"We Serve with Courtesy, Discipline &amp; Dignity"</p>
            </div>
            <div className="text-right text-xs font-mono font-bold space-y-0.5">
              <p>P.O. BOX 1324-00518, NAIROBI</p>
              <p>Email: sowetamusaacco@gmail.com</p>
              <p>Tel: 0715600000 / 0705749293</p>
            </div>
          </div>

          {/* PAGE 2 TITLE & METADATA */}
          <div className="flex justify-between items-center bg-black text-white p-2 mb-2 font-mono font-bold text-sm uppercase">
            <span className="text-base font-black">PAGE 2 &bull; SIENTA (7-SEATERS) DAILY COLLECTION SHEET</span>
            <span>DATE: {selectedDate} | ROUTE: {selectedRoute}</span>
          </div>

          {/* SIENTA TABLE */}
          <table className="print-table">
            <thead>
              <tr>
                <th style={{ width: "45px", textAlign: "center" }}>NO</th>
                <th style={{ width: "160px" }}>V.REG (PLATE)</th>
                <th style={{ textAlign: "right" }}>OPERATION</th>
                <th style={{ textAlign: "right" }}>ENTRANCE</th>
                <th style={{ textAlign: "right" }}>LOAN REPAY</th>
                <th style={{ textAlign: "right" }}>SAVINGS</th>
                <th style={{ textAlign: "right" }}>S/TICKET</th>
                <th style={{ textAlign: "right" }}>LEGAL FEE</th>
                <th style={{ textAlign: "right", width: "140px" }}>TOTAL (KSH)</th>
              </tr>
            </thead>
            <tbody>
              {sientaRows.map((row, idx) => {
                const rTotal = getRowTotal(row);
                return (
                  <tr key={row.no}>
                    <td style={{ textAlign: "center" }}>{idx + 1}</td>
                    <td style={{ fontFamily: "monospace", fontWeight: 900 }}>{row.vehiclePlate || "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.operation > 0 ? row.operation.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.entranceFee > 0 ? row.entranceFee.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.loanRepay > 0 ? row.loanRepay.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.savings > 0 ? row.savings.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.sTicket > 0 ? row.sTicket.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.legalFee > 0 ? row.legalFee.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 900 }}>KSH {rTotal.toLocaleString()}</td>
                  </tr>
                );
              })}

              {sientaRows.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: "16px", color: "#666" }}>
                    No Sienta vehicle collections recorded for this date.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} style={{ textAlign: "center" }}>SIENTA TOTALS</td>
                <td style={{ textAlign: "right" }}>{sientaOperation > 0 ? sientaOperation.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right" }}>{sientaEntrance > 0 ? sientaEntrance.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right" }}>{sientaLoanRepay > 0 ? sientaLoanRepay.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right" }}>{sientaSavings > 0 ? sientaSavings.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right" }}>{sientaSTicket > 0 ? sientaSTicket.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right" }}>{sientaLegalFee > 0 ? sientaLegalFee.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right", fontSize: "20px" }}>KSH {sientaTotal.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>

          {/* PAGE 2 FOOTER: GRAND RECONCILIATION SUMMARY & AUDITOR SIGNATURE */}
          <div className="grid grid-cols-2 gap-4 mt-2 pt-2 border-t-2 border-black font-mono text-sm">
            <div className="border border-black p-2">
              <p className="font-bold border-b border-black pb-1 mb-1 uppercase">Daily Combined Revenue Reconciliation:</p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span>Total Nissan Revenue (Page 1):</span>
                  <span className="font-bold">KES {nissanTotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Sienta Revenue (Page 2):</span>
                  <span className="font-bold">KES {sientaTotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between border-t border-black pt-1">
                  <span>Gross Sacco Deposits:</span>
                  <span className="font-bold">KES {totalRevenue.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-red-700">
                  <span>Less Total Stage Deductions:</span>
                  <span className="font-bold">- KES {totalExpenses.toLocaleString()}</span>
                </div>
                <div className="flex justify-between font-black border-t-2 border-black pt-1 text-sm bg-gray-100 p-1">
                  <span>NET SACCO INFLOW:</span>
                  <span>KES {netIncome.toLocaleString()}.00</span>
                </div>
              </div>
            </div>

            <div className="border border-black p-2 flex flex-col justify-between">
              <p className="font-bold border-b border-black pb-1 uppercase">Executive &amp; Audit Approval:</p>
              <div className="space-y-3 text-xs pt-2">
                <div className="flex justify-between">
                  <span>Treasurer: _______________________</span>
                  <span>Sign: ___________</span>
                </div>
                <div className="flex justify-between">
                  <span>Chairman: _______________________</span>
                  <span>Sign: ___________</span>
                </div>
                <div className="flex justify-between">
                  <span>Auditor Reg: CS/NO. 22239</span>
                  <span>Stamp: ___________</span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
