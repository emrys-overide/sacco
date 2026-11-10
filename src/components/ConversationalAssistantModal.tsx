import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  X,
  Send,
  PhoneCall,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  RefreshCw
} from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

interface Proposal {
  transactionType: 'SAVINGS' | 'LOAN_REPAYMENT';
  accountReference: string;
  amount: number;
  phoneNumber: string;
  recipientShortcode: string;
}

interface ConversationalResponse {
  reply: string;
  stage: 'INQUIRY' | 'COLLECTING_DETAILS' | 'AWAITING_CONFIRMATION' | 'TRIGGER_STK';
  proposal?: Proposal;
}

interface StkStatus {
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'RESOLVED_RECONCILED' | 'EXPIRED_UNPAID';
  mpesaReceiptNumber?: string;
  resultDescription?: string;
}

interface ConversationalAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  token?: string | null;
  onPaymentCompleted?: () => void;
}

export const ConversationalAssistantModal: React.FC<ConversationalAssistantModalProps> = ({
  isOpen,
  onClose,
  token,
  onPaymentCompleted
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentProposal, setCurrentProposal] = useState<Proposal | null>(null);
  const [activeCheckoutId, setActiveCheckoutId] = useState<string | null>(null);
  const [stkStatus, setStkStatus] = useState<StkStatus | null>(null);
  const [isTriggeringStk, setIsTriggeringStk] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initial welcome message
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([
        {
          role: 'model',
          content:
            'Hello! I am your Sowetamu SACCO Collections Assistant. Would you like to contribute to your Savings or make a payment toward an existing Loan today?'
        }
      ]);
    }
  }, [isOpen, messages.length]);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentProposal, stkStatus]);

  // Polling STK transaction status when activeCheckoutId is present
  useEffect(() => {
    if (!activeCheckoutId || stkStatus?.status === 'SUCCESS' || stkStatus?.status === 'FAILED') {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`/api/v1/mpesa/transactions/${activeCheckoutId}`, { headers });
        if (res.ok) {
          const data = await res.json();
          if (data.transaction) {
            setStkStatus({
              status: data.transaction.status,
              mpesaReceiptNumber: data.transaction.mpesaReceiptNumber,
              resultDescription: data.transaction.resultDescription
            });

            if (data.transaction.status === 'SUCCESS') {
              clearInterval(interval);
              if (onPaymentCompleted) onPaymentCompleted();
            } else if (data.transaction.status === 'FAILED' || data.transaction.status === 'EXPIRED_UNPAID') {
              clearInterval(interval);
            }
          }
        }
      } catch (err) {
        console.error('Error polling STK status:', err);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [activeCheckoutId, stkStatus, token, onPaymentCompleted]);

  if (!isOpen) return null;

  const sendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text || isLoading) return;

    const newHistory: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(newHistory);
    setInputText('');
    setIsLoading(true);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/v1/mpesa/conversational-assistant', {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: text, history: newHistory })
      });

      if (!res.ok) {
        throw new Error('Failed to reach assistant');
      }

      const data: ConversationalResponse = await res.json();
      setMessages(prev => [...prev, { role: 'model', content: data.reply }]);

      if (data.proposal) {
        setCurrentProposal(data.proposal);
      }

      if (data.stage === 'TRIGGER_STK' && data.proposal) {
        await executeStkPush(data.proposal);
      }
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          role: 'model',
          content: 'I encountered an issue processing your request. Please try again or type your desired amount.'
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const executeStkPush = async (proposal: Proposal) => {
    setIsTriggeringStk(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/v1/mpesa/stk-push', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          transactionType: proposal.transactionType,
          accountReference: proposal.accountReference,
          amount: proposal.amount,
          phoneNumber: proposal.phoneNumber
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to initiate STK push');
      }

      setActiveCheckoutId(data.checkoutRequestId);
      setStkStatus({ status: 'PENDING' });
    } catch (err: any) {
      alert(`Could not trigger M-Pesa STK prompt: ${err.message}`);
    } finally {
      setIsTriggeringStk(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm animate-fade-in">
      <div className="flex h-[90vh] max-h-[700px] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-emerald-900/10 bg-gradient-to-r from-emerald-800 to-teal-900 px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 backdrop-blur-md">
              <Sparkles className="h-5 w-5 text-emerald-300" />
            </div>
            <div>
              <h3 className="font-bold text-base leading-tight">SACCO Collections Assistant</h3>
              <p className="text-xs text-emerald-200/80">Daraja M-Pesa Express & Aggregation</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-emerald-100 hover:bg-white/10 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Chat Stream */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-line shadow-sm ${
                  msg.role === 'user'
                    ? 'bg-emerald-700 text-white rounded-tr-none'
                    : 'bg-white text-slate-800 border border-slate-200/80 rounded-tl-none'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {/* Aggregated Proposal Card */}
          {currentProposal && !activeCheckoutId && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm animate-fade-in">
              <div className="flex items-center justify-between pb-2 border-b border-emerald-200/60">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" /> Aggregated Breakdown
                </span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                  {currentProposal.transactionType === 'SAVINGS' ? 'Savings Deposit' : 'Loan Repayment'}
                </span>
              </div>
              <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>Reference ID:</span>
                  <span className="font-semibold text-slate-900">{currentProposal.accountReference}</span>
                </div>
                <div className="flex justify-between">
                  <span>Recipient Shortcode:</span>
                  <span className="font-mono font-semibold text-slate-900">{currentProposal.recipientShortcode}</span>
                </div>
                <div className="flex justify-between">
                  <span>Target Mobile:</span>
                  <span className="font-mono font-semibold text-slate-900">{currentProposal.phoneNumber}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-emerald-200/40 text-sm">
                  <span className="font-bold text-emerald-950">Total Payable:</span>
                  <span className="font-black text-emerald-800">KES {currentProposal.amount.toLocaleString('en-KE')}</span>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => executeStkPush(currentProposal)}
                  disabled={isTriggeringStk}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white shadow hover:bg-emerald-800 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  {isTriggeringStk ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <PhoneCall className="h-4 w-4" /> Confirm & Send STK Push
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Active Handset STK Prompt Banner */}
          {activeCheckoutId && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-md animate-fade-in">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                    stkStatus?.status === 'SUCCESS'
                      ? 'bg-emerald-100 text-emerald-700'
                      : stkStatus?.status === 'FAILED' || stkStatus?.status === 'EXPIRED_UNPAID'
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-amber-100 text-amber-700 animate-pulse'
                  }`}
                >
                  {stkStatus?.status === 'SUCCESS' ? (
                    <CheckCircle2 className="h-6 w-6" />
                  ) : stkStatus?.status === 'FAILED' || stkStatus?.status === 'EXPIRED_UNPAID' ? (
                    <AlertCircle className="h-6 w-6" />
                  ) : (
                    <Clock className="h-6 w-6 animate-spin" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-bold text-slate-900">
                    {stkStatus?.status === 'SUCCESS'
                      ? 'Payment Received & Reconciled!'
                      : stkStatus?.status === 'FAILED' || stkStatus?.status === 'EXPIRED_UNPAID'
                      ? 'Transaction Cancelled or Failed'
                      : 'M-Pesa PIN Prompt Sent to Handset'}
                  </h4>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {stkStatus?.status === 'SUCCESS'
                      ? `Receipt: ${stkStatus.mpesaReceiptNumber || 'Verified'}. Ledger balance updated.`
                      : stkStatus?.status === 'FAILED' || stkStatus?.status === 'EXPIRED_UNPAID'
                      ? stkStatus.resultDescription || 'Handset request timed out or was declined.'
                      : 'Please check your phone screen and enter your M-Pesa PIN to complete payment.'}
                  </p>
                </div>
              </div>

              {stkStatus?.status === 'SUCCESS' && (
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={onClose}
                    className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-800"
                  >
                    Done
                  </button>
                </div>
              )}

              {(stkStatus?.status === 'FAILED' || stkStatus?.status === 'EXPIRED_UNPAID') && (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => {
                      setActiveCheckoutId(null);
                      setStkStatus(null);
                    }}
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Try Again
                  </button>
                </div>
              )}
            </div>
          )}

          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-slate-500 italic">
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-emerald-600" />
              Assistant is thinking...
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="border-t border-slate-200 bg-white p-3">
          <form
            onSubmit={e => {
              e.preventDefault();
              void sendMessage();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              placeholder="e.g. Deposit 2,000 to savings, or pay loan..."
              disabled={isLoading || Boolean(activeCheckoutId && stkStatus?.status === 'PENDING')}
              className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!inputText.trim() || isLoading}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-700 text-white shadow hover:bg-emerald-800 transition-colors disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 px-1">
            <span>Powered by Gemini & Safaricom Daraja</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void sendMessage('Deposit 1,000 to savings')}
                className="hover:text-emerald-700 hover:underline"
              >
                +KES 1,000 Savings
              </button>
              <button
                type="button"
                onClick={() => void sendMessage('Repay 500 on my loan')}
                className="hover:text-emerald-700 hover:underline"
              >
                +KES 500 Loan
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
