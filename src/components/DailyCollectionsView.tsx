import React, { useState, useEffect, useMemo, useCallback } from "react";
import type { Vehicle, Member, Transaction, VehicleClass } from "../types";
import { sanitizeDecimalInput } from "../lib/inputValidation";
import ActionConfirmationModal from "./ActionConfirmationModal";
import { 
  Printer, 
  Plus, 
  Trash2, 
  ClipboardList, 
  Check, 
  RotateCcw, 
  AlertTriangle, 
  Send,
  Undo2,
  Calendar,
  Search,
  History,
  RefreshCw,
  Clock,
  Car,
  CreditCard
} from "lucide-react";
import { CollectionPaymentModal } from "./CollectionPaymentModal";

interface DailyCollectionsViewProps {
  vehicles: Vehicle[];
  members: Member[];
  transactions: Transaction[];
  onAddTransaction: (newTx: Omit<Transaction, "id" | "timestamp" | "recorderName">) => Promise<Transaction>;
  onUpdateTransaction: (transactionId: string, changes: Partial<Transaction>) => Promise<Transaction>;
  onDeleteTransaction?: (transactionId: string) => Promise<void>;
  onRefreshData?: () => void;
  currentUserRole: string;
  currentUserName: string;
  authToken?: string;
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
  isPaid?: boolean;
  notes?: string;
  refCode?: string;
  memberName?: string;
  memberId?: string;
}

interface ExpenseRow {
  no: number;
  description: string;
  amount: number;
  transactionId?: string;
}

interface UndoAction {
  type: "SAVE" | "DELETE";
  description: string;
  createdTxIds?: string[];
  updatedTxsBackup?: Array<{ id: string; changes: Partial<Transaction> }>;
  deletedTx?: Transaction;
  deletedRow?: CollectionRow;
  deletedExpense?: ExpenseRow;
}

interface ConfirmationModalConfig {
  title: string;
  variant: "warning" | "danger" | "info";
  summaryText: string;
  consequenceText: string;
  details: Array<{ label: string; value: string | number | React.ReactNode }>;
  confirmButtonText: string;
  onConfirm: () => Promise<void>;
}

// Date normalization helper ensuring any input format or day number becomes YYYY-MM-DD
export function normalizeTargetDate(raw: string): string {
  if (!raw) return new Date().toISOString().slice(0, 10);
  const trimmed = raw.trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = String(now.getMonth() + 1).padStart(2, '0');

  // Single or double digit day number e.g. "9", "09", "6"
  if (/^\d{1,2}$/.test(trimmed)) {
    const day = trimmed.padStart(2, '0');
    return `${currentYear}-${currentMonth}-${day}`;
  }

  // Split by slash, dash, or dot
  const parts = trimmed.split(/[-/.]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    } else if (parts[2].length === 4) {
      const p1 = parseInt(parts[0], 10);
      const p2 = parseInt(parts[1], 10);
      const y = parts[2];
      if (p1 > 12) {
        return `${y}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`;
      } else if (p2 > 12) {
        return `${y}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`;
      } else {
        return `${y}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`;
      }
    }
  }

  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return trimmed;
}

export default function DailyCollectionsView({
  vehicles,
  members,
  transactions,
  onAddTransaction,
  onUpdateTransaction,
  onDeleteTransaction,
  onRefreshData,
  currentUserRole,
  currentUserName,
  authToken
}: DailyCollectionsViewProps) {
  
  // Payment Form Modal State
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState<boolean>(false);
  const [paymentModalRow, setPaymentModalRow] = useState<CollectionRow | null>(null);

  const handleOpenNewPaymentModal = () => {
    setPaymentModalRow(null);
    setIsPaymentModalOpen(true);
  };

  const handleOpenRowPaymentModal = (row: CollectionRow) => {
    setPaymentModalRow(row);
    setIsPaymentModalOpen(true);
  };

  const handlePaymentModalComplete = async (savedTx: Omit<Transaction, "id" | "recorderName">) => {
    await onAddTransaction(savedTx);
    setIsDirty(false);
    setSuccessMessage(`Payment of KES ${Number(savedTx.amount).toLocaleString()} successfully processed and recorded!`);
    setTimeout(() => setSuccessMessage(""), 4000);
    if (onRefreshData) onRefreshData();
  };
  
  // Basic Sheet State
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [inputDate, setInputDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [selectedRoute, setSelectedRoute] = useState<string>("Stage 17 to Machakos");
  
  // State for rows in the table
  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [isDirty, setIsDirty] = useState<boolean>(false);
  
  // User Feedback and Undo
  const [successMessage, setSuccessMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const [isUndoing, setIsUndoing] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  
  // Confirmation Modal
  const [confirmationConfig, setConfirmationConfig] = useState<ConfirmationModalConfig | null>(null);
  
  const isReadOnly = currentUserRole === "Auditor";
  const activeVehicles = vehicles.filter(vehicle => vehicle.status === "Active");

  const getRowTotal = (r: CollectionRow) =>
    Number(r.operation || 0) + Number(r.entranceFee || 0) + Number(r.loanRepay || 0) +
    Number(r.savings || 0) + Number(r.sTicket || 0) + Number(r.legalFee || 0);

  // Highly resilient date matching helper (matches YYYY-MM-DD, day numbers, local time, and UTC)
  const isTxForDate = useCallback((tx: Transaction, targetDate: string) => {
    if (!targetDate) return false;
    const cleanTarget = normalizeTargetDate(targetDate);

    // 1. Direct entryDate match (e.g. "2026-09-09")
    if (tx.entryDate) {
      const ed = tx.entryDate.trim();
      if (ed === cleanTarget) return true;
      if (ed.startsWith(cleanTarget) || cleanTarget.startsWith(ed)) return true;
    }

    // 2. Direct ISO timestamp slice (e.g. "2026-09-09")
    if (tx.timestamp) {
      const isoDate = tx.timestamp.slice(0, 10);
      if (isoDate === cleanTarget) return true;

      // 3. Local date string match across timezones
      try {
        const d = new Date(tx.timestamp);
        if (!isNaN(d.getTime())) {
          if (d.toLocaleDateString('en-CA') === cleanTarget) return true;
          if (d.toISOString().slice(0, 10) === cleanTarget) return true;
        }
      } catch {}
    }

    // 4. Ref code match (e.g. SWT-DLY-KCA123A-20260909-1)
    if (tx.refCode) {
      const compact = cleanTarget.replace(/[-/]/g, '');
      if (compact.length >= 8 && tx.refCode.includes(compact)) return true;
    }

    return false;
  }, [normalizeTargetDate]);

  // Distinct list of dates with recorded data across all transactions
  const availableDatesWithRecords = useMemo(() => {
    const datesMap = new Map<string, number>();
    transactions.forEach(tx => {
      if (!tx.reversalOf && (tx as any).status !== 'Reversed' && String(tx.type).toLowerCase() === 'credit') {
        const d = tx.entryDate || (tx.timestamp ? tx.timestamp.slice(0, 10) : '');
        if (d && d.length >= 10) {
          const norm = d.slice(0, 10);
          datesMap.set(norm, (datesMap.get(norm) || 0) + 1);
        }
      }
    });
    return Array.from(datesMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 10);
  }, [transactions]);

  // Sync state from backend transactions for the selected date
  const loadSheetForDate = useCallback((targetDate: string) => {
    const normDate = normalizeTargetDate(targetDate);
    setSelectedDate(normDate);
    setInputDate(normDate);

    const dailyTxs = transactions.filter(tx =>
      !tx.reversalOf &&
      (tx as any).status !== 'Reversed' &&
      String(tx.type).toLowerCase() === "credit" &&
      (tx.category === "Daily Contribution" || Boolean(tx.vehiclePlate) || tx.tillNumber === "VehicleTill") &&
      isTxForDate(tx, normDate)
    );

    const expenseTxs = transactions.filter(tx =>
      !tx.reversalOf &&
      (tx as any).status !== 'Reversed' &&
      String(tx.type).toLowerCase() === "debit" &&
      (tx.category === "Petty Cash" || tx.category === "Office Expenses" || tx.tillNumber === "VehicleTill") &&
      isTxForDate(tx, normDate)
    );

    const syncedRows: CollectionRow[] = dailyTxs.map((tx, index) => {
      const op = Number(tx.operationAmount || 0);
      const ent = Number(tx.entranceFee || 0);
      const lr = Number(tx.loanRepay || 0);
      const sav = Number(tx.savingsContribution || 0);
      const stk = Number(tx.sTicket || 0);
      const leg = Number(tx.legalFee || 0);
      const breakdownSum = op + ent + lr + sav + stk + leg;
      // If specific breakdown fields are all zero but tx.amount > 0, fallback to operation
      const finalOp = breakdownSum === 0 && tx.amount > 0 ? Number(tx.amount) : op;

      return {
        transactionId: tx.id,
        no: index + 1,
        vehiclePlate: tx.vehiclePlate || "",
        vehicleClass: tx.vehicleClass || (vehicles.find(v => v.plateNumber === tx.vehiclePlate)?.capacity === 7 ? "Sienta" : "Nissan"),
        operation: finalOp,
        entranceFee: ent,
        loanRepay: lr,
        savings: sav,
        sTicket: stk,
        legalFee: leg,
        isPaid: true,
        notes: tx.description || "",
        refCode: tx.refCode || "",
        memberName: tx.memberName || (members.find(m => m.id === tx.memberId)?.name) || "",
        memberId: tx.memberId || ""
      };
    });

    const syncedExpenses: ExpenseRow[] = expenseTxs.map((tx, index) => ({
      transactionId: tx.id,
      no: index + 1,
      description: tx.description.replace(/\s*\([^)]*\)\s*$/, "").trim() || tx.description,
      amount: Number(tx.amount || 0)
    }));

    if (syncedRows.length > 0) {
      setRows(syncedRows);
    } else {
      setRows(
        activeVehicles.map((vehicle, index) => ({
          no: index + 1,
          vehiclePlate: vehicle.plateNumber,
          vehicleClass: vehicle.capacity === 7 ? "Sienta" : "Nissan",
          operation: 0,
          entranceFee: 0,
          loanRepay: 0,
          savings: 0,
          sTicket: 0,
          legalFee: 0,
          isPaid: false,
          notes: ""
        }))
      );
    }

    setExpenses(syncedExpenses);
    setIsDirty(false);
  }, [isTxForDate, normalizeTargetDate, transactions, vehicles, activeVehicles]);

  // Sync whenever selectedDate or transactions changes
  useEffect(() => {
    loadSheetForDate(selectedDate);
  }, [selectedDate, transactions, loadSheetForDate]);

  // Explicit Query Date handler
  const handleQueryDate = (rawDate: string) => {
    if (!rawDate) return;
    const normalized = normalizeTargetDate(rawDate);
    loadSheetForDate(normalized);
    setSuccessMessage(`Loaded records for date ${normalized}.`);
    setTimeout(() => setSuccessMessage(""), 3000);
  };

  // Row update handlers - LOCAL STATE ONLY (No silent auto-save on blur)
  const handleUpdateRowField = (no: number, field: keyof CollectionRow, value: string | number) => {
    if (isReadOnly) return;
    setRows(prev => prev.map(r => r.no === no ? { ...r, [field]: value } : r));
    setIsDirty(true);
  };

  const handleVehicleClassChange = (no: number, vehicleClass: VehicleClass) => {
    if (isReadOnly) return;
    setRows(prev => prev.map(r => r.no === no ? { ...r, vehicleClass } : r));
    setIsDirty(true);
  };

  const handleVehiclePlateChange = (no: number, plate: string) => {
    if (isReadOnly) return;
    const cleanPlate = plate.toUpperCase().trim();
    const matchedVehicle = cleanPlate
      ? vehicles.find(v => v.plateNumber.replace(/\s+/g, "").toUpperCase() === cleanPlate.replace(/\s+/g, ""))
      : undefined;
    const ownerMember = matchedVehicle ? members.find(m => m.id === matchedVehicle.ownerId) : undefined;

    setRows(prev => prev.map(r => {
      if (r.no === no) {
        return {
          ...r,
          vehiclePlate: cleanPlate,
          vehicleClass: matchedVehicle?.capacity === 7 ? "Sienta" : (!cleanPlate ? "Member Contribution" : (r.vehicleClass || "Nissan")),
          memberName: ownerMember?.name || r.memberName,
          memberId: ownerMember?.id || r.memberId
        };
      }
      return r;
    }));
    setIsDirty(true);
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
    setIsDirty(true);
  };

  // Delete Row with Warning Confirmation
  const handleDeleteRowClick = (no: number) => {
    if (isReadOnly) return;
    const targetRow = rows.find(r => r.no === no);
    if (!targetRow) return;

    // If it's an unposted local draft row, delete directly
    if (!targetRow.transactionId) {
      setRows(prev => prev.filter(r => r.no !== no).map((r, index) => ({ ...r, no: index + 1 })));
      setIsDirty(true);
      return;
    }

    const rowTotal = getRowTotal(targetRow);
    const existingTx = transactions.find(t => t.id === targetRow.transactionId);

    setConfirmationConfig({
      title: "Confirm Deletion of Collection Record",
      variant: "danger",
      summaryText: `You are about to delete the recorded daily collection for vehicle ${targetRow.vehiclePlate || `Row ${no}`}.`,
      consequenceText: "This record will be permanently reversed and removed from the SACCO General Ledger. You will be able to undo this deletion immediately if needed.",
      details: [
        { label: "Date", value: selectedDate },
        { label: "Vehicle Plate", value: targetRow.vehiclePlate || "N/A" },
        { label: "Fleet Class", value: targetRow.vehicleClass },
        { label: "Gross Amount", value: `KES ${rowTotal.toLocaleString()}` },
        { label: "Transaction ID", value: targetRow.transactionId.slice(0, 8) + "..." }
      ],
      confirmButtonText: "Confirm Delete Record",
      onConfirm: async () => {
        if (!onDeleteTransaction || !targetRow.transactionId) return;
        await onDeleteTransaction(targetRow.transactionId);

        // Store for undo
        setUndoAction({
          type: "DELETE",
          description: `Deleted ${targetRow.vehiclePlate || `Row ${no}`} (KES ${rowTotal.toLocaleString()})`,
          deletedTx: existingTx,
          deletedRow: targetRow
        });

        setRows(prev => prev.filter(r => r.no !== no).map((r, index) => ({ ...r, no: index + 1 })));
        setConfirmationConfig(null);
        setSuccessMessage(`Transaction for ${targetRow.vehiclePlate || `Row ${no}`} removed from database ledger.`);
        setTimeout(() => setSuccessMessage(""), 5000);
      }
    });
  };

  // Expense row handlers
  const handleAddExpenseRow = () => {
    if (isReadOnly) return;
    const nextNo = expenses.length + 1;
    setExpenses(prev => [...prev, { no: nextNo, description: "", amount: 0 }]);
    setIsDirty(true);
  };

  const handleUpdateExpenseField = (no: number, index: number, field: keyof ExpenseRow, value: string | number) => {
    if (isReadOnly) return;
    setExpenses(prev => prev.map((e, idx) => idx === index ? { ...e, [field]: value } : e));
    setIsDirty(true);
  };

  const handleDeleteExpenseClick = (index: number) => {
    if (isReadOnly) return;
    const targetExp = expenses[index];
    if (!targetExp) return;

    if (!targetExp.transactionId) {
      setExpenses(prev => prev.filter((_, idx) => idx !== index));
      setIsDirty(true);
      return;
    }

    const existingTx = transactions.find(t => t.id === targetExp.transactionId);

    setConfirmationConfig({
      title: "Confirm Deletion of Stage Expense",
      variant: "danger",
      summaryText: `You are about to delete expense line ${index + 1} (${targetExp.description}).`,
      consequenceText: "This expense record will be permanently reversed and removed from the SACCO General Ledger.",
      details: [
        { label: "Date", value: selectedDate },
        { label: "Description", value: targetExp.description },
        { label: "Amount", value: `KES ${Number(targetExp.amount).toLocaleString()}` }
      ],
      confirmButtonText: "Confirm Delete Expense",
      onConfirm: async () => {
        if (!onDeleteTransaction || !targetExp.transactionId) return;
        await onDeleteTransaction(targetExp.transactionId);

        setUndoAction({
          type: "DELETE",
          description: `Deleted expense "${targetExp.description}" (KES ${Number(targetExp.amount).toLocaleString()})`,
          deletedTx: existingTx,
          deletedExpense: targetExp
        });

        setExpenses(prev => prev.filter((_, idx) => idx !== index));
        setConfirmationConfig(null);
        setSuccessMessage(`Expense line deleted from database ledger.`);
        setTimeout(() => setSuccessMessage(""), 5000);
      }
    });
  };

  // Clear Sheet with Warning Confirmation
  const handleResetDefaults = () => {
    if (isReadOnly) return;

    const allTxIds = [
      ...rows.map(r => r.transactionId),
      ...expenses.map(e => e.transactionId)
    ].filter(Boolean) as string[];

    setConfirmationConfig({
      title: "Reset & Clear Daily Collection Sheet",
      variant: "danger",
      summaryText: `Are you sure you want to clear this entire daily sheet for ${selectedDate}?`,
      consequenceText: `All ${rows.length} vehicle rows and ${expenses.length} expenses on this sheet (${allTxIds.length} posted database records) will be completely removed from the SACCO General Ledger.`,
      details: [
        { label: "Date", value: selectedDate },
        { label: "Vehicle Entries", value: rows.length },
        { label: "Stage Expenses", value: expenses.length },
        { label: "Database Ledger Entries", value: allTxIds.length },
        { label: "Gross Total KES", value: `KES ${totalRevenue.toLocaleString()}` }
      ],
      confirmButtonText: "Confirm Clear Sheet",
      onConfirm: async () => {
        if (onDeleteTransaction) {
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
        setIsDirty(false);
        setConfirmationConfig(null);
        setSuccessMessage("Daily sheet cleared successfully.");
        setTimeout(() => setSuccessMessage(""), 4000);
      }
    });
  };

  // Discard local unsaved modifications
  const handleRevertEdits = () => {
    loadSheetForDate(selectedDate);
    setSuccessMessage("Unsaved edits reverted. Sheet restored to database state.");
    setTimeout(() => setSuccessMessage(""), 3000);
  };

  // Explicit Save Changes with Confirmation Warning Modal
  const handleSaveChangesClick = () => {
    if (currentUserRole === "Auditor") {
      setErrorMessage("Security Exception: Sacco Auditors have read-only access and cannot post log sheets to ledger.");
      setTimeout(() => setErrorMessage(""), 5000);
      return;
    }

    const unpostedRows = rows.filter(row => !row.transactionId && (row.vehiclePlate || row.memberName || getRowTotal(row) > 0));
    const unpostedExpenses = expenses.filter(exp => !exp.transactionId && exp.amount > 0 && exp.description.trim());

    // Check updated rows
    const updatedRows = rows.filter(row => {
      if (!row.transactionId) return false;
      const original = transactions.find(t => t.id === row.transactionId);
      if (!original) return false;
      const currentGross = getRowTotal(row);
      return (
        original.vehiclePlate !== row.vehiclePlate.trim().toUpperCase() ||
        original.vehicleClass !== row.vehicleClass ||
        Number(original.operationAmount || 0) !== row.operation ||
        Number(original.entranceFee || 0) !== row.entranceFee ||
        Number(original.loanRepay || 0) !== row.loanRepay ||
        Number(original.savingsContribution || 0) !== row.savings ||
        Number(original.sTicket || 0) !== row.sTicket ||
        Number(original.legalFee || 0) !== row.legalFee ||
        Number(original.grossAmount || 0) !== currentGross
      );
    });

    const updatedExpenses = expenses.filter(exp => {
      if (!exp.transactionId) return false;
      const original = transactions.find(t => t.id === exp.transactionId);
      if (!original) return false;
      return (
        Number(original.amount || 0) !== exp.amount ||
        !original.description.startsWith(exp.description.trim())
      );
    });

    const totalActions = unpostedRows.length + unpostedExpenses.length + updatedRows.length + updatedExpenses.length;
    if (totalActions === 0) {
      setSuccessMessage("This sheet is already up to date. No changes to save.");
      setTimeout(() => setSuccessMessage(""), 3000);
      setIsDirty(false);
      return;
    }

    setConfirmationConfig({
      title: "Confirm Posting Daily Collection to General Ledger",
      variant: "warning",
      summaryText: `You are about to commit ${totalActions} record changes for date ${selectedDate} on route "${selectedRoute}".`,
      consequenceText: "This action will permanently post transactions into the SACCO General Ledger. Member loan repayments, savings balances, and vehicle accounts will be updated.",
      details: [
        { label: "Collection Date", value: selectedDate },
        { label: "New Vehicles to Post", value: `${unpostedRows.length} vehicles` },
        { label: "Existing Logs Updated", value: `${updatedRows.length} vehicles` },
        { label: "New Stage Expenses", value: `${unpostedExpenses.length} entries` },
        { label: "Gross Collections", value: `KES ${totalRevenue.toLocaleString()}` },
        { label: "Total Deductions", value: `KES ${totalExpenses.toLocaleString()}` },
        { label: "Net Inflow to Vault", value: `KES ${netIncome.toLocaleString()}` }
      ],
      confirmButtonText: "Confirm & Post to Ledger",
      onConfirm: async () => {
        setIsSaving(true);
        try {
          const timestampShort = selectedDate;
          const safeMiddayTimestamp = `${selectedDate}T12:00:00.000Z`;

          const createdTxIds: string[] = [];
          const updatedTxsBackup: Array<{ id: string; changes: Partial<Transaction> }> = [];

          // 1. Post new unposted rows
          const createdRowIds = new Map<number, string>();
          for (const row of unpostedRows) {
            const grossAmount = getRowTotal(row);
            const cleanPlate = row.vehiclePlate.trim().toUpperCase();
            const payer = row.memberName?.trim();
            if (grossAmount <= 0 && !cleanPlate && !payer) continue;

            const txDesc = cleanPlate
              ? `${row.vehicleClass} daily collection (${cleanPlate}${payer ? ` - ${payer}` : ""})`
              : `Member contribution (${payer || "Registered Member"})`;
            const refId = cleanPlate ? cleanPlate.replace(/\s+/g, "") : (payer ? payer.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) : "MEM");

            const transaction = await onAddTransaction({
              vehiclePlate: cleanPlate || undefined,
              memberName: payer || undefined,
              memberId: row.memberId || undefined,
              vehicleClass: row.vehicleClass,
              operationAmount: row.operation,
              entranceFee: row.entranceFee,
              loanRepay: row.loanRepay,
              savingsContribution: row.savings,
              sTicket: row.sTicket,
              legalFee: row.legalFee,
              grossAmount,
              description: txDesc,
              refCode: `SWT-DLY-${refId}-${timestampShort.replace(/-/g, "")}-${row.no}`,
              type: "Credit",
              category: "Daily Contribution",
              amount: grossAmount,
              tillNumber: "VehicleTill",
              entryDate: selectedDate,
              timestamp: safeMiddayTimestamp
            } as any);

            createdTxIds.push(transaction.id);
            createdRowIds.set(row.no, transaction.id);
          }

          // 2. Post new unposted expenses
          const createdExpenseIds = new Map<number, string>();
          for (const expense of unpostedExpenses) {
            const transaction = await onAddTransaction({
              description: `${expense.description} (${selectedRoute || "field sheet"} expense)`,
              refCode: `SWT-EXP-${timestampShort.replace(/-/g, "")}-${expense.no}`,
              type: "Debit",
              category: "Petty Cash",
              amount: expense.amount,
              tillNumber: "VehicleTill",
              entryDate: selectedDate,
              timestamp: safeMiddayTimestamp
            } as any);

            createdTxIds.push(transaction.id);
            createdExpenseIds.set(expense.no, transaction.id);
          }

          // 3. Update existing posted rows
          for (const row of updatedRows) {
            if (!row.transactionId) continue;
            const original = transactions.find(t => t.id === row.transactionId);
            if (original) {
              updatedTxsBackup.push({
                id: row.transactionId,
                changes: {
                  vehiclePlate: original.vehiclePlate,
                  vehicleClass: original.vehicleClass,
                  operationAmount: original.operationAmount,
                  entranceFee: original.entranceFee,
                  loanRepay: original.loanRepay,
                  savingsContribution: original.savingsContribution,
                  sTicket: original.sTicket,
                  legalFee: original.legalFee,
                  grossAmount: original.grossAmount,
                  amount: original.amount,
                  description: original.description
                }
              });
            }

            const grossAmount = getRowTotal(row);
            const deduction = Number(original?.expenseDeduction || 0);

            await onUpdateTransaction(row.transactionId, {
              vehiclePlate: row.vehiclePlate.trim().toUpperCase(),
              vehicleClass: row.vehicleClass,
              operationAmount: row.operation,
              entranceFee: row.entranceFee,
              loanRepay: row.loanRepay,
              savingsContribution: row.savings,
              sTicket: row.sTicket,
              legalFee: row.legalFee,
              grossAmount,
              amount: Math.max(0, grossAmount - deduction),
              description: `${row.vehicleClass} daily collection (${selectedRoute || "field sheet"} - row ${row.no})`
            });
          }

          // 4. Update existing posted expenses
          for (const exp of updatedExpenses) {
            if (!exp.transactionId) continue;
            const original = transactions.find(t => t.id === exp.transactionId);
            if (original) {
              updatedTxsBackup.push({
                id: exp.transactionId,
                changes: {
                  description: original.description,
                  amount: original.amount
                }
              });
            }

            await onUpdateTransaction(exp.transactionId, {
              description: `${exp.description} (${selectedRoute || "field sheet"} expense)`,
              amount: Number(exp.amount || 0)
            });
          }

          // Update local state with newly assigned IDs
          setRows(prev => prev.map(r => createdRowIds.has(r.no) ? { ...r, transactionId: createdRowIds.get(r.no) } : r));
          setExpenses(prev => prev.map(e => createdExpenseIds.has(e.no) ? { ...e, transactionId: createdExpenseIds.get(e.no) } : e));
          setIsDirty(false);

          // Configure Undo
          setUndoAction({
            type: "SAVE",
            description: `Saved ${createdTxIds.length} new entries & ${updatedTxsBackup.length} updates for ${selectedDate}`,
            createdTxIds,
            updatedTxsBackup
          });

          setConfirmationConfig(null);
          setSuccessMessage(`All daily collection changes for ${selectedDate} were successfully posted to the ledger!`);
          setTimeout(() => setSuccessMessage(""), 6000);
        } catch (error: any) {
          console.error("Save error:", error);
          setErrorMessage(error?.message || "Could not save entries to the ledger.");
          setTimeout(() => setErrorMessage(""), 6000);
        } finally {
          setIsSaving(false);
        }
      }
    });
  };

  // Undo execution handler
  const handleExecuteUndo = async () => {
    if (!undoAction || isUndoing) return;
    setIsUndoing(true);
    try {
      if (undoAction.type === "SAVE") {
        // Rollback created transactions
        if (undoAction.createdTxIds && onDeleteTransaction) {
          for (const txId of undoAction.createdTxIds) {
            try {
              await onDeleteTransaction(txId);
            } catch (err) {
              console.error("Error rolling back created transaction:", err);
            }
          }
        }
        // Rollback updated transactions
        if (undoAction.updatedTxsBackup) {
          for (const item of undoAction.updatedTxsBackup) {
            try {
              await onUpdateTransaction(item.id, item.changes);
            } catch (err) {
              console.error("Error restoring updated transaction:", err);
            }
          }
        }
        setSuccessMessage("Save action undone! Created transactions were deleted and previous values restored.");
      } else if (undoAction.type === "DELETE") {
        // Restore deleted transaction
        if (undoAction.deletedTx) {
          const restored = await onAddTransaction({
            ...undoAction.deletedTx,
            entryDate: undoAction.deletedTx.entryDate || selectedDate,
            timestamp: undoAction.deletedTx.timestamp
          } as any);

          if (undoAction.deletedRow) {
            setRows(prev => [...prev, { ...undoAction.deletedRow!, transactionId: restored.id }]);
          } else if (undoAction.deletedExpense) {
            setExpenses(prev => [...prev, { ...undoAction.deletedExpense!, transactionId: restored.id }]);
          }
          setSuccessMessage(`Deleted record for ${undoAction.deletedRow?.vehiclePlate || "entry"} was restored to the ledger.`);
        }
      }
      setUndoAction(null);
      loadSheetForDate(selectedDate);
      setTimeout(() => setSuccessMessage(""), 5000);
    } catch (err: any) {
      console.error("Undo error:", err);
      setErrorMessage(err?.message || "Failed to execute undo.");
      setTimeout(() => setErrorMessage(""), 5000);
    } finally {
      setIsUndoing(false);
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

  // Segmenting Nissan vs Sienna (Sienta)
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
          SCREEN-ONLY VIEW (Interactive Form, Query Date Filters, Warnings & Undo)
          ========================================================================= */}
      <div className="flex flex-col space-y-6 print:hidden">

        {/* EXPLANATORY HEADER BANNER */}
        <div className="bg-slate-900 text-white p-5 rounded-2xl border border-slate-950 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0 no-print">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="text-[9px] font-bold uppercase tracking-widest bg-emerald-500 text-slate-950 px-2 py-0.5 rounded font-mono border border-emerald-600">
                FIELD OFFICE LOG DIGITIZATION
              </span>
              <span className="text-[9px] font-bold uppercase tracking-widest bg-indigo-500 text-white px-2 py-0.5 rounded font-mono">
                VERIFIED CONFIRMATION &amp; UNDO
              </span>
            </div>
            <h2 className="text-lg font-bold font-display text-slate-100 mt-1 flex items-center">
              <ClipboardList className="w-5 h-5 text-emerald-400 mr-2" />
              Sowetamu Sacco — Daily Field Collection Sheet
            </h2>
            <p className="text-xs text-slate-400 max-w-2xl leading-normal">
              Query past dates, review previously recorded logs, and record daily collections for <strong className="text-white">Nissan &amp; Sienna</strong> fleets. All database writes require explicit confirmation with instant Undo protection.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {onRefreshData && (
              <button
                onClick={onRefreshData}
                className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs uppercase tracking-wider rounded-xl border border-slate-700 flex items-center space-x-1.5 transition-all cursor-pointer"
                title="Reload latest records from server"
              >
                <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                <span>Sync Server</span>
              </button>
            )}
            <button
              onClick={handleOpenNewPaymentModal}
              className="px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs uppercase tracking-wider rounded-xl border border-emerald-800 flex items-center space-x-2 transition-all shadow-md active:scale-95 cursor-pointer"
              title="Open payment form capturing all table fields to Pay"
            >
              <CreditCard className="w-4 h-4 text-emerald-300" />
              <span>Payment Form (Pay)</span>
            </button>
            <button
              onClick={triggerPrint}
              className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl border border-emerald-600 flex items-center space-x-2 transition-all shadow-md active:scale-95 cursor-pointer"
              title="Print official 3-page register in portrait mode"
            >
              <Printer className="w-4 h-4 text-slate-950" />
              <span>Print Official Register (Portrait)</span>
            </button>
          </div>
        </div>

        {/* UNDO BANNER (IF ACTIVE) */}
        {undoAction && (
          <div className="bg-indigo-950 text-white border-2 border-indigo-400 p-4 rounded-xl flex items-center justify-between gap-4 text-xs shadow-md animate-fade-in no-print">
            <div className="flex items-center space-x-2.5">
              <Clock className="w-5 h-5 text-indigo-300 shrink-0" />
              <div>
                <span className="font-mono text-[10px] uppercase font-black text-indigo-300 tracking-wider block">
                  ACTION COMPLETED &bull; UNDO AVAILABLE
                </span>
                <span className="font-bold text-slate-100">{undoAction.description}</span>
              </div>
            </div>
            <div className="flex items-center space-x-2 shrink-0">
              <button
                onClick={handleExecuteUndo}
                disabled={isUndoing}
                className="px-3.5 py-1.5 bg-indigo-400 hover:bg-indigo-300 text-slate-950 font-black rounded-lg text-xs uppercase tracking-wider flex items-center space-x-1.5 transition-all cursor-pointer shadow-xs disabled:opacity-50"
              >
                <Undo2 className="w-4 h-4" />
                <span>{isUndoing ? "Reversing..." : "Undo This Action"}</span>
              </button>
              <button
                onClick={() => setUndoAction(null)}
                className="text-indigo-300 hover:text-white text-xs px-2 py-1 rounded transition-colors cursor-pointer"
                title="Dismiss undo"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* UNSAVED MODIFICATIONS ALERT */}
        {isDirty && (
          <div className="bg-amber-50 border-2 border-amber-500 text-amber-950 p-3.5 rounded-xl flex items-center justify-between text-xs shadow-xs shrink-0 animate-fade-in no-print">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="font-bold">
                You have unsaved changes on this daily sheet. Click "Save Changes" to commit them to the ledger.
              </span>
            </div>
            <button
              onClick={handleRevertEdits}
              className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-800 hover:text-amber-950 bg-amber-200/60 hover:bg-amber-200 rounded-lg transition-colors cursor-pointer"
            >
              Discard Edits
            </button>
          </div>
        )}

        {/* SYSTEM MESSAGES */}
        {successMessage && (
          <div className="bg-emerald-50 border-2 border-emerald-500 text-emerald-950 p-3.5 rounded-xl flex items-center space-x-2.5 text-xs shadow-sm shrink-0 animate-fade-in no-print">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-bold">{successMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="bg-rose-50 border-2 border-rose-500 text-rose-950 p-3.5 rounded-xl flex items-center space-x-2.5 text-xs shadow-sm shrink-0 animate-fade-in no-print">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-bold">{errorMessage}</span>
          </div>
        )}

        {/* METADATA FILTERS & INSTANT DATE QUERY CONTROLLER */}
        <div className="bg-white border-2 border-slate-900 rounded-2xl p-4 shadow-sm flex flex-col gap-4 no-print shrink-0">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            
            {/* DATE QUERY SECTION */}
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1 font-mono flex items-center">
                  <Calendar className="w-3 h-3 mr-1 text-slate-700" />
                  COLLECTION DATE *
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="date"
                    value={inputDate}
                    onChange={(e) => {
                      const val = e.target.value;
                      setInputDate(val);
                      if (val) {
                        handleQueryDate(val);
                      }
                    }}
                    className="px-3 py-2 border-2 border-slate-900 rounded-xl text-xs font-mono font-bold bg-slate-50 focus:outline-none focus:bg-white w-38"
                  />
                  <button
                    onClick={() => handleQueryDate(inputDate)}
                    className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5 transition-all shadow-sm cursor-pointer"
                    title="Reload all transactions recorded for this date"
                  >
                    <Search className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Query Date</span>
                  </button>
                </div>
              </div>

              {/* QUICK KEY-IN DAY NUMBER (e.g. 9 or 6) */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1 font-mono">
                  OR KEY IN DAY (E.G. 9, 6)
                </label>
                <div className="flex items-center space-x-1.5">
                  <input
                    type="text"
                    placeholder="e.g. 9"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value;
                        if (val) handleQueryDate(val);
                      }
                    }}
                    id="quickDayInput"
                    className="px-3 py-2 border-2 border-slate-900 rounded-xl text-xs font-mono font-bold bg-slate-50 focus:outline-none focus:bg-white w-20 text-center"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.getElementById('quickDayInput') as HTMLInputElement;
                      if (el && el.value) handleQueryDate(el.value);
                    }}
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-sm cursor-pointer"
                    title="Load records for this day number"
                  >
                    Go
                  </button>
                </div>
              </div>

              {/* SELECT FROM SAVED DATES WITH RECORDS */}
              {availableDatesWithRecords.length > 0 && (
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1 font-mono">
                    DATES WITH DATA
                  </label>
                  <select
                    value={availableDatesWithRecords.some(([d]) => d === selectedDate) ? selectedDate : ""}
                    onChange={(e) => {
                      if (e.target.value) handleQueryDate(e.target.value);
                    }}
                    className="px-3 py-2 border-2 border-slate-900 rounded-xl text-xs font-mono font-bold bg-slate-50 focus:outline-none focus:bg-white"
                  >
                    <option value="">-- Choose date with data --</option>
                    {availableDatesWithRecords.map(([d, count]) => (
                      <option key={d} value={d}>
                        {d} ({count} records)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* QUICK DATE PILLS */}
              <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
                <button
                  type="button"
                  onClick={() => {
                    const today = new Date().toISOString().slice(0, 10);
                    handleQueryDate(today);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider font-mono border transition-colors cursor-pointer ${
                    selectedDate === new Date().toISOString().slice(0, 10)
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200"
                  }`}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
                    handleQueryDate(yesterday);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider font-mono border transition-colors cursor-pointer ${
                    selectedDate === new Date(Date.now() - 86400000).toISOString().slice(0, 10)
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200"
                  }`}
                >
                  Yesterday
                </button>
                {availableDatesWithRecords.slice(0, 5).map(([d, count]) => {
                  const isCur = selectedDate === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => handleQueryDate(d)}
                      className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold tracking-wider font-mono border transition-colors cursor-pointer ${
                        isCur
                          ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                          : "bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100"
                      }`}
                      title={`Load records for ${d}`}
                    >
                      {d.slice(5)} ({count})
                    </button>
                  );
                })}
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
                  className="px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold bg-slate-50 focus:outline-none focus:border-slate-900 w-52"
                />
              </div>
            </div>

            {/* ACTION BUTTONS */}
            <div className="flex items-center space-x-2 self-end md:self-auto">
              <button
                onClick={handleResetDefaults}
                disabled={isReadOnly}
                className="px-3.5 py-2 border border-slate-300 hover:border-rose-400 hover:text-rose-700 text-slate-600 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center space-x-1 transition-all cursor-pointer disabled:opacity-50"
                title="Clear sheet for this date"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Clear Sheet</span>
              </button>

              <button
                onClick={handleSaveChangesClick}
                disabled={isReadOnly || isSaving}
                className={`px-4 py-2 text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5 transition-all shadow-md cursor-pointer ${
                  isDirty 
                    ? "bg-emerald-600 hover:bg-emerald-700 animate-pulse" 
                    : "bg-slate-900 hover:bg-slate-800"
                } disabled:opacity-50`}
              >
                <Send className="w-3.5 h-3.5 text-emerald-300" />
                <span>{isSaving ? "Saving..." : "Save Changes"}</span>
              </button>
            </div>
          </div>

          {/* AVAILABLE DATES QUICK SELECTOR BADGES */}
          {availableDatesWithRecords.length > 0 && (
            <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-mono font-bold text-slate-500 uppercase flex items-center">
                <History className="w-3 h-3 mr-1 text-slate-400" />
                Past Dates with Logs:
              </span>
              {availableDatesWithRecords.map(([d, count]) => (
                <button
                  key={d}
                  onClick={() => handleQueryDate(d)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold transition-all cursor-pointer ${
                    d === selectedDate
                      ? "bg-emerald-600 text-white shadow-xs scale-105"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300"
                  }`}
                >
                  {d} <span className="opacity-75">({count})</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* QUERY STATUS HEADER BANNER */}
        <div className="bg-slate-800 text-slate-100 px-4 py-2.5 rounded-xl border border-slate-900 flex flex-wrap items-center justify-between text-xs font-mono shadow-xs">
          <div className="flex items-center space-x-3">
            <span className="text-emerald-400 font-bold uppercase">
              Current Date: <strong className="text-white underline">{selectedDate}</strong>
            </span>
            <span className="text-slate-400">&bull;</span>
            <span className="text-slate-300">
              Loaded: <strong className="text-emerald-300">{nissanRows.length} Nissans</strong>, <strong className="text-sky-300">{sientaRows.length} Siennas</strong>
            </span>
            <span className="text-slate-400">&bull;</span>
            <span className="text-slate-300">
              Gross Total: <strong className="text-emerald-400">KES {totalRevenue.toLocaleString()}</strong>
            </span>
          </div>

          <div className="flex items-center space-x-2">
            {isDirty ? (
              <span className="text-[10px] px-2 py-0.5 bg-amber-500 text-slate-950 font-bold rounded font-mono uppercase">
                Sheet Modified (Unsaved)
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold rounded font-mono uppercase">
                Synced to Ledger
              </span>
            )}
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
                Nissan (14s): {nissanRows.length}
              </span>
              <span className="text-xs font-bold font-mono px-2.5 py-1 bg-sky-100 text-sky-800 rounded-lg">
                Sienna (7s): {sientaRows.length}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto border-2 border-slate-900 rounded-xl mb-4">
            <table className="w-full text-left border-collapse min-w-[850px]">
              <thead className="bg-slate-100 text-[10px] font-black uppercase tracking-wider border-b-2 border-slate-900 text-slate-800 font-mono">
                <tr>
                  <th className="px-3 py-2.5 border-r border-slate-300 w-12 text-center">NO</th>
                  <th className="px-3 py-2.5 border-r border-slate-300 w-44">V.REG / MEMBER</th>
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
                          placeholder={row.memberName ? `No plate (${row.memberName})` : "Plate (Optional)"}
                          className="w-full p-1 border border-transparent hover:border-slate-300 focus:border-slate-900 font-mono font-bold uppercase bg-transparent text-slate-900 text-xs rounded focus:outline-none focus:bg-white"
                        />
                        {row.memberName && (
                          <div className="text-[10px] text-slate-500 font-sans font-medium truncate flex items-center gap-1 mt-0.5">
                            <span className="truncate">👤 {row.memberName}</span>
                            {!row.vehiclePlate && (
                              <span className="rounded bg-emerald-50 text-emerald-700 px-1 font-bold text-[9px] shrink-0">Direct Member</span>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-2 border-r border-slate-200">
                        <select
                          value={row.vehicleClass}
                          disabled={isReadOnly}
                          onChange={(e) => handleVehicleClassChange(row.no, e.target.value as VehicleClass)}
                          className="w-full p-1 border border-transparent hover:border-slate-300 focus:border-slate-900 text-xs font-bold rounded focus:outline-none bg-transparent"
                        >
                          <option value="Nissan">Nissan (14s)</option>
                          <option value="Sienta">Sienna (7s)</option>
                          <option value="Member Contribution">Member Contrib</option>
                        </select>
                      </td>

                      <td className="px-3 py-2 border-r border-slate-200 text-right">
                        <input
                          type="number"
                          value={row.operation || ""}
                          disabled={isReadOnly}
                          onChange={(e) => handleUpdateRowField(row.no, "operation", Number(sanitizeDecimalInput(e.target.value)) || 0)}
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
                          inputMode="decimal"
                          className="w-full p-1 border border-transparent hover:border-slate-300 focus:border-slate-900 font-mono text-right bg-transparent text-rose-800 font-bold text-xs rounded focus:outline-none focus:bg-white"
                        />
                      </td>

                      <td className="px-3 py-2 text-right bg-slate-50 font-mono font-bold text-slate-950">
                        KSH {rowTotal.toLocaleString()}
                      </td>

                      <td className="px-3 py-2 text-center no-print">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenRowPaymentModal(row)}
                            disabled={isReadOnly}
                            className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded font-bold text-[10.5px] uppercase tracking-wider flex items-center space-x-1 transition-all cursor-pointer shadow-2xs"
                            title="Open Payment Form with these table details"
                          >
                            <CreditCard className="w-3 h-3 text-emerald-700" />
                            <span>Pay</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRowClick(row.no)}
                            disabled={isReadOnly}
                            className="text-slate-300 hover:text-rose-600 p-1 rounded transition-colors cursor-pointer"
                            title="Delete this log record"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {rows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="py-8 text-center text-slate-400 font-medium font-mono text-xs">
                      No vehicle logs recorded for {selectedDate}. Click "Add Vehicle Entry" below to record a vehicle for this date.
                    </td>
                  </tr>
                )}
              </tbody>

              <tfoot className="bg-slate-900 text-white font-mono text-[11px] uppercase tracking-wider font-bold border-t-2 border-slate-900">
                <tr>
                  <td colSpan={3} className="px-3 py-3 border-r border-slate-700 text-center text-slate-200">
                    TOTAL SUMS ({rows.length} VEHICLES)
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
                type="button"
                onClick={handleOpenNewPaymentModal}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white border-2 border-emerald-800 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center space-x-1.5 transition-all cursor-pointer shadow-md active:scale-95"
              >
                <CreditCard className="w-4 h-4 text-emerald-300" />
                <span>Payment Form (Pay)</span>
              </button>
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
                        inputMode="decimal"
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-right font-bold text-rose-700 text-xs bg-white focus:outline-none focus:border-slate-900"
                      />
                    </div>
                    {!isReadOnly && (
                      <button
                        onClick={() => handleDeleteExpenseClick(idx)}
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
          EXECUTIVE 3-PAGE PORTRAIT PRINTABLE REGISTER (A4 PORTRAIT ORIENTATION)
          Page 1: Nissan 14-Seaters Register & Nissan Totals
          Page 2: Sienna 7-Seaters Register & Sienna Totals
          Page 3: Fleet Aggregation (Nissan + Sienna), Stage Deductions & Net Inflow
          ========================================================================= */}
      <div className="hidden print:block print-doc text-slate-900 bg-white w-full">

        {/* =====================================================================
            PAGE 1: NISSAN (14-SEATER VEHICLES) DAILY COLLECTION SHEET
            ===================================================================== */}
        <div className="print-page-break p-2">
          {/* SOWETAMU OFFICIAL HEADER */}
          <div className="flex justify-between items-center border-b-2 border-slate-900 pb-2 mb-2">
            <div className="flex items-center space-x-2.5">
              <div className="w-10 h-10 rounded bg-slate-900 text-emerald-400 flex flex-col items-center justify-center font-black font-mono border border-slate-950 shrink-0">
                <span className="text-[10px] leading-tight">SWT</span>
                <span className="text-[6px] text-amber-400 tracking-wider">SACCO</span>
              </div>
              <div>
                <h1 className="text-lg font-black font-display tracking-tight text-slate-950 uppercase leading-none">
                  SOWETAMU TRAVELLERS SACCO SOCIETY LTD
                </h1>
                <p className="text-[9px] text-slate-700 font-bold uppercase tracking-wider font-mono mt-0.5">
                  Co-operative Societies Act Cap 490 &bull; Reg: CS/NO. 22239
                </p>
                <p className="text-[8px] text-slate-500 italic">"We Serve with Courtesy, Discipline &amp; Dignity"</p>
              </div>
            </div>

            <div className="text-right text-[9px] font-mono text-slate-700 space-y-0.5">
              <p className="font-bold text-slate-900">P.O. BOX 1324-00518, NAIROBI</p>
              <p>Email: sowetamusaacco@gmail.com &bull; Tel: 0715 600 000</p>
              <p className="text-slate-500 font-bold">Currency: KENYA SHILLINGS (KES)</p>
            </div>
          </div>

          {/* PAGE 1 METADATA BANNER */}
          <div className="flex justify-between items-center bg-slate-900 text-white px-2.5 py-1 mb-2 rounded font-mono text-[11px] uppercase tracking-wide">
            <span className="font-black text-emerald-400">
              PAGE 1 OF 3 &bull; NISSAN (14-SEATERS) REGISTER
            </span>
            <div className="space-x-3 font-bold text-[10px]">
              <span>STAGE ROUTE: <strong className="text-amber-400">{selectedRoute}</strong></span>
              <span>DATE: <strong className="text-emerald-400">{selectedDate}</strong></span>
            </div>
          </div>

          {/* NISSAN TABLE */}
          <table className="print-table">
            <thead>
              <tr>
                <th style={{ width: "30px", textAlign: "center" }}>NO</th>
                <th style={{ width: "95px" }}>V.REG (PLATE)</th>
                <th style={{ textAlign: "right" }}>OPERATION</th>
                <th style={{ textAlign: "right" }}>ENTRANCE</th>
                <th style={{ textAlign: "right" }}>LOAN REPAY</th>
                <th style={{ textAlign: "right" }}>SAVINGS</th>
                <th style={{ textAlign: "right" }}>S/TICKET</th>
                <th style={{ textAlign: "right" }}>LEGAL FEE</th>
                <th style={{ textAlign: "right", width: "115px" }}>TOTAL (KES)</th>
              </tr>
            </thead>
            <tbody>
              {nissanRows.map((row, idx) => {
                const rTotal = getRowTotal(row);
                return (
                  <tr key={row.no}>
                    <td style={{ textAlign: "center", color: "#64748b" }}>{idx + 1}</td>
                    <td style={{ fontFamily: "monospace", fontWeight: 900, letterSpacing: "0.5px" }}>
                      {row.vehiclePlate || row.memberName || "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>{row.operation > 0 ? row.operation.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.entranceFee > 0 ? row.entranceFee.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.loanRepay > 0 ? row.loanRepay.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.savings > 0 ? row.savings.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.sTicket > 0 ? row.sTicket.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.legalFee > 0 ? row.legalFee.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 900 }}>KES {rTotal.toLocaleString()}</td>
                  </tr>
                );
              })}

              {nissanRows.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: "12px", color: "#64748b" }}>
                    Nil Nissan vehicle collections recorded for this date and route.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} style={{ textAlign: "center" }}>NISSAN TOTALS ({nissanRows.length} VEHICLES)</td>
                <td style={{ textAlign: "right" }}>{nissanOperation > 0 ? nissanOperation.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right" }}>{nissanEntrance > 0 ? nissanEntrance.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right" }}>{nissanLoanRepay > 0 ? nissanLoanRepay.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right" }}>{nissanSavings > 0 ? nissanSavings.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right" }}>{nissanSTicket > 0 ? nissanSTicket.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right" }}>{nissanLegalFee > 0 ? nissanLegalFee.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right", fontSize: "12px" }}>KES {nissanTotal.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>

          {/* PAGE 1 FOOTER: NISSAN FLEET SUMMARY & CASHIER SIGN OFF */}
          <div className="grid grid-cols-2 gap-3 mt-3 font-mono text-[10px]">
            <div className="border border-slate-900 rounded p-2.5 bg-slate-50">
              <p className="font-black text-slate-900 border-b border-slate-300 pb-1 mb-1.5 uppercase text-[10px] flex justify-between">
                <span>Nissan Fleet Collections Summary:</span>
                <span className="text-emerald-700 font-bold">Page 1 Total</span>
              </p>
              <div className="space-y-1 text-[9.5px]">
                <div className="flex justify-between text-slate-700">
                  <span>Total Nissan 14-Seater Vehicles:</span>
                  <span className="font-bold text-slate-900">{nissanRows.length}</span>
                </div>
                <div className="flex justify-between text-slate-700">
                  <span>Total Fleet Operations &amp; S/Ticket:</span>
                  <span className="font-bold text-slate-900">KES {(nissanOperation + nissanSTicket).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-slate-700">
                  <span>Total Members Savings &amp; Loan Repay:</span>
                  <span className="font-bold text-slate-900">KES {(nissanSavings + nissanLoanRepay).toLocaleString()}</span>
                </div>
                <div className="flex justify-between border-t border-slate-900 pt-1 font-black text-slate-950 text-[10.5px]">
                  <span>TOTAL NISSAN REVENUE:</span>
                  <span className="text-emerald-800">KES {nissanTotal.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="border border-slate-900 rounded p-2.5 bg-white flex flex-col justify-between">
              <p className="font-black text-slate-900 border-b border-slate-300 pb-1 uppercase text-[10px]">
                Field Cashier / Clerk Certification:
              </p>
              <div className="space-y-2 text-[10px] pt-1 text-slate-800">
                <div className="flex justify-between items-center">
                  <span>Cashier / Clerk: <strong>{currentUserName || "_______________________"}</strong></span>
                  <span>Sign: ___________</span>
                </div>
                <div className="flex justify-between items-center">
                  <span>Date Certified: <strong>{selectedDate}</strong></span>
                  <span>Time: ___________</span>
                </div>
              </div>
              <p className="text-[8px] text-slate-500 italic text-right mt-1">Certified Page 1 of 3: Nissan register.</p>
            </div>
          </div>
        </div>

        {/* =====================================================================
            PAGE 2: SIENNA (7-SEATER VEHICLES) DAILY COLLECTION SHEET
            ===================================================================== */}
        <div className="print-page-break p-2">
          {/* SOWETAMU OFFICIAL HEADER */}
          <div className="flex justify-between items-center border-b-2 border-slate-900 pb-2 mb-2">
            <div className="flex items-center space-x-2.5">
              <div className="w-10 h-10 rounded bg-slate-900 text-emerald-400 flex flex-col items-center justify-center font-black font-mono border border-slate-950 shrink-0">
                <span className="text-[10px] leading-tight">SWT</span>
                <span className="text-[6px] text-amber-400 tracking-wider">SACCO</span>
              </div>
              <div>
                <h1 className="text-lg font-black font-display tracking-tight text-slate-950 uppercase leading-none">
                  SOWETAMU TRAVELLERS SACCO SOCIETY LTD
                </h1>
                <p className="text-[9px] text-slate-700 font-bold uppercase tracking-wider font-mono mt-0.5">
                  Co-operative Societies Act Cap 490 &bull; Reg: CS/NO. 22239
                </p>
                <p className="text-[8px] text-slate-500 italic">"We Serve with Courtesy, Discipline &amp; Dignity"</p>
              </div>
            </div>

            <div className="text-right text-[9px] font-mono text-slate-700 space-y-0.5">
              <p className="font-bold text-slate-900">P.O. BOX 1324-00518, NAIROBI</p>
              <p>Email: sowetamusaacco@gmail.com &bull; Tel: 0715 600 000</p>
              <p className="text-slate-500 font-bold">Currency: KENYA SHILLINGS (KES)</p>
            </div>
          </div>

          {/* PAGE 2 METADATA BANNER */}
          <div className="flex justify-between items-center bg-slate-900 text-white px-2.5 py-1 mb-2 rounded font-mono text-[11px] uppercase tracking-wide">
            <span className="font-black text-amber-400">
              PAGE 2 OF 3 &bull; SIENNA (7-SEATERS) REGISTER
            </span>
            <div className="space-x-3 font-bold text-[10px]">
              <span>STAGE ROUTE: <strong className="text-amber-400">{selectedRoute}</strong></span>
              <span>DATE: <strong className="text-emerald-400">{selectedDate}</strong></span>
            </div>
          </div>

          {/* SIENNA TABLE */}
          <table className="print-table">
            <thead>
              <tr>
                <th style={{ width: "30px", textAlign: "center" }}>NO</th>
                <th style={{ width: "95px" }}>V.REG (PLATE)</th>
                <th style={{ textAlign: "right" }}>OPERATION</th>
                <th style={{ textAlign: "right" }}>ENTRANCE</th>
                <th style={{ textAlign: "right" }}>LOAN REPAY</th>
                <th style={{ textAlign: "right" }}>SAVINGS</th>
                <th style={{ textAlign: "right" }}>S/TICKET</th>
                <th style={{ textAlign: "right" }}>LEGAL FEE</th>
                <th style={{ textAlign: "right", width: "115px" }}>TOTAL (KES)</th>
              </tr>
            </thead>
            <tbody>
              {sientaRows.map((row, idx) => {
                const rTotal = getRowTotal(row);
                return (
                  <tr key={row.no}>
                    <td style={{ textAlign: "center", color: "#64748b" }}>{idx + 1}</td>
                    <td style={{ fontFamily: "monospace", fontWeight: 900, letterSpacing: "0.5px" }}>
                      {row.vehiclePlate || row.memberName || "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>{row.operation > 0 ? row.operation.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.entranceFee > 0 ? row.entranceFee.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.loanRepay > 0 ? row.loanRepay.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.savings > 0 ? row.savings.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.sTicket > 0 ? row.sTicket.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right" }}>{row.legalFee > 0 ? row.legalFee.toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 900 }}>KES {rTotal.toLocaleString()}</td>
                  </tr>
                );
              })}

              {sientaRows.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: "12px", color: "#64748b" }}>
                    Nil Sienna vehicle collections recorded for this date and route.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} style={{ textAlign: "center" }}>SIENNA TOTALS ({sientaRows.length} VEHICLES)</td>
                <td style={{ textAlign: "right" }}>{sientaOperation > 0 ? sientaOperation.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right" }}>{sientaEntrance > 0 ? sientaEntrance.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right" }}>{sientaLoanRepay > 0 ? sientaLoanRepay.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right" }}>{sientaSavings > 0 ? sientaSavings.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right" }}>{sientaSTicket > 0 ? sientaSTicket.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right" }}>{sientaLegalFee > 0 ? sientaLegalFee.toLocaleString() : "0"}</td>
                <td style={{ textAlign: "right", fontSize: "12px" }}>KES {sientaTotal.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>

          {/* PAGE 2 FOOTER: SIENNA FLEET SUMMARY & MARSHALL SIGN OFF */}
          <div className="grid grid-cols-2 gap-3 mt-3 font-mono text-[10px]">
            <div className="border border-slate-900 rounded p-2.5 bg-slate-50">
              <p className="font-black text-slate-900 border-b border-slate-300 pb-1 mb-1.5 uppercase text-[10px] flex justify-between">
                <span>Sienna Fleet Collections Summary:</span>
                <span className="text-amber-700 font-bold">Page 2 Total</span>
              </p>
              <div className="space-y-1 text-[9.5px]">
                <div className="flex justify-between text-slate-700">
                  <span>Total Sienna 7-Seater Vehicles:</span>
                  <span className="font-bold text-slate-900">{sientaRows.length}</span>
                </div>
                <div className="flex justify-between text-slate-700">
                  <span>Total Fleet Operations &amp; S/Ticket:</span>
                  <span className="font-bold text-slate-900">KES {(sientaOperation + sientaSTicket).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-slate-700">
                  <span>Total Members Savings &amp; Loan Repay:</span>
                  <span className="font-bold text-slate-900">KES {(sientaSavings + sientaLoanRepay).toLocaleString()}</span>
                </div>
                <div className="flex justify-between border-t border-slate-900 pt-1 font-black text-slate-950 text-[10.5px]">
                  <span>TOTAL SIENNA REVENUE:</span>
                  <span className="text-amber-800">KES {sientaTotal.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="border border-slate-900 rounded p-2.5 bg-white flex flex-col justify-between">
              <p className="font-black text-slate-900 border-b border-slate-300 pb-1 uppercase text-[10px]">
                Stage Marshall Certification:
              </p>
              <div className="space-y-2 text-[10px] pt-1 text-slate-800">
                <div className="flex justify-between items-center">
                  <span>Stage Marshall: _______________________</span>
                  <span>Sign: ___________</span>
                </div>
                <div className="flex justify-between items-center">
                  <span>Stage Location: <strong>{selectedRoute}</strong></span>
                  <span>Stamp: ___________</span>
                </div>
              </div>
              <p className="text-[8px] text-slate-500 italic text-right mt-1">Certified Page 2 of 3: Sienna register.</p>
            </div>
          </div>
        </div>

        {/* =====================================================================
            PAGE 3: FLEET AGGREGATION & COMBINED RECONCILIATION SUMMARY
            ===================================================================== */}
        <div className="p-2">
          {/* SOWETAMU OFFICIAL HEADER */}
          <div className="flex justify-between items-center border-b-2 border-slate-900 pb-2 mb-2">
            <div className="flex items-center space-x-2.5">
              <div className="w-10 h-10 rounded bg-slate-900 text-emerald-400 flex flex-col items-center justify-center font-black font-mono border border-slate-950 shrink-0">
                <span className="text-[10px] leading-tight">SWT</span>
                <span className="text-[6px] text-amber-400 tracking-wider">SACCO</span>
              </div>
              <div>
                <h1 className="text-lg font-black font-display tracking-tight text-slate-950 uppercase leading-none">
                  SOWETAMU TRAVELLERS SACCO SOCIETY LTD
                </h1>
                <p className="text-[9px] text-slate-700 font-bold uppercase tracking-wider font-mono mt-0.5">
                  Co-operative Societies Act Cap 490 &bull; Reg: CS/NO. 22239
                </p>
                <p className="text-[8px] text-slate-500 italic">"We Serve with Courtesy, Discipline &amp; Dignity"</p>
              </div>
            </div>

            <div className="text-right text-[9px] font-mono text-slate-700 space-y-0.5">
              <p className="font-bold text-slate-900">P.O. BOX 1324-00518, NAIROBI</p>
              <p>Email: sowetamusaacco@gmail.com &bull; Tel: 0715 600 000</p>
              <p className="text-slate-500 font-bold">Currency: KENYA SHILLINGS (KES)</p>
            </div>
          </div>

          {/* PAGE 3 METADATA BANNER */}
          <div className="flex justify-between items-center bg-slate-900 text-white px-2.5 py-1 mb-2 rounded font-mono text-[11px] uppercase tracking-wide">
            <span className="font-black text-emerald-400">
              PAGE 3 OF 3 &bull; FLEET AGGREGATION &amp; COMBINED FINANCIAL RECONCILIATION
            </span>
            <div className="space-x-3 font-bold text-[10px]">
              <span>STAGE ROUTE: <strong className="text-amber-400">{selectedRoute}</strong></span>
              <span>DATE: <strong className="text-emerald-400">{selectedDate}</strong></span>
            </div>
          </div>

          {/* TABLE 1: FLEET AGGREGATION TABLE (NISSAN + SIENNA) */}
          <div className="mb-3">
            <p className="text-[10px] font-black uppercase text-slate-900 tracking-wider font-mono mb-1">
              1. Fleet Collections Aggregation (Nissan &amp; Sienna Fleet Totals)
            </p>
            <table className="print-table">
              <thead>
                <tr>
                  <th style={{ width: "130px", textAlign: "left" }}>FLEET CATEGORY</th>
                  <th style={{ width: "65px", textAlign: "center" }}>VEHICLES</th>
                  <th style={{ textAlign: "right" }}>OPERATION</th>
                  <th style={{ textAlign: "right" }}>ENTRANCE</th>
                  <th style={{ textAlign: "right" }}>LOAN REPAY</th>
                  <th style={{ textAlign: "right" }}>SAVINGS</th>
                  <th style={{ textAlign: "right" }}>S/TICKET</th>
                  <th style={{ textAlign: "right" }}>LEGAL FEE</th>
                  <th style={{ textAlign: "right", width: "120px" }}>SUB-TOTAL (KES)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ fontWeight: 900 }}>1. Nissan (14-Seaters)</td>
                  <td style={{ textAlign: "center", fontWeight: 700 }}>{nissanRows.length}</td>
                  <td style={{ textAlign: "right" }}>{nissanOperation.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>{nissanEntrance.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>{nissanLoanRepay.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>{nissanSavings.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>{nissanSTicket.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>{nissanLegalFee.toLocaleString()}</td>
                  <td style={{ textAlign: "right", fontWeight: 900 }}>KES {nissanTotal.toLocaleString()}</td>
                </tr>

                <tr>
                  <td style={{ fontWeight: 900 }}>2. Sienna (7-Seaters)</td>
                  <td style={{ textAlign: "center", fontWeight: 700 }}>{sientaRows.length}</td>
                  <td style={{ textAlign: "right" }}>{sientaOperation.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>{sientaEntrance.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>{sientaLoanRepay.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>{sientaSavings.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>{sientaSTicket.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>{sientaLegalFee.toLocaleString()}</td>
                  <td style={{ textAlign: "right", fontWeight: 900 }}>KES {sientaTotal.toLocaleString()}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ textAlign: "left", fontWeight: 900 }}>COMBINED FLEET TOTALS</td>
                  <td style={{ textAlign: "center", fontWeight: 900 }}>{rows.length}</td>
                  <td style={{ textAlign: "right" }}>{totalOperation.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>{totalEntrance.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>{totalLoanRepay.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>{totalSavings.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>{totalSTicket.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>{totalLegalFee.toLocaleString()}</td>
                  <td style={{ textAlign: "right", fontSize: "12px" }}>KES {totalRevenue.toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* TABLE 2: STAGE EXPENSES & RECONCILIATION */}
          <div className="grid grid-cols-2 gap-3 mb-2 font-mono text-[10px]">
            <div className="border border-slate-900 rounded p-2 bg-slate-50">
              <p className="font-black text-slate-900 border-b border-slate-300 pb-1 mb-1 uppercase text-[10px] flex justify-between">
                <span>2. Stage Deductions &amp; Route Expenses:</span>
                <span className="text-slate-500 font-normal">{expenses.length} Entries</span>
              </p>
              {expenses.length > 0 ? (
                <div className="max-h-[130px] overflow-hidden">
                  {expenses.map((e, i) => (
                    <div key={i} className="flex justify-between text-[9.5px] py-0.5 border-b border-slate-200 last:border-0">
                      <span className="text-slate-700 truncate mr-2">{i + 1}. {e.description}</span>
                      <span className="font-bold text-slate-900 shrink-0">KES {Number(e.amount).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[9.5px] text-slate-500 italic py-1">Nil stage expenses recorded for this date.</p>
              )}
              <div className="flex justify-between font-black border-t border-slate-900 pt-1 mt-1 text-[10px] text-slate-950">
                <span>TOTAL STAGE DEDUCTIONS:</span>
                <span className="text-rose-700">KES {totalExpenses.toLocaleString()}</span>
              </div>
            </div>

            {/* GRAND TOTAL AGGREGATION BOX AT THE END OF THE PAGE */}
            <div className="border-2 border-slate-900 rounded p-2.5 bg-slate-50 flex flex-col justify-between">
              <p className="font-black text-slate-900 border-b border-slate-300 pb-1 uppercase text-[10.5px] flex justify-between">
                <span>3. End of Page Aggregation (Nissan + Sienna):</span>
                <span className="text-emerald-700 font-bold">Net Sacco Inflow</span>
              </p>
              <div className="space-y-1.5 text-[10px]">
                <div className="flex justify-between text-slate-700">
                  <span>Gross Nissan Collections (Page 1):</span>
                  <span className="font-bold text-slate-900">KES {nissanTotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-slate-700">
                  <span>Gross Sienna Collections (Page 2):</span>
                  <span className="font-bold text-slate-900">KES {sientaTotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between border-t border-slate-300 pt-1 font-bold text-slate-950">
                  <span>TOTAL GROSS FLEET DEPOSITS:</span>
                  <span className="text-slate-950">KES {totalRevenue.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-rose-700 font-bold">
                  <span>Less Total Stage Deductions:</span>
                  <span>- KES {totalExpenses.toLocaleString()}</span>
                </div>
                <div className="flex justify-between font-black border-t-2 border-slate-900 pt-1.5 text-[11px] bg-emerald-100 text-emerald-950 p-1.5 rounded">
                  <span>NET SACCO INFLOW TO VAULT:</span>
                  <span className="text-emerald-900 font-black">KES {netIncome.toLocaleString()}.00</span>
                </div>
              </div>
            </div>
          </div>

          {/* EXECUTIVE MANAGEMENT & AUDIT SIGN-OFF */}
          <div className="border border-slate-900 rounded p-2.5 bg-white font-mono text-[9.5px]">
            <p className="font-black text-slate-900 border-b border-slate-300 pb-1 mb-2 uppercase text-[10px]">
              Executive Management &amp; Regulatory Audit Certification:
            </p>
            <div className="grid grid-cols-3 gap-4 text-slate-800">
              <div className="space-y-1">
                <p>Treasurer: _______________________</p>
                <p>Sign: ____________ Date: ________</p>
              </div>
              <div className="space-y-1">
                <p>Chairman: _______________________</p>
                <p>Sign: ____________ Date: ________</p>
              </div>
              <div className="space-y-1">
                <p>Official Auditor Seal: <strong>CS/NO. 22239</strong></p>
                <p>Stamp / Verification Date: ________</p>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* COLLECTION PAYMENT MODAL */}
      <CollectionPaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        selectedDate={selectedDate}
        vehicles={vehicles}
        members={members}
        token={authToken}
        initialRow={paymentModalRow}
        onComplete={handlePaymentModalComplete}
      />

      {/* CONFIRMATION / WARNING MODAL */}
      {confirmationConfig && (
        <ActionConfirmationModal
          isOpen={true}
          title={confirmationConfig.title}
          variant={confirmationConfig.variant}
          summaryText={confirmationConfig.summaryText}
          consequenceText={confirmationConfig.consequenceText}
          details={confirmationConfig.details}
          confirmButtonText={confirmationConfig.confirmButtonText}
          onConfirm={confirmationConfig.onConfirm}
          onCancel={() => setConfirmationConfig(null)}
        />
      )}

    </div>
  );
}
