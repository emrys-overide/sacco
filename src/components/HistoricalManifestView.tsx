import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Calendar, 
  ChevronLeft, 
  ChevronRight, 
  Save, 
  Printer, 
  Plus, 
  Trash2, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle2, 
  History, 
  Car, 
  TrendingUp, 
  Receipt, 
  ShieldCheck,
  Search,
  Check
} from 'lucide-react';

interface ManifestEntry {
  id?: string;
  recordDate: string;
  fleet: 'Nissan' | 'Sienta';
  rowNo: number;
  plateNumber: string;
  operation: number;
  entrance: number;
  loanRepay: number;
  savings: number;
  sTicket: number;
  legalFee: number;
  totalAmount: number;
}

interface ExpenseEntry {
  id?: string;
  recordDate: string;
  itemNo: number;
  description: string;
  amount: number;
}

interface DaySummary {
  recordDate: string;
  nissanTotal: number;
  sientaTotal: number;
  grossTotal: number;
  totalExpenses: number;
  netVaultInflow: number;
}

interface HistoricalManifestViewProps {
  token: string;
  currentUserRole: string;
  currentUserName: string;
}

export default function HistoricalManifestView({
  token,
  currentUserRole
}: HistoricalManifestViewProps) {
  // Navigation & Date State
  const [availableDates, setAvailableDates] = useState<DaySummary[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('2025-01-01');
  const [searchDateFilter, setSearchDateFilter] = useState<string>('');
  const [activeFleetTab, setActiveFleetTab] = useState<'both' | 'Nissan' | 'Sienta'>('both');

  // Manifest Data State
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isDirty, setIsDirty] = useState<boolean>(false);

  const [nissanRows, setNissanRows] = useState<ManifestEntry[]>([]);
  const [sientaRows, setSientaRows] = useState<ManifestEntry[]>([]);
  const [expenseRows, setExpenseRows] = useState<ExpenseEntry[]>([]);

  const isOfficer = ['Chairman', 'Treasurer', 'Accountant', 'Secretary'].includes(currentUserRole);

  // 1. Fetch available dates list
  const fetchAvailableDates = useCallback(async () => {
    try {
      const res = await fetch('/api/historical-manifests/dates', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data: DaySummary[] = await res.json();
        setAvailableDates(data);
        if (data.length > 0 && !selectedDate) {
          setSelectedDate(data[0].recordDate);
        }
      }
    } catch (err) {
      console.error('Failed to fetch historical dates:', err);
    }
  }, [token, selectedDate]);

  useEffect(() => {
    fetchAvailableDates();
  }, [fetchAvailableDates]);

  // 2. Fetch specific day manifest data
  const fetchDayData = useCallback(async (date: string) => {
    setIsLoading(true);
    setFeedback(null);
    setIsDirty(false);
    try {
      const res = await fetch(`/api/historical-manifests/day/${date}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setNissanRows(
          (data.nissan || []).map((r: any) => ({
            ...r,
            operation: Number(r.operation || 0),
            entrance: Number(r.entrance || 0),
            loanRepay: Number(r.loanRepay || r.loan_repay || 0),
            savings: Number(r.savings || 0),
            sTicket: Number(r.sTicket || r.s_ticket || 0),
            legalFee: Number(r.legalFee || r.legal_fee || 0),
            totalAmount: Number(r.totalAmount || r.total_amount || 0)
          }))
        );
        setSientaRows(
          (data.sienta || []).map((r: any) => ({
            ...r,
            operation: Number(r.operation || 0),
            entrance: Number(r.entrance || 0),
            loanRepay: Number(r.loanRepay || r.loan_repay || 0),
            savings: Number(r.savings || 0),
            sTicket: Number(r.sTicket || r.s_ticket || 0),
            legalFee: Number(r.legalFee || r.legal_fee || 0),
            totalAmount: Number(r.totalAmount || r.total_amount || 0)
          }))
        );
        setExpenseRows(
          (data.expenses || []).map((e: any) => ({
            ...e,
            amount: Number(e.amount || 0)
          }))
        );
      } else {
        setFeedback({ type: 'error', message: `Could not load historical records for ${date}.` });
      }
    } catch (err) {
      setFeedback({ type: 'error', message: 'Network error connecting to archive.' });
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (selectedDate) {
      fetchDayData(selectedDate);
    }
  }, [selectedDate, fetchDayData]);

  // Dynamic live aggregations calculated on frontend
  const computedNissanTotal = useMemo(() => {
    return nissanRows.reduce((sum, r) => sum + (r.operation + r.entrance + r.loanRepay + r.savings + r.sTicket + r.legalFee), 0);
  }, [nissanRows]);

  const computedSientaTotal = useMemo(() => {
    return sientaRows.reduce((sum, r) => sum + (r.operation + r.entrance + r.loanRepay + r.savings + r.sTicket + r.legalFee), 0);
  }, [sientaRows]);

  const computedGrossTotal = useMemo(() => {
    return computedNissanTotal + computedSientaTotal;
  }, [computedNissanTotal, computedSientaTotal]);

  const computedExpensesTotal = useMemo(() => {
    return expenseRows.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  }, [expenseRows]);

  const computedNetVaultInflow = useMemo(() => {
    return computedGrossTotal - computedExpensesTotal;
  }, [computedGrossTotal, computedExpensesTotal]);

  // Navigate to previous/next dates
  const currentIndex = availableDates.findIndex(d => d.recordDate === selectedDate);
  const handlePrevDay = () => {
    if (currentIndex > 0) {
      setSelectedDate(availableDates[currentIndex - 1].recordDate);
    }
  };
  const handleNextDay = () => {
    if (currentIndex >= 0 && currentIndex < availableDates.length - 1) {
      setSelectedDate(availableDates[currentIndex + 1].recordDate);
    }
  };

  // Cell editing handlers
  const handleNissanChange = (index: number, field: keyof ManifestEntry, value: string | number) => {
    setIsDirty(true);
    setNissanRows(prev => {
      const copy = [...prev];
      const row = { ...copy[index], [field]: value };
      if (field !== 'plateNumber' && field !== 'fleet') {
        const numVal = Math.max(0, Number(value) || 0);
        row[field] = numVal as never;
        row.totalAmount = (row.operation || 0) + (row.entrance || 0) + (row.loanRepay || 0) + (row.savings || 0) + (row.sTicket || 0) + (row.legalFee || 0);
      }
      copy[index] = row;
      return copy;
    });
  };

  const handleSientaChange = (index: number, field: keyof ManifestEntry, value: string | number) => {
    setIsDirty(true);
    setSientaRows(prev => {
      const copy = [...prev];
      const row = { ...copy[index], [field]: value };
      if (field !== 'plateNumber' && field !== 'fleet') {
        const numVal = Math.max(0, Number(value) || 0);
        row[field] = numVal as never;
        row.totalAmount = (row.operation || 0) + (row.entrance || 0) + (row.loanRepay || 0) + (row.savings || 0) + (row.sTicket || 0) + (row.legalFee || 0);
      }
      copy[index] = row;
      return copy;
    });
  };

  const handleExpenseChange = (index: number, field: keyof ExpenseEntry, value: string | number) => {
    setIsDirty(true);
    setExpenseRows(prev => {
      const copy = [...prev];
      const row = { ...copy[index], [field]: value };
      if (field === 'amount') {
        row.amount = Math.max(0, Number(value) || 0);
      }
      copy[index] = row;
      return copy;
    });
  };

  // Add / Delete rows
  const handleAddNissanRow = () => {
    setIsDirty(true);
    setNissanRows(prev => [
      ...prev,
      {
        recordDate: selectedDate,
        fleet: 'Nissan',
        rowNo: prev.length + 1,
        plateNumber: '',
        operation: 0,
        entrance: 0,
        loanRepay: 0,
        savings: 0,
        sTicket: 0,
        legalFee: 0,
        totalAmount: 0
      }
    ]);
  };

  const handleDeleteNissanRow = (index: number) => {
    setIsDirty(true);
    setNissanRows(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddSientaRow = () => {
    setIsDirty(true);
    setSientaRows(prev => [
      ...prev,
      {
        recordDate: selectedDate,
        fleet: 'Sienta',
        rowNo: prev.length + 1,
        plateNumber: '',
        operation: 0,
        entrance: 0,
        loanRepay: 0,
        savings: 0,
        sTicket: 0,
        legalFee: 0,
        totalAmount: 0
      }
    ]);
  };

  const handleDeleteSientaRow = (index: number) => {
    setIsDirty(true);
    setSientaRows(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddExpenseRow = () => {
    setIsDirty(true);
    setExpenseRows(prev => [
      ...prev,
      {
        recordDate: selectedDate,
        itemNo: prev.length + 1,
        description: '',
        amount: 0
      }
    ]);
  };

  const handleDeleteExpenseRow = (index: number) => {
    setIsDirty(true);
    setExpenseRows(prev => prev.filter((_, i) => i !== index));
  };

  // Save changes to backend
  const handleSave = async () => {
    setIsSaving(true);
    setFeedback(null);
    try {
      const payload = {
        nissan: nissanRows,
        sienta: sientaRows,
        expenses: expenseRows
      };
      const res = await fetch(`/api/historical-manifests/day/${selectedDate}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setIsDirty(false);
        setFeedback({ type: 'success', message: `Historical manifest for ${selectedDate} saved successfully.` });
        await fetchAvailableDates();
      } else {
        const data = await res.json().catch(() => ({}));
        setFeedback({ type: 'error', message: data.error || 'Failed to save manifest.' });
      }
    } catch (err) {
      setFeedback({ type: 'error', message: 'Network error saving changes.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const filteredDates = useMemo(() => {
    if (!searchDateFilter) return availableDates;
    return availableDates.filter(d => d.recordDate.includes(searchDateFilter));
  }, [availableDates, searchDateFilter]);

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50/70 overflow-y-auto">
      {/* Top Banner & Title */}
      <div className="bg-white border-b border-slate-200 px-6 py-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold">
                <History className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-slate-900 tracking-tight">Historical Manifest Archives</h1>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                    <ShieldCheck className="w-3.5 h-3.5" /> 100% Isolated 2025 Ledger
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Daily vehicle collections, breakdowns, and expenses. Zero interaction with active dashboard totals or member balances.
                </p>
              </div>
            </div>
          </div>

          {/* Quick Date Control */}
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={handlePrevDay}
                disabled={currentIndex <= 0}
                className="p-1.5 rounded-lg hover:bg-white text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                title="Previous Day"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-1.5 px-2">
                <Calendar className="w-4 h-4 text-slate-500" />
                <input
                  type="date"
                  min="2025-01-01"
                  max="2025-12-31"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-transparent text-sm font-semibold text-slate-800 focus:outline-hidden cursor-pointer"
                />
              </div>

              <button
                type="button"
                onClick={handleNextDay}
                disabled={currentIndex >= availableDates.length - 1}
                className="p-1.5 rounded-lg hover:bg-white text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                title="Next Day"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Quick jump dropdown */}
            <div className="relative">
              <select
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="text-xs font-medium bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-700 shadow-2xs hover:border-slate-400 focus:outline-hidden"
              >
                {filteredDates.map(d => (
                  <option key={d.recordDate} value={d.recordDate}>
                    {d.recordDate} (Net: KES {Number(d.netVaultInflow).toLocaleString()})
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => fetchDayData(selectedDate)}
              disabled={isLoading}
              className="p-2 bg-white border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-50 shadow-2xs transition-all"
              title="Refresh Day"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-blue-600' : ''}`} />
            </button>
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div className={`mt-3 px-4 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between ${
            feedback.type === 'success' 
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}>
            <div className="flex items-center gap-2">
              {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-rose-600" />}
              <span>{feedback.message}</span>
            </div>
            <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-slate-600 font-bold ml-2">×</button>
          </div>
        )}
      </div>

      <div className="p-6 space-y-6 max-w-7xl w-full mx-auto">
        {/* Dynamic Aggregations Bar */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
              <Car className="w-3.5 h-3.5 text-blue-500" /> Nissan (14s)
            </div>
            <div className="text-lg font-bold text-slate-900 mt-1 font-mono">
              KES {computedNissanTotal.toLocaleString()}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">{nissanRows.length} vehicles recorded</div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
              <Car className="w-3.5 h-3.5 text-indigo-500" /> Sienta (7s)
            </div>
            <div className="text-lg font-bold text-slate-900 mt-1 font-mono">
              KES {computedSientaTotal.toLocaleString()}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">{sientaRows.length} vehicles recorded</div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-500" /> Gross Total
            </div>
            <div className="text-lg font-bold text-emerald-700 mt-1 font-mono">
              KES {computedGrossTotal.toLocaleString()}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">{nissanRows.length + sientaRows.length} total entries</div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
              <Receipt className="w-3.5 h-3.5 text-amber-500" /> Expenses
            </div>
            <div className="text-lg font-bold text-amber-700 mt-1 font-mono">
              KES {computedExpensesTotal.toLocaleString()}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">{expenseRows.length} line items</div>
          </div>

          <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-4 rounded-2xl shadow-sm text-white col-span-2 md:col-span-1">
            <div className="text-[11px] font-semibold tracking-wider text-blue-100 uppercase">Net Vault Inflow</div>
            <div className="text-xl font-bold mt-1 font-mono">
              KES {computedNetVaultInflow.toLocaleString()}
            </div>
            <div className="text-[11px] text-blue-100/80 mt-0.5">Gross - Expenses</div>
          </div>
        </div>

        {/* View & Action Toolbar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-600 ml-1">Fleet Filter:</span>
            <div className="flex bg-slate-100 p-0.5 rounded-xl text-xs font-medium">
              <button
                type="button"
                onClick={() => setActiveFleetTab('both')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeFleetTab === 'both' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All Fleets ({nissanRows.length + sientaRows.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveFleetTab('Nissan')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeFleetTab === 'Nissan' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Nissan Only ({nissanRows.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveFleetTab('Sienta')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeFleetTab === 'Sienta' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Sienta Only ({sientaRows.length})
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {isDirty && (
              <span className="text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg animate-pulse">
                Unsaved Edits
              </span>
            )}

            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all"
            >
              <Printer className="w-3.5 h-3.5" /> Print Manifest
            </button>

            {isOfficer && (
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-50 rounded-xl shadow-xs transition-all"
              >
                <Save className="w-3.5 h-3.5" />
                {isSaving ? 'Saving Changes...' : 'Save Changes'}
              </button>
            )}
          </div>
        </div>

        {/* NISSAN FLEET TABLE */}
        {(activeFleetTab === 'both' || activeFleetTab === 'Nissan') && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600"></span>
                <h3 className="text-sm font-bold text-slate-800">Nissan Fleet Daily Collection Sheet</h3>
                <span className="text-xs text-slate-400 font-mono">({nissanRows.length} vehicles)</span>
              </div>
              {isOfficer && (
                <button
                  type="button"
                  onClick={handleAddNissanRow}
                  className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2.5 py-1 rounded-lg transition-all"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Nissan Entry
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100/70 text-slate-600 font-semibold border-b border-slate-200">
                    <th className="py-2.5 px-3 w-12 text-center">#</th>
                    <th className="py-2.5 px-3 w-32">Plate Number</th>
                    <th className="py-2.5 px-3 w-24 text-right">Operation</th>
                    <th className="py-2.5 px-3 w-24 text-right">Entrance</th>
                    <th className="py-2.5 px-3 w-24 text-right">Loan Repay</th>
                    <th className="py-2.5 px-3 w-24 text-right">Savings</th>
                    <th className="py-2.5 px-3 w-24 text-right">S-Ticket</th>
                    <th className="py-2.5 px-3 w-24 text-right">Legal Fee</th>
                    <th className="py-2.5 px-3 w-28 text-right font-bold text-slate-800">Total (KES)</th>
                    {isOfficer && <th className="py-2.5 px-2 w-10 text-center"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {nissanRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-6 text-center text-slate-400 font-sans">
                        No Nissan entries recorded for this date.
                      </td>
                    </tr>
                  ) : (
                    nissanRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2 px-3 text-center text-slate-400 font-sans">{idx + 1}</td>
                        <td className="py-1 px-2 font-sans">
                          {isOfficer ? (
                            <input
                              type="text"
                              value={row.plateNumber}
                              onChange={(e) => handleNissanChange(idx, 'plateNumber', e.target.value.toUpperCase())}
                              className="w-full uppercase font-bold text-slate-800 bg-transparent px-2 py-1 rounded border border-transparent hover:border-slate-300 focus:border-blue-500 focus:bg-white focus:outline-hidden"
                              placeholder="KXX 000X"
                            />
                          ) : (
                            <span className="font-bold text-slate-800 px-2 py-1">{row.plateNumber}</span>
                          )}
                        </td>
                        {(['operation', 'entrance', 'loanRepay', 'savings', 'sTicket', 'legalFee'] as const).map((field) => (
                          <td key={field} className="py-1 px-2 text-right">
                            {isOfficer ? (
                              <input
                                type="number"
                                min="0"
                                step="10"
                                value={row[field] || 0}
                                onChange={(e) => handleNissanChange(idx, field, e.target.value)}
                                className="w-full text-right text-slate-700 bg-transparent px-2 py-1 rounded border border-transparent hover:border-slate-300 focus:border-blue-500 focus:bg-white focus:outline-hidden font-mono"
                              />
                            ) : (
                              <span className="px-2 py-1 text-slate-700">{(row[field] || 0).toLocaleString()}</span>
                            )}
                          </td>
                        ))}
                        <td className="py-2 px-3 text-right font-bold text-slate-900">
                          {((row.operation || 0) + (row.entrance || 0) + (row.loanRepay || 0) + (row.savings || 0) + (row.sTicket || 0) + (row.legalFee || 0)).toLocaleString()}
                        </td>
                        {isOfficer && (
                          <td className="py-1 px-2 text-center font-sans">
                            <button
                              type="button"
                              onClick={() => handleDeleteNissanRow(idx)}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded transition-all"
                              title="Delete Row"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold text-slate-800 border-t-2 border-slate-200 font-mono">
                    <td colSpan={2} className="py-2.5 px-3 text-right font-sans text-xs">Nissan Subtotal:</td>
                    <td className="py-2.5 px-3 text-right">{nissanRows.reduce((s, r) => s + (r.operation || 0), 0).toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right">{nissanRows.reduce((s, r) => s + (r.entrance || 0), 0).toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right">{nissanRows.reduce((s, r) => s + (r.loanRepay || 0), 0).toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right">{nissanRows.reduce((s, r) => s + (r.savings || 0), 0).toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right">{nissanRows.reduce((s, r) => s + (r.sTicket || 0), 0).toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right">{nissanRows.reduce((s, r) => s + (r.legalFee || 0), 0).toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right text-blue-700 text-sm">KES {computedNissanTotal.toLocaleString()}</td>
                    {isOfficer && <td></td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* SIENTA FLEET TABLE */}
        {(activeFleetTab === 'both' || activeFleetTab === 'Sienta') && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-600"></span>
                <h3 className="text-sm font-bold text-slate-800">Sienta Fleet Daily Collection Sheet</h3>
                <span className="text-xs text-slate-400 font-mono">({sientaRows.length} vehicles)</span>
              </div>
              {isOfficer && (
                <button
                  type="button"
                  onClick={handleAddSientaRow}
                  className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 px-2.5 py-1 rounded-lg transition-all"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Sienta Entry
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100/70 text-slate-600 font-semibold border-b border-slate-200">
                    <th className="py-2.5 px-3 w-12 text-center">#</th>
                    <th className="py-2.5 px-3 w-32">Plate Number</th>
                    <th className="py-2.5 px-3 w-24 text-right">Operation</th>
                    <th className="py-2.5 px-3 w-24 text-right">Entrance</th>
                    <th className="py-2.5 px-3 w-24 text-right">Loan Repay</th>
                    <th className="py-2.5 px-3 w-24 text-right">Savings</th>
                    <th className="py-2.5 px-3 w-24 text-right">S-Ticket</th>
                    <th className="py-2.5 px-3 w-24 text-right">Legal Fee</th>
                    <th className="py-2.5 px-3 w-28 text-right font-bold text-slate-800">Total (KES)</th>
                    {isOfficer && <th className="py-2.5 px-2 w-10 text-center"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {sientaRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-6 text-center text-slate-400 font-sans">
                        No Sienta entries recorded for this date.
                      </td>
                    </tr>
                  ) : (
                    sientaRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2 px-3 text-center text-slate-400 font-sans">{idx + 1}</td>
                        <td className="py-1 px-2 font-sans">
                          {isOfficer ? (
                            <input
                              type="text"
                              value={row.plateNumber}
                              onChange={(e) => handleSientaChange(idx, 'plateNumber', e.target.value.toUpperCase())}
                              className="w-full uppercase font-bold text-slate-800 bg-transparent px-2 py-1 rounded border border-transparent hover:border-slate-300 focus:border-indigo-500 focus:bg-white focus:outline-hidden"
                              placeholder="KXX 000X"
                            />
                          ) : (
                            <span className="font-bold text-slate-800 px-2 py-1">{row.plateNumber}</span>
                          )}
                        </td>
                        {(['operation', 'entrance', 'loanRepay', 'savings', 'sTicket', 'legalFee'] as const).map((field) => (
                          <td key={field} className="py-1 px-2 text-right">
                            {isOfficer ? (
                              <input
                                type="number"
                                min="0"
                                step="10"
                                value={row[field] || 0}
                                onChange={(e) => handleSientaChange(idx, field, e.target.value)}
                                className="w-full text-right text-slate-700 bg-transparent px-2 py-1 rounded border border-transparent hover:border-slate-300 focus:border-indigo-500 focus:bg-white focus:outline-hidden font-mono"
                              />
                            ) : (
                              <span className="px-2 py-1 text-slate-700">{(row[field] || 0).toLocaleString()}</span>
                            )}
                          </td>
                        ))}
                        <td className="py-2 px-3 text-right font-bold text-slate-900">
                          {((row.operation || 0) + (row.entrance || 0) + (row.loanRepay || 0) + (row.savings || 0) + (row.sTicket || 0) + (row.legalFee || 0)).toLocaleString()}
                        </td>
                        {isOfficer && (
                          <td className="py-1 px-2 text-center font-sans">
                            <button
                              type="button"
                              onClick={() => handleDeleteSientaRow(idx)}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded transition-all"
                              title="Delete Row"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold text-slate-800 border-t-2 border-slate-200 font-mono">
                    <td colSpan={2} className="py-2.5 px-3 text-right font-sans text-xs">Sienta Subtotal:</td>
                    <td className="py-2.5 px-3 text-right">{sientaRows.reduce((s, r) => s + (r.operation || 0), 0).toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right">{sientaRows.reduce((s, r) => s + (r.entrance || 0), 0).toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right">{sientaRows.reduce((s, r) => s + (r.loanRepay || 0), 0).toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right">{sientaRows.reduce((s, r) => s + (r.savings || 0), 0).toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right">{sientaRows.reduce((s, r) => s + (r.sTicket || 0), 0).toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right">{sientaRows.reduce((s, r) => s + (r.legalFee || 0), 0).toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right text-indigo-700 text-sm">KES {computedSientaTotal.toLocaleString()}</td>
                    {isOfficer && <td></td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* EXPENSES REGISTER TABLE */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
              <h3 className="text-sm font-bold text-slate-800">Daily Vault Expenses Register</h3>
              <span className="text-xs text-slate-400 font-mono">({expenseRows.length} items)</span>
            </div>
            {isOfficer && (
              <button
                type="button"
                onClick={handleAddExpenseRow}
                className="flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-700 hover:bg-amber-50 px-2.5 py-1 rounded-lg transition-all"
              >
                <Plus className="w-3.5 h-3.5" /> Add Expense Item
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/70 text-slate-600 font-semibold border-b border-slate-200">
                  <th className="py-2.5 px-3 w-14 text-center">#</th>
                  <th className="py-2.5 px-3">Expense Item Description</th>
                  <th className="py-2.5 px-3 w-40 text-right">Amount (KES)</th>
                  {isOfficer && <th className="py-2.5 px-2 w-10 text-center"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expenseRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-400 font-sans">
                      No expenses logged for this date.
                    </td>
                  </tr>
                ) : (
                  expenseRows.map((exp, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2 px-3 text-center text-slate-400 font-mono">{idx + 1}</td>
                      <td className="py-1 px-2">
                        {isOfficer ? (
                          <input
                            type="text"
                            value={exp.description}
                            onChange={(e) => handleExpenseChange(idx, 'description', e.target.value)}
                            className="w-full text-slate-800 bg-transparent px-2 py-1 rounded border border-transparent hover:border-slate-300 focus:border-amber-500 focus:bg-white focus:outline-hidden"
                            placeholder="e.g. Fuel, Allowance, Office Supplies"
                          />
                        ) : (
                          <span className="text-slate-800 px-2 py-1 font-medium">{exp.description}</span>
                        )}
                      </td>
                      <td className="py-1 px-2 text-right font-mono">
                        {isOfficer ? (
                          <input
                            type="number"
                            min="0"
                            step="10"
                            value={exp.amount || 0}
                            onChange={(e) => handleExpenseChange(idx, 'amount', e.target.value)}
                            className="w-full text-right text-slate-700 bg-transparent px-2 py-1 rounded border border-transparent hover:border-slate-300 focus:border-amber-500 focus:bg-white focus:outline-hidden font-mono"
                          />
                        ) : (
                          <span className="px-2 py-1 text-slate-700">{(exp.amount || 0).toLocaleString()}</span>
                        )}
                      </td>
                      {isOfficer && (
                        <td className="py-1 px-2 text-center font-sans">
                          <button
                            type="button"
                            onClick={() => handleDeleteExpenseRow(idx)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded transition-all"
                            title="Delete Expense"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-bold text-slate-800 border-t-2 border-slate-200 font-mono">
                  <td colSpan={2} className="py-2.5 px-3 text-right font-sans text-xs">Total Daily Expenses:</td>
                  <td className="py-2.5 px-3 text-right text-amber-700 text-sm">KES {computedExpensesTotal.toLocaleString()}</td>
                  {isOfficer && <td></td>}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
