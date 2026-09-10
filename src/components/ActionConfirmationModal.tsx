import React from "react";
import { AlertTriangle, ShieldAlert, CheckCircle2, X } from "lucide-react";

export interface ActionConfirmationModalProps {
  isOpen: boolean;
  title: string;
  variant?: "warning" | "danger" | "info";
  summaryText: string;
  consequenceText?: string;
  details?: Array<{ label: string; value: string | number | React.ReactNode }>;
  confirmButtonText?: string;
  cancelButtonText?: string;
  isLoading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export default function ActionConfirmationModal({
  isOpen,
  title,
  variant = "warning",
  summaryText,
  consequenceText,
  details = [],
  confirmButtonText = "Confirm & Proceed",
  cancelButtonText = "Cancel",
  isLoading = false,
  onConfirm,
  onCancel
}: ActionConfirmationModalProps) {
  if (!isOpen) return null;

  const isDanger = variant === "danger";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fade-in no-print"
      role="dialog"
      aria-modal="true"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !isLoading) onCancel();
      }}
    >
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border-2 border-slate-900 overflow-hidden flex flex-col">
        
        {/* MODAL HEADER */}
        <div className={`px-6 py-4 flex items-center justify-between border-b ${
          isDanger ? "bg-rose-50 border-rose-200" : "bg-amber-50 border-amber-200"
        }`}>
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-xl border ${
              isDanger 
                ? "bg-rose-100 text-rose-700 border-rose-300" 
                : "bg-amber-100 text-amber-700 border-amber-300"
            }`}>
              {isDanger ? (
                <AlertTriangle className="w-5 h-5 shrink-0" />
              ) : (
                <ShieldAlert className="w-5 h-5 shrink-0" />
              )}
            </div>
            <div>
              <span className={`text-[10px] font-mono font-black uppercase tracking-wider ${
                isDanger ? "text-rose-700" : "text-amber-700"
              }`}>
                {isDanger ? "DESTRUCTIVE DATABASE ACTION" : "CONFIRMATION REQUIRED"}
              </span>
              <h3 className="text-base font-black font-display text-slate-900 tracking-tight leading-tight">
                {title}
              </h3>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50 cursor-pointer"
            title="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* MODAL BODY */}
        <div className="p-6 space-y-4">
          <p className="text-xs text-slate-700 font-medium leading-relaxed">
            {summaryText}
          </p>

          {/* DETAILED STATS TABLE (IF PROVIDED) */}
          {details.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 font-mono text-xs space-y-1.5">
              {details.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center py-1 border-b border-slate-200 last:border-0">
                  <span className="text-slate-500 uppercase text-[10px] font-bold">{item.label}</span>
                  <span className="font-bold text-slate-900">{item.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* EXPLANATORY CONSEQUENCE WARNING */}
          {consequenceText && (
            <div className={`p-3 rounded-xl border text-xs leading-normal flex items-start space-x-2.5 ${
              isDanger 
                ? "bg-rose-50/70 border-rose-200 text-rose-900" 
                : "bg-slate-100 border-slate-200 text-slate-700"
            }`}>
              <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${
                isDanger ? "text-rose-600" : "text-amber-600"
              }`} />
              <div>
                <p className="font-bold text-[11px] uppercase tracking-wide mb-0.5">
                  {isDanger ? "Database Impact Warning:" : "Notice of Ledger Effect:"}
                </p>
                <p className="text-[11px] opacity-90">{consequenceText}</p>
              </div>
            </div>
          )}
        </div>

        {/* MODAL ACTIONS */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end space-x-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 border border-slate-300 hover:border-slate-400 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer"
          >
            {cancelButtonText}
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`px-5 py-2 text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center space-x-2 shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer ${
              isDanger 
                ? "bg-rose-600 hover:bg-rose-700" 
                : "bg-slate-900 hover:bg-slate-800"
            }`}
          >
            {isLoading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                <span>Processing...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>{confirmButtonText}</span>
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
