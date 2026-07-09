import React, { useState, useEffect } from 'react';
import type { Member, PaymentRecord, Transaction } from '../types';
import { 
  Smartphone, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Database, 
  CreditCard, 
  ArrowRight,
  PlusCircle,
  Check,
  FileSpreadsheet,
  Sparkles,
  Search,
  User,
  Hash
} from 'lucide-react';

interface PaybillViewProps {
  members: Member[];
  currentUserRole: string;
  currentUserName: string;
  onRefreshData?: () => void;
}

export default function PaybillView({
  members,
  currentUserRole,
  currentUserName,
  onRefreshData
}: PaybillViewProps) {
  // Logger Form State
  const [targetTill, setTargetTill] = useState<'VehicleTill' | 'UtilityTill'>('VehicleTill');
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [amount, setAmount] = useState('');
  const [refCode, setRefCode] = useState('');
  const [category, setCategory] = useState<'Daily Contribution' | 'Registration Fee' | 'Management Fee' | 'Penalty'>('Daily Contribution');
  const [phoneNumber, setPhoneNumber] = useState('');
  
  // Tab State
  const [activeFormTab, setActiveFormTab] = useState<'manual' | 'webhook'>('manual');
  
  // Simulator State
  const [simAmount, setSimAmount] = useState('1500');
  const [simAccount, setSimAccount] = useState('');
  const [simPhone, setSimPhone] = useState('254712345678');
  const [simShortcode, setSimShortcode] = useState('600000');
  const [simResult, setSimResult] = useState<any>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  // Webhook Registration Tool State
  const [regConsumerKey, setRegConsumerKey] = useState('Aw0MwYUv30Rekn214WOmtnwLd1G2Pwsrzx7MHjmna16z6KUP');
  const [regConsumerSecret, setRegConsumerSecret] = useState('m1eXDG1Fs9IPjIoGF9dvqECG5pCggAjfWWLF82BmjwITQmkSTpFWozqoPRMNOz6d');
  const [regShortcode, setRegShortcode] = useState('600000');
  const [regMode, setRegMode] = useState<'sandbox' | 'production'>('sandbox');
  const [callbackBaseUrl, setCallbackBaseUrl] = useState(() => window.location.origin);
  const [regResult, setRegResult] = useState<any>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  // Status states
  const [isLoading, setIsLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Search filter for lists
  const [searchTerm, setSearchTerm] = useState('');

  // Ledgers State
  const [mpesaTransactions, setMpesaTransactions] = useState<Transaction[]>([]);
  const [paymentRecords, setPaymentRecords] = useState<PaymentRecord[]>([]);
  const [reconcileSelections, setReconcileSelections] = useState<Record<string, string>>({});
  const [reconcilingPaymentId, setReconcilingPaymentId] = useState('');
  const [isDataLoading, setIsDataLoading] = useState(false);

  // Security headers helper
  const getSaccoSecurityHeaders = () => {
    let key = 'saccopass123';
    let email = 'treasurer@sacco.co.ke';
    if (currentUserRole === 'Treasurer') {
      email = 'treasurer@sacco.co.ke';
      key = 'treasurer@sacco';
    } else if (currentUserRole === 'Secretary') {
      email = 'secretary@sacco.co.ke';
      key = 'secretary@sacco';
    } else if (currentUserRole === 'Chairman') {
      email = 'chairman@sacco.co.ke';
      key = 'chairman@sacco';
    } else if (currentUserRole === 'Auditor') {
      email = 'auditor@sacco.co.ke';
      key = 'auditor@sacco';
    } else if (currentUserRole === 'Accountant') {
      email = 'accountant@sacco.co.ke';
      key = 'accountant@sacco';
    }

    return {
      'Content-Type': 'application/json',
      'x-sacco-user-email': email,
      'x-sacco-user-role': currentUserRole,
      'x-sacco-user-key': key
    };
  };

  // Generate a random mock M-Pesa reference code
  const generateRandomRefCode = () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'QG';
    for (let i = 0; i < 8; i++) {
      code += letters.charAt(Math.floor(Math.random() * letters.length));
    }
    setRefCode(code);
  };

  useEffect(() => {
    generateRandomRefCode();
    if (members.length > 0) {
      setSimAccount(members[0].id);
      setSimPhone(members[0].phoneNumber.replace(/\+/g, '').trim());
    }
  }, [members]);

  // Sync phone number on member selection
  const handleMemberSelect = (memberId: string) => {
    setSelectedMemberId(memberId);
    if (!memberId) {
      setPhoneNumber('');
      return;
    }
    const matched = members.find(m => m.id === memberId);
    if (matched) {
      setPhoneNumber(matched.phoneNumber);
    } else {
      setPhoneNumber('');
    }
  };

  // Fetch transaction history
  const fetchHistory = async () => {
    setIsDataLoading(true);
    try {
      const headers = getSaccoSecurityHeaders();
      
      const txRes = await fetch('/api/transactions', { headers });
      let txs: Transaction[] = [];
      if (txRes.ok) {
        txs = await txRes.json();
      }

      const paymentsRes = await fetch('/api/payments', { headers });
      let payments: PaymentRecord[] = [];
      if (paymentsRes.ok) {
        payments = await paymentsRes.json();
      }

      // Filter M-Pesa transactions (containing mpesa or matching TillType)
      const filteredTxs = txs.filter((t: Transaction) => 
        t.tillNumber === 'VehicleTill' || 
        t.tillNumber === 'UtilityTill' ||
        t.refCode.toUpperCase().startsWith('Q') ||
        t.description.toLowerCase().includes('mpesa')
      );

      // Sort by newest first
      filteredTxs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      setMpesaTransactions(filteredTxs);
      setPaymentRecords(payments);

    } catch (err) {
      console.error('Error fetching paybill history:', err);
    } finally {
      setIsDataLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [currentUserRole]);

  // Handle direct logging submission
  const handleSubmitLog = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg(null);
    setErrorMsg(null);

    if (!amount || Number(amount) <= 0) {
      setErrorMsg('Please enter a valid KES amount greater than zero.');
      return;
    }

    if (!refCode.trim()) {
      setErrorMsg('M-Pesa transaction reference code is required.');
      return;
    }

    const refExists = paymentRecords.some(payment => payment.refCode.toUpperCase() === refCode.trim().toUpperCase()) ||
      mpesaTransactions.some(tx => tx.refCode.toUpperCase() === refCode.trim().toUpperCase());
    if (refExists) {
      setErrorMsg(`Reference ${refCode.trim().toUpperCase()} already exists. Confirm the payment before trying again.`);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/mpesa/log-payment', {
        method: 'POST',
        headers: getSaccoSecurityHeaders(),
        body: JSON.stringify({
          memberId: selectedMemberId || null,
          amount: Number(amount),
          category,
          refCode: refCode.trim(),
          tillNumber: targetTill
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to log cashless payment.');
      }

      const data = await res.json();
      setSuccessMsg(
        data.payment?.status === 'Unmatched'
          ? `Payment ${refCode.toUpperCase()} was captured and queued for reconciliation.`
          : `Payment ${refCode.toUpperCase()} was captured and reconciled.`
      );
      
      // Reset form variables
      setAmount('');
      setSelectedMemberId('');
      setPhoneNumber('');
      generateRandomRefCode();

      // Refresh both local history & general application datasets
      fetchHistory();
      if (onRefreshData) {
        onRefreshData();
      }

      // Clear success notification after 5 seconds
      setTimeout(() => setSuccessMsg(null), 5000);

    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred while logging the payment.');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle real Daraja sandbox C2B simulation submission
  const handleSimulateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    setSimResult(null);
    setSuccessMsg(null);
    setErrorMsg(null);

    if (!simAmount || Number(simAmount) <= 0) {
      setErrorMsg('Please enter a valid KES amount for simulation.');
      return;
    }

    setIsSimulating(true);
    try {
      const res = await fetch('/api/mpesa/simulate-c2b', {
        method: 'POST',
        headers: getSaccoSecurityHeaders(),
        body: JSON.stringify({
          consumerKey: regConsumerKey.trim(),
          consumerSecret: regConsumerSecret.trim(),
          shortcode: simShortcode.trim(),
          mode: regMode,
          amount: Number(simAmount),
          msisdn: simPhone.trim().replace(/\D/g, ''),
          billRefNumber: simAccount.trim()
        })
      });

      const data = await res.json();
      setSimResult(data);

      if (res.ok && data.status === 'success') {
        setSuccessMsg(`Daraja sandbox C2B simulation accepted. Waiting for Safaricom callback on the registered confirmation URL.`);
        
        // Refresh local views
        setTimeout(fetchHistory, 2500);
        if (onRefreshData) {
          onRefreshData();
        }
      } else {
        setErrorMsg(`Safaricom sandbox rejected the simulation: ${JSON.stringify(data.response || data)}`);
      }

    } catch (err: any) {
      setErrorMsg(`Daraja sandbox simulation failed: ${err.message}`);
    } finally {
      setIsSimulating(false);
    }
  };

  // Handle programmatic Safaricom Daraja URL Registration
  const handleRegisterUrls = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegResult(null);
    setSuccessMsg(null);
    setErrorMsg(null);

    if (!regConsumerKey.trim() || !regConsumerSecret.trim() || !regShortcode.trim()) {
      setErrorMsg('Consumer Key, Secret, and Shortcode are required for registration.');
      return;
    }

    setIsRegistering(true);
    try {
      const baseUrl = callbackBaseUrl.replace(/\/+$/, '');
      const confirmationUrl = `${baseUrl}/api/daraja/c2b-confirmation`;
      const validationUrl = `${baseUrl}/api/daraja/c2b-validation`;

      const res = await fetch('/api/mpesa/register-url', {
        method: 'POST',
        headers: getSaccoSecurityHeaders(),
        body: JSON.stringify({
          consumerKey: regConsumerKey.trim(),
          consumerSecret: regConsumerSecret.trim(),
          shortcode: regShortcode.trim(),
          mode: regMode,
          confirmationUrl,
          validationUrl
        })
      });

      const data = await res.json();
      setRegResult(data);

      if (res.ok && data.status === 'success' && data.response?.ResponseDescription?.includes('success')) {
        setSuccessMsg(`Programmatic C2B URL Registration Successful! Safaricom will now route all C2B payments to Sacco webhooks.`);
      } else if (res.ok && data.status === 'success') {
        setSuccessMsg(`C2B URL registration request sent. Safaricom Response: ${data.response?.ResponseDescription || JSON.stringify(data.response)}`);
      } else {
        setErrorMsg(data.error || `Registration returned failure: ${JSON.stringify(data)}`);
      }
    } catch (err: any) {
      setErrorMsg(`Registration failed: ${err.message}`);
    } finally {
      setIsRegistering(false);
    }
  };

  const handleReconcilePayment = async (paymentId: string) => {
    const memberId = reconcileSelections[paymentId];
    if (!memberId) {
      setErrorMsg('Select a member before reconciling this payment.');
      return;
    }

    setReconcilingPaymentId(paymentId);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/payments/${paymentId}/reconcile`, {
        method: 'POST',
        headers: getSaccoSecurityHeaders(),
        body: JSON.stringify({ memberId })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Payment reconciliation failed.');
      }

      setSuccessMsg(`Payment ${data.refCode} reconciled to ${data.memberName}.`);
      await fetchHistory();
      if (onRefreshData) {
        onRefreshData();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Payment reconciliation failed.');
    } finally {
      setReconcilingPaymentId('');
    }
  };

  // Helper to filter items in the tables based on searching
  const filteredTxs = mpesaTransactions.filter(t => 
    t.refCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (t.memberName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.category.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const filteredPayments = paymentRecords.filter(payment =>
    payment.refCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
    payment.status.toLowerCase().includes(searchTerm.toLowerCase()) ||
    payment.payerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (payment.memberName || '').toLowerCase().includes(searchTerm.toLowerCase())
  );
  const unmatchedPayments = filteredPayments.filter(payment => payment.status === 'Unmatched');
  const reconciledPayments = filteredPayments.filter(payment => payment.status === 'Reconciled');
  const duplicatePayments = filteredPayments.filter(payment => payment.status === 'Duplicate');

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-slate-50 font-sans flex flex-col space-y-6 min-h-0">
      
      {/* HEADER HERO AREA */}
      <div className="bg-slate-900 text-white p-6 rounded-xl border border-slate-950 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="text-[10px] font-bold uppercase tracking-widest bg-emerald-500 text-slate-950 px-2.5 py-0.5 rounded font-mono border border-emerald-600">
              Sowetamu Sacco Tills
            </span>
            <span className="text-[10px] font-bold uppercase tracking-widest bg-indigo-500 text-white px-2.5 py-0.5 rounded font-mono">
              Cashless Dual-Till System
            </span>
          </div>
          <h2 className="text-xl font-bold font-display text-slate-100 mt-1.5 flex items-center">
            <Smartphone className="w-5.5 h-5.5 text-emerald-400 mr-2.5" />
            Cashless Paybill Gateway
          </h2>
          <p className="text-xs text-slate-400 max-w-2xl leading-normal">
            Sowetamu Sacco processes cashless mobile payments using two segregated M-Pesa tills. Live Daraja callbacks create payment records automatically and post matched payments into the ledger.
          </p>
        </div>

        <button
          onClick={fetchHistory}
          disabled={isDataLoading}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-750 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded border border-slate-700 flex items-center space-x-2 transition-all shadow-sm shrink-0 self-start md:self-center"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isDataLoading ? 'animate-spin' : ''}`} />
          <span>Sync Tills Data</span>
        </button>
      </div>

      {/* FEEDBACK BANNERS */}
      {successMsg && (
        <div className="bg-emerald-50 border-l-4 border-emerald-600 text-emerald-950 p-4 rounded-lg flex items-start space-x-3 text-xs shadow-sm shrink-0">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-bold">Transaction Successfully Recorded</p>
            <p className="text-emerald-800">{successMsg}</p>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="bg-rose-50 border-l-4 border-rose-600 text-rose-950 p-4 rounded-lg flex items-start space-x-3 text-xs shadow-sm shrink-0">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-bold">Execution Error</p>
            <p className="text-rose-800">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* TWO TILL METRICS OVERVIEW */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 shrink-0">
        
        {/* TILL A */}
        <div className="bg-white border-2 border-slate-200 hover:border-emerald-500 rounded-xl p-5 shadow-xs transition-all relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full -mr-6 -mt-6" />
          <div>
            <div className="flex justify-between items-start">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded border border-emerald-200">
                Till No. 824 9102
              </span>
              <Smartphone className="w-5 h-5 text-emerald-500" />
            </div>
            <h3 className="text-sm font-black text-slate-900 mt-3">Vehicle Fleet Till</h3>
            <p className="text-xs text-slate-500 mt-1 leading-normal">
              Used strictly for matatu transit daily contributions, driver subscriptions, vehicle registration fees, and driver licensing dues. Reconciles with the fleet fleet-tracking logs.
            </p>
          </div>
          <div className="border-t border-slate-100 mt-4 pt-3 flex justify-between items-center text-[11px]">
            <span className="text-slate-400 font-mono">Ledger Code: VehicleTill</span>
            <span className="text-emerald-700 font-bold font-mono">100% Cashless Sync</span>
          </div>
        </div>

        {/* TILL B */}
        <div className="bg-white border-2 border-slate-200 hover:border-indigo-500 rounded-xl p-5 shadow-xs transition-all relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full -mr-6 -mt-6" />
          <div>
            <div className="flex justify-between items-start">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider bg-indigo-50 text-indigo-800 px-2 py-0.5 rounded border border-indigo-200">
                Till No. 481 0294
              </span>
              <Smartphone className="w-5 h-5 text-indigo-500" />
            </div>
            <h3 className="text-sm font-black text-slate-900 mt-3">Operating Utility Till</h3>
            <p className="text-xs text-slate-500 mt-1 leading-normal">
              Used for general Sacco management fees, office expenses, route penalties, licensing dues, equipment acquisitions, and non-member direct service deposits.
            </p>
          </div>
          <div className="border-t border-slate-100 mt-4 pt-3 flex justify-between items-center text-[11px]">
            <span className="text-slate-400 font-mono">Ledger Code: UtilityTill</span>
            <span className="text-indigo-700 font-bold font-mono">Central Operating Sync</span>
          </div>
        </div>

      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 shrink-0">
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider font-mono">Payment Records</p>
          <p className="text-lg font-black text-slate-900 mt-1">{paymentRecords.length}</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
          <p className="text-[9px] font-black uppercase text-emerald-700 tracking-wider font-mono">Reconciled</p>
          <p className="text-lg font-black text-emerald-800 mt-1">{reconciledPayments.length}</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-[9px] font-black uppercase text-amber-700 tracking-wider font-mono">Unmatched</p>
          <p className="text-lg font-black text-amber-800 mt-1">{unmatchedPayments.length}</p>
        </div>
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
          <p className="text-[9px] font-black uppercase text-rose-700 tracking-wider font-mono">Duplicates</p>
          <p className="text-lg font-black text-rose-800 mt-1">{duplicatePayments.length}</p>
        </div>
      </div>

      {/* CORE WORKSPACE CONTENT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start min-h-0">
        
        {/* LOG FORM COLUMN (4/12) - MANUAL LOGGER & DARAJA WEBHOOK SIMULATOR */}
        <div className="lg:col-span-5 flex flex-col space-y-4 shrink-0">
          
          {/* TAB SWITCHER */}
          <div className="grid grid-cols-2 gap-2 bg-slate-200 p-1 rounded-xl border border-slate-300 text-xs font-bold shrink-0">
            <button
              type="button"
              onClick={() => setActiveFormTab('manual')}
              className={`py-2 px-3 rounded-lg transition-all text-center flex items-center justify-center space-x-1.5 ${
                activeFormTab === 'manual'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-800 hover:bg-white/50'
              }`}
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Manual Logger</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveFormTab('webhook')}
              className={`py-2 px-3 rounded-lg transition-all text-center flex items-center justify-center space-x-1.5 ${
                activeFormTab === 'webhook'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-800 hover:bg-white/50'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Daraja Webhook</span>
            </button>
          </div>

          {/* RENDER ACTIVE TAB */}
          {activeFormTab === 'manual' ? (
            <div className="bg-white border-2 border-slate-900 rounded-xl p-5 shadow-sm flex flex-col space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-xs font-black text-slate-950 uppercase tracking-widest flex items-center">
                  <PlusCircle className="w-4 h-4 text-emerald-600 mr-2" />
                  Cashless Deposit Log Entry
                </h3>
                <p className="text-[11px] text-slate-500 mt-1">Manual entry form to report cashless payments received on Sacco tills.</p>
              </div>

              <form onSubmit={handleSubmitLog} className="space-y-4 text-xs">
                
                {/* TILL SELECTOR */}
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-600 tracking-wider mb-1.5 font-mono">
                    Select Destination Till / Paybill
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setTargetTill('VehicleTill')}
                      className={`py-2 px-3 rounded-lg border-2 text-left transition-all flex flex-col justify-between ${
                        targetTill === 'VehicleTill' 
                          ? 'border-emerald-600 bg-emerald-50/50 text-emerald-950' 
                          : 'border-slate-200 hover:border-slate-350 bg-slate-50 text-slate-700'
                      }`}
                    >
                      <span className="font-bold text-[11px]">Vehicle Till</span>
                      <span className="text-[9px] font-mono mt-0.5 opacity-80">No. 824 9102</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTargetTill('UtilityTill')}
                      className={`py-2 px-3 rounded-lg border-2 text-left transition-all flex flex-col justify-between ${
                        targetTill === 'UtilityTill' 
                          ? 'border-indigo-600 bg-indigo-50/50 text-indigo-950' 
                          : 'border-slate-200 hover:border-slate-350 bg-slate-50 text-slate-700'
                      }`}
                    >
                      <span className="font-bold text-[11px]">Utility Till</span>
                      <span className="text-[9px] font-mono mt-0.5 opacity-80">No. 481 0294</span>
                    </button>
                  </div>
                </div>

                {/* MEMBER ASSIGNMENT */}
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-600 tracking-wider mb-1.5 font-mono flex justify-between">
                    <span>Associate Member Account</span>
                    <span className="text-[9px] lowercase font-normal text-slate-400 italic">optional</span>
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <select
                      value={selectedMemberId}
                      onChange={(e) => handleMemberSelect(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 border-2 border-slate-200 rounded-lg bg-white focus:outline-none focus:border-slate-900 font-bold text-slate-800"
                    >
                      <option value="">-- Direct Payment (No Member Linked) --</option>
                      {members.map(m => (
                        <option key={m.id} value={m.id}>{m.name} ({m.vehicleAssigned || 'No Fleet Assigned'})</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* SUBSCRIBER PHONE */}
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-600 tracking-wider mb-1.5 font-mono">
                    Payer Phone Number
                  </label>
                  <input
                    type="text"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg focus:outline-none focus:border-slate-900 font-mono text-[11px]"
                  />
                </div>

                {/* M-PESA REF CODE & GENERATE BUTTON */}
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-600 tracking-wider mb-1.5 font-mono flex justify-between items-center">
                    <span>M-Pesa Reference Code</span>
                    <button
                      type="button"
                      onClick={generateRandomRefCode}
                      className="text-[9px] text-emerald-600 font-bold hover:underline"
                    >
                      Generate Valid Ref
                    </button>
                  </label>
                  <div className="relative">
                    <Hash className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      value={refCode}
                      onChange={(e) => setRefCode(e.target.value.toUpperCase())}
                      maxLength={10}
                      className="w-full pl-9 pr-3 py-2 border-2 border-slate-200 rounded-lg focus:outline-none focus:border-slate-900 font-mono font-bold text-slate-900 text-[12px] uppercase"
                    />
                  </div>
                </div>

                {/* CATEGORY & AMOUNT */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-600 tracking-wider mb-1.5 font-mono">
                      Allocation Category
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as any)}
                      className="w-full px-2.5 py-2 border-2 border-slate-200 bg-white rounded-lg focus:outline-none focus:border-slate-900"
                    >
                      <option value="Daily Contribution">Daily Contribution</option>
                      <option value="Registration Fee">Registration Fee</option>
                      <option value="Management Fee">Management Fee</option>
                      <option value="Penalty">Sacco Penalty</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-600 tracking-wider mb-1.5 font-mono">
                      Amount (KES)
                    </label>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg focus:outline-none focus:border-slate-900 font-bold text-emerald-600 text-[13px]"
                    />
                  </div>
                </div>

                {/* DAILY CONTRIBUTION ALLOCATION INFO */}
                {category === 'Daily Contribution' && selectedMemberId && (
                  <div className="bg-emerald-50 border border-emerald-200 p-2.5 rounded-lg text-[10px] text-emerald-950 font-sans leading-normal">
                    <p className="font-bold flex items-center mb-0.5">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-600 mr-1 shrink-0" />
                      Dual-Till Reapportionment Active:
                    </p>
                    As defined by the Sacco policy, this contribution is split as:
                    <ul className="list-disc list-inside mt-1 space-y-0.5 text-emerald-900 font-medium">
                      <li>30% credited to member's Shares Account (+KES {amount ? Math.round(Number(amount) * 0.3).toLocaleString() : '0'})</li>
                      <li>70% credited to member's Savings Account (+KES {amount ? Math.round(Number(amount) * 0.7).toLocaleString() : '0'})</li>
                    </ul>
                  </div>
                )}

                {/* SUBMIT BUTTON */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-black text-xs uppercase tracking-wider rounded-lg border border-slate-950 flex items-center justify-center space-x-2 transition-all shadow-sm"
                >
                  {isLoading ? (
                    <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  )}
                  <span>Commit Payment</span>
                </button>

              </form>
            </div>
          ) : (
            <div className="bg-white border-2 border-emerald-600 rounded-xl p-5 shadow-sm flex flex-col space-y-4">
              
              {/* LIVE INTEGRATION CONFIG */}
              <div className="border-b border-slate-150 pb-3.5">
                <h3 className="text-xs font-black text-slate-950 uppercase tracking-widest flex items-center">
                  <Smartphone className="w-4 h-4 text-emerald-600 mr-2" />
                  Safaricom Webhook API Config
                </h3>
                <p className="text-[11px] text-slate-500 mt-1 leading-normal">
                  Connect your real Safaricom M-Pesa C2B Paybill in production or sandbox. The callback base must be a public HTTPS URL reachable by Safaricom.
                </p>

                <div className="mt-3 space-y-2 text-[10px] font-mono">
                  <div>
                    <label className="block text-[8px] uppercase tracking-wider font-bold text-slate-500 font-sans mb-1">
                      Public Callback Base URL
                    </label>
                    <input
                      type="url"
                      value={callbackBaseUrl}
                      onChange={(e) => setCallbackBaseUrl(e.target.value)}
                      className="w-full px-2.5 py-2 border border-slate-300 rounded bg-white text-[11px] font-mono text-slate-800"
                    />
                    {!callbackBaseUrl.startsWith('https://') && (
                      <p className="text-[9px] text-amber-700 mt-1 font-sans">
                        Live Daraja callbacks require a public HTTPS URL. Use your deployed domain or an HTTPS tunnel during testing.
                      </p>
                    )}
                  </div>

                  <div className="bg-slate-900 text-slate-200 p-2.5 rounded-lg border border-slate-950 space-y-1 relative group">
                    <span className="text-[8px] uppercase tracking-wider font-bold text-amber-400 block font-sans">
                      1. C2B Validation URL (POST)
                    </span>
                    <input
                      type="text"
                      readOnly
                      value={`${callbackBaseUrl.replace(/\/+$/, '')}/api/daraja/c2b-validation`}
                      className="bg-transparent text-emerald-400 font-bold border-none outline-none w-full select-all"
                    />
                    <span className="text-[9px] text-slate-400 block font-sans">
                      Safaricom hits this URL to approve or reject the payment before finalizing.
                    </span>
                  </div>

                  <div className="bg-slate-900 text-slate-200 p-2.5 rounded-lg border border-slate-950 space-y-1 relative group">
                    <span className="text-[8px] uppercase tracking-wider font-bold text-emerald-400 block font-sans">
                      2. C2B Confirmation URL (POST)
                    </span>
                    <input
                      type="text"
                      readOnly
                      value={`${callbackBaseUrl.replace(/\/+$/, '')}/api/daraja/c2b-confirmation`}
                      className="bg-transparent text-emerald-400 font-bold border-none outline-none w-full select-all"
                    />
                    <span className="text-[9px] text-slate-400 block font-sans">
                      Safaricom hits this URL with the finalized transaction receipt. This triggers the ledger update and balance reconciliation.
                    </span>
                  </div>
                </div>
              </div>

              {/* AUTOMATIC WEBHOOK REGISTRATION TOOL */}
              <div className="bg-emerald-50/50 border border-emerald-200 rounded-lg p-3.5 space-y-3 text-xs">
                <div>
                  <h4 className="text-[10px] font-black uppercase text-emerald-800 tracking-wider font-mono flex items-center justify-between">
                    <span>Programmatic URL Registrar</span>
                    <span className="bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-bold font-sans text-[9px]">
                      Daraja Core API
                    </span>
                  </h4>
                  <p className="text-[11px] text-slate-600 mt-0.5 leading-normal">
                    Enter your Consumer Key and Secret to automatically register the above Webhook URLs with your Safaricom Sandbox/Production paybill:
                  </p>
                </div>

                <form onSubmit={handleRegisterUrls} className="space-y-2">
                  <div>
                    <label className="block text-[9px] font-bold uppercase text-slate-500 font-mono">
                      Consumer Key
                    </label>
                    <input
                      type="text"
                      value={regConsumerKey}
                      onChange={(e) => setRegConsumerKey(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white text-[11px] font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold uppercase text-slate-500 font-mono">
                      Consumer Secret
                    </label>
                    <input
                      type="password"
                      value={regConsumerSecret}
                      onChange={(e) => setRegConsumerSecret(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white text-[11px] font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[9px] font-bold uppercase text-slate-500 font-mono">
                        Shortcode / Paybill
                      </label>
                      <input
                        type="text"
                        value={regShortcode}
                        onChange={(e) => setRegShortcode(e.target.value)}
                        className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white text-[11px] font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold uppercase text-slate-500 font-mono">
                        Environment Mode
                      </label>
                      <select
                        value={regMode}
                        onChange={(e) => setRegMode(e.target.value as any)}
                        className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white text-[11px] font-bold"
                      >
                        <option value="sandbox">Sandbox</option>
                        <option value="production">Production</option>
                      </select>
                    </div>
                  </div>

                  {regResult && (
                    <div className="bg-slate-900 text-slate-300 p-2 rounded border border-slate-950 font-mono text-[9px] max-h-36 overflow-y-auto">
                      <p className="font-bold font-sans text-amber-400 uppercase text-[8px] mb-0.5">
                        Daraja API Response:
                      </p>
                      <pre className="whitespace-pre-wrap select-all text-emerald-400 leading-relaxed">
                        {JSON.stringify(regResult, null, 2)}
                      </pre>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isRegistering}
                    className="w-full py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-black text-[10px] uppercase tracking-wider rounded border border-slate-950 flex items-center justify-center space-x-1.5 transition-all shadow-sm"
                  >
                    {isRegistering ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                    ) : (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    )}
                    <span>Register Webhooks with Safaricom</span>
                  </button>
                </form>
              </div>

              {/* SIMULATOR INTERACTIVE FORM */}
              <form onSubmit={handleSimulateWebhook} className="space-y-3.5 text-xs">
                <div>
                  <h4 className="text-[10px] font-black uppercase text-emerald-800 tracking-wider font-mono flex items-center justify-between">
                    <span>Real Daraja Sandbox Test</span>
                    <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-bold font-sans">
                      Test Webhook Code
                    </span>
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-normal">
                    Trigger Safaricom's sandbox C2B simulator. When callbacks are registered to a public HTTPS URL, Safaricom will call this app and the payment will reconcile automatically.
                  </p>
                </div>

                {/* SIMULATED SHORTCODE */}
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-600 tracking-wider mb-1 font-mono">
                    Business Shortcode (Paybill/Till)
                  </label>
                  <select
                    value={simShortcode}
                    onChange={(e) => setSimShortcode(e.target.value)}
                    className="w-full px-2.5 py-2 border-2 border-slate-200 bg-white rounded-lg focus:outline-none focus:border-slate-900 font-bold"
                  >
                    <option value="600000">Sandbox Paybill 600000</option>
                    <option value="8249102">Vehicle Fleet Till No. 824 9102</option>
                    <option value="4810294">Operating Utility Till No. 481 0294</option>
                  </select>
                </div>

                {/* CHOOSE MEMBER TARGET FOR WEBHOOK */}
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-600 tracking-wider mb-1 font-mono">
                    Simulate Payer (Reconcile Target)
                  </label>
                  <select
                    value={simAccount}
                    onChange={(e) => {
                      const mId = e.target.value;
                      setSimAccount(mId);
                      const m = members.find(x => x.id === mId);
                      if (m) {
                        setSimPhone(m.phoneNumber.replace(/\+/g, '').trim());
                      }
                    }}
                    className="w-full px-2.5 py-2 border-2 border-slate-200 bg-white rounded-lg focus:outline-none focus:border-slate-900 font-bold text-slate-800"
                  >
                    <option value="">-- Direct Payment (Non-Member Direct Deposit) --</option>
                    {members.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name} [ID: {m.id} • Plate: {m.vehicleAssigned || 'None'}]
                      </option>
                    ))}
                  </select>
                </div>

                {/* ACCOUNT REFERENCE INPUT */}
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-600 tracking-wider mb-1 font-mono flex justify-between">
                    <span>Account Reference (BillRefNumber)</span>
                    <span className="text-[9px] lowercase font-normal text-slate-400 italic">Payer typed this on phone</span>
                  </label>
                  <input
                    type="text"
                    value={simAccount}
                    onChange={(e) => setSimAccount(e.target.value)}
                    className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg focus:outline-none focus:border-slate-900 font-mono font-bold"
                  />
                </div>

                {/* MSISDN & NAMES */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-600 tracking-wider mb-1 font-mono">
                      Phone (MSISDN)
                    </label>
                    <input
                      type="text"
                      value={simPhone}
                      onChange={(e) => setSimPhone(e.target.value)}
                      className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg focus:outline-none focus:border-slate-900 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-600 tracking-wider mb-1 font-mono">
                      Amount (KES)
                    </label>
                    <input
                      type="number"
                      value={simAmount}
                      onChange={(e) => setSimAmount(e.target.value)}
                      className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg focus:outline-none focus:border-slate-900 font-bold text-emerald-600"
                    />
                  </div>
                </div>

                {/* SIMULATOR RESPONSE STATUS */}
                {simResult && (
                  <div className="bg-slate-900 text-slate-300 p-2.5 rounded-lg border border-slate-950 font-mono text-[10px] space-y-1">
                    <p className="font-bold font-sans text-amber-400 uppercase text-[8px] tracking-wider">
                      Safaricom HTTP Response Result:
                    </p>
                    <pre className="overflow-x-auto select-all text-emerald-400 font-semibold leading-relaxed">
                      {JSON.stringify(simResult, null, 2)}
                    </pre>
                  </div>
                )}

                {/* SIMULATE BUTTON */}
                <button
                  type="submit"
                  disabled={isSimulating}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black text-xs uppercase tracking-wider rounded-lg border border-emerald-700 flex items-center justify-center space-x-2 transition-all shadow-md"
                >
                  {isSimulating ? (
                    <RefreshCw className="w-4 h-4 animate-spin text-white" />
                  ) : (
                    <ArrowRight className="w-4 h-4 text-white" />
                  )}
                  <span>Run Daraja Sandbox C2B</span>
                </button>

              </form>
            </div>
          )}
        </div>

        {/* LEDGERS VIEWS COLUMN (8/12) */}
        <div className="lg:col-span-7 flex flex-col space-y-6 min-h-0">
          
          {/* SEARCH BAR FOR LOGS */}
          <div className="relative shrink-0">
            <Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 border-2 border-slate-200 rounded-xl bg-white text-xs focus:outline-none focus:border-slate-900"
            />
          </div>

          {/* DUAL-TILL LEDGERS JUXTAPOSITION */}
          <div className="grid grid-cols-1 gap-6">
            <div className="bg-white border-2 border-amber-200 rounded-xl p-5 shadow-xs flex flex-col min-h-0 max-h-[360px]">
              <div className="flex justify-between items-center border-b border-slate-100 pb-3 shrink-0">
                <h3 className="text-xs font-black text-slate-950 uppercase tracking-widest flex items-center">
                  <AlertCircle className="w-4 h-4 text-amber-600 mr-2" />
                  Unmatched Payment Queue
                </h3>
                <span className="text-[10px] font-mono text-amber-700 bg-amber-50 px-2 py-0.5 rounded font-bold">
                  {unmatchedPayments.length} pending
                </span>
              </div>

              <div className="overflow-y-auto flex-1 mt-3 space-y-3">
                {unmatchedPayments.length === 0 ? (
                  <div className="text-center py-10 text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                    <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                    <p className="font-bold font-mono text-slate-600">No unmatched payments.</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">Live callbacks that cannot match a member will appear here.</p>
                  </div>
                ) : (
                  unmatchedPayments.map(payment => (
                    <div key={payment.id} className="border border-amber-200 bg-amber-50/40 rounded-lg p-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-black text-slate-900 font-mono">{payment.refCode}</p>
                          <p className="text-[10px] text-slate-500">
                            {payment.payerName} • KES {payment.amount.toLocaleString()} • {payment.accountReference || 'No account ref'}
                          </p>
                          <p className="text-[9px] text-amber-700 font-mono mt-0.5">{payment.note}</p>
                        </div>
                        <span className="text-[9px] font-black uppercase tracking-wider text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                          {payment.source}
                        </span>
                      </div>
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <select
                          value={reconcileSelections[payment.id] || ''}
                          onChange={(e) => setReconcileSelections(prev => ({ ...prev, [payment.id]: e.target.value }))}
                          className="w-full px-2 py-1.5 border border-amber-200 bg-white rounded text-[11px] font-bold text-slate-700"
                        >
                          <option value="">Select member</option>
                          {members.map(member => (
                            <option key={member.id} value={member.id}>
                              {member.name} ({member.vehicleAssigned || member.phoneNumber})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleReconcilePayment(payment.id)}
                          disabled={reconcilingPaymentId === payment.id}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded text-[10px] font-black uppercase tracking-wider"
                        >
                          {reconcilingPaymentId === payment.id ? 'Saving' : 'Reconcile'}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            
            {/* 1. M-PESA CASHLESS TRANSACTIONS */}
            <div className="bg-white border-2 border-slate-200 rounded-xl p-5 shadow-xs flex flex-col min-h-0 max-h-[350px]">
              <div className="flex justify-between items-center border-b border-slate-100 pb-3 shrink-0">
                <h3 className="text-xs font-black text-slate-950 uppercase tracking-widest flex items-center">
                  <Database className="w-4 h-4 text-emerald-600 mr-2" />
                  M-Pesa Cashless Transaction Ledger
                </h3>
                <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded font-bold">
                  {filteredTxs.length} records
                </span>
              </div>

              <div className="overflow-y-auto flex-1 mt-3">
                {isDataLoading ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400 space-y-2">
                    <RefreshCw className="w-6 h-6 animate-spin text-emerald-500" />
                    <span className="text-[10px] font-mono">Loading cashless transactions...</span>
                  </div>
                ) : filteredTxs.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                    <CreditCard className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="font-bold font-mono text-slate-600">No M-Pesa transactions found.</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">Use the entry logger to record a new transaction.</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-150 text-slate-400 font-mono text-[9px] uppercase tracking-wider pb-2">
                        <th className="py-2">M-Pesa Ref</th>
                        <th className="py-2">Payer Profile</th>
                        <th className="py-2">Till</th>
                        <th className="py-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-sans">
                      {filteredTxs.map((tx) => (
                        <tr key={tx.id} className="hover:bg-slate-50/50">
                          <td className="py-2.5 font-mono font-bold text-slate-950">
                            <span className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-1.5 py-0.5 rounded text-[10px]">
                              {tx.refCode}
                            </span>
                          </td>
                          <td className="py-2.5">
                            <span className="font-semibold text-slate-800 block text-[11px]">
                              {tx.memberName || 'Direct Depositor'}
                            </span>
                            <span className="text-[9px] text-slate-400 font-mono block mt-0.5">
                              {tx.category} • Logged by {tx.recorderName}
                            </span>
                          </td>
                          <td className="py-2.5">
                            <span className={`text-[9px] font-mono font-bold uppercase px-2 py-0.5 rounded ${
                              tx.tillNumber === 'VehicleTill' ? 'bg-emerald-100 text-emerald-800' : 'bg-indigo-100 text-indigo-800'
                            }`}>
                              {tx.tillNumber === 'VehicleTill' ? 'Till: 8249102' : 'Till: 4810294'}
                            </span>
                          </td>
                          <td className="py-2.5 text-right font-mono font-black text-emerald-600">
                            +KES {tx.amount.toLocaleString()}.00
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

          </div>

        </div>

      </div>

    </div>
  );
}
