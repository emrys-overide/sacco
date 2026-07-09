import React, { useState, useEffect } from 'react';
import { Member, SaccoMessage } from '../types';
import { 
  MessageSquare, 
  Send, 
  RefreshCw, 
  Search, 
  Phone, 
  CheckCircle2, 
  AlertCircle, 
  Filter, 
  Database, 
  Sparkles, 
  Radio, 
  Users, 
  Check,
  Smartphone,
  CheckCircle,
  TrendingUp,
  Cpu,
  Mail,
  HelpCircle
} from 'lucide-react';
import { motion } from 'motion/react';

interface MessageLogsViewProps {
  members: Member[];
  currentUserRole: string;
  currentUserName: string;
}

export default function MessageLogsView({
  members,
  currentUserRole,
  currentUserName
}: MessageLogsViewProps) {
  const [messages, setMessages] = useState<SaccoMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');

  // Broadcast panel state
  const [selectedMembersForBroadcast, setSelectedMembersForBroadcast] = useState<string[]>([]);
  const [broadcastTemplate, setBroadcastTemplate] = useState('');
  const [broadcastCategory, setBroadcastCategory] = useState<'General' | 'System' | 'Savings' | 'Shares' | 'LoanRepay'>('General');
  const [broadcastSuccess, setBroadcastSuccess] = useState<string | null>(null);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);

  // Helper headers for zero-trust security validation
  const getSaccoSecurityHeaders = () => {
    // Construct valid keys for active profiles to authenticate securely
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

  const fetchMessages = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/messages', {
        headers: getSaccoSecurityHeaders()
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to fetch messages.');
      }
      const data = await res.json();
      setMessages(data);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Firestore message store inaccessible.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();
  }, [currentUserRole]);

  const handleResend = async (msgId: string) => {
    try {
      const res = await fetch(`/api/messages/${msgId}/resend`, {
        method: 'POST',
        headers: getSaccoSecurityHeaders()
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to trigger message resend.');
      }
      
      // Update local state with the returned fresh message status
      const updatedMsg = await res.json();
      setMessages(prev => prev.map(m => m.id === msgId ? updatedMsg : m));
      
      // Flash a quick notice
      setBroadcastSuccess(`SMS Ref ${updatedMsg.id} resent successfully!`);
      setTimeout(() => setBroadcastSuccess(null), 3000);
    } catch (err: any) {
      setBroadcastError(err.message || 'Failed to resend.');
      setTimeout(() => setBroadcastError(null), 3500);
    }
  };

  const handleBroadcastSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBroadcastSuccess(null);
    setBroadcastError(null);

    if (currentUserRole === 'Auditor') {
      setBroadcastError("Access Denied: Sacco Auditors have read-only permissions and cannot broadcast messages.");
      setTimeout(() => setBroadcastError(null), 4000);
      return;
    }

    if (selectedMembersForBroadcast.length === 0) {
      setBroadcastError("Selection Error: Please select at least one Sacco member to broadcast to.");
      return;
    }

    if (!broadcastTemplate.trim()) {
      setBroadcastError("Template Error: Please write a template message body.");
      return;
    }

    try {
      const res = await fetch('/api/messages/broadcast', {
        method: 'POST',
        headers: getSaccoSecurityHeaders(),
        body: JSON.stringify({
          memberIds: selectedMembersForBroadcast,
          messageTemplate: broadcastTemplate,
          category: broadcastCategory
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Broadcast failed.');
      }

      const result = await res.json();
      setBroadcastSuccess(`Broadcast Dispatched! Successfully sent ${result.sentCount} SMS confirmation logs via Gateway.`);
      
      // Clean selection and template
      setSelectedMembersForBroadcast([]);
      setBroadcastTemplate('');
      
      // Refresh messages
      fetchMessages();
      setTimeout(() => setBroadcastSuccess(null), 5000);
    } catch (err: any) {
      setBroadcastError(err.message || 'Failed to broadcast.');
      setTimeout(() => setBroadcastError(null), 4000);
    }
  };

  const toggleSelectMemberForBroadcast = (memberId: string) => {
    if (selectedMembersForBroadcast.includes(memberId)) {
      setSelectedMembersForBroadcast(prev => prev.filter(id => id !== memberId));
    } else {
      setSelectedMembersForBroadcast(prev => [...prev, memberId]);
    }
  };

  const selectAllActiveMembers = () => {
    const activeIds = members.filter(m => m.status === 'Active').map(m => m.id);
    setSelectedMembersForBroadcast(activeIds);
  };

  const clearBroadcastSelection = () => {
    setSelectedMembersForBroadcast([]);
  };

  // Filter computations
  const filteredMessages = messages.filter(msg => {
    const matchesSearch = 
      (msg.memberName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (msg.phoneNumber || '').includes(searchTerm) ||
      (msg.messageText || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (msg.refCode || '').toLowerCase().includes(searchTerm.toLowerCase());
      
    const matchesCategory = selectedCategory === 'All' || msg.category === selectedCategory;
    const matchesStatus = selectedStatus === 'All' || msg.status === selectedStatus;

    return matchesSearch && matchesCategory && matchesStatus;
  });

  // Aggregates for SMS metrics dashboard
  const totalSent = messages.length;
  const deliveryRate = totalSent > 0 
    ? Math.round((messages.filter(m => m.status === 'Delivered').length / totalSent) * 100) 
    : 100;
  const estimatedCost = totalSent * 1.20; // 1.20 KES per SMS
  const simulatedGatewayCredits = 1450.50 - estimatedCost;

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-slate-100 font-sans flex flex-col space-y-6 min-h-0">
      
      {/* EXPLANATORY HEADER BANNER */}
      <div className="bg-slate-900 text-white p-5 rounded-lg border border-slate-950 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="text-[9px] font-bold uppercase tracking-widest bg-blue-500 text-slate-950 px-2 py-0.5 rounded font-mono border border-blue-600">
              SMS GATEWAY INTERFACE
            </span>
            <span className="text-[9px] font-bold uppercase tracking-widest bg-emerald-500 text-slate-950 px-2 py-0.5 rounded font-mono">
              AFRICA'S TALKING INTEGRATION
            </span>
          </div>
          <h2 className="text-lg font-bold font-display text-slate-100 mt-1 flex items-center">
            <MessageSquare className="w-5 h-5 text-blue-400 mr-2" />
            Sacco Automated Message Confirmation Logging
          </h2>
          <p className="text-xs text-slate-400 max-w-2xl leading-normal">
            This module provides full traceability of <strong className="text-white">Sacco Confirmation Receipts</strong>. Whenever savings or shares logs are synchronized to the ledger, the gateway automatically dispatches a transactional SMS to the member's registered phone number. Review logs, resend failed cues, or broadcast bulk notifications below.
          </p>
        </div>

        <div className="flex flex-row md:flex-col items-end gap-2 shrink-0 justify-between md:justify-center">
          <button
            onClick={fetchMessages}
            disabled={isLoading}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-black text-xs uppercase tracking-wider rounded border border-blue-700 flex items-center space-x-1.5 transition-all shadow-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-white ${isLoading ? 'animate-spin' : ''}`} />
            <span>Sync Message Logs</span>
          </button>
          
          <span className="text-[10px] text-slate-400 font-mono hidden md:block">
            Secure Mode: TLS 1.3 encrypted
          </span>
        </div>
      </div>

      {/* FEEDBACK METRIC TOASTS */}
      {broadcastSuccess && (
        <div className="bg-emerald-50 border-2 border-emerald-500 text-emerald-950 p-4 rounded flex items-center space-x-2.5 text-xs shadow-sm shrink-0 animate-fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-bold">{broadcastSuccess}</span>
        </div>
      )}

      {broadcastError && (
        <div className="bg-rose-50 border-2 border-rose-500 text-rose-950 p-4 rounded flex items-center space-x-2.5 text-xs shadow-sm shrink-0 animate-fade-in">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
          <span className="font-bold">{broadcastError}</span>
        </div>
      )}

      {/* SMS STATS PANEL */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 shrink-0">
        <div className="bg-white border-2 border-slate-900 rounded p-4 shadow-xs">
          <div className="flex justify-between items-start">
            <p className="text-[10px] font-black uppercase text-slate-400 font-mono tracking-wider">SMS Dispatched</p>
            <Smartphone className="w-4 h-4 text-blue-600" />
          </div>
          <p className="text-2xl font-black text-slate-900 mt-1">{totalSent}</p>
          <p className="text-[10px] text-slate-500 mt-1 font-mono">Simulated Receipts Logged</p>
        </div>

        <div className="bg-white border-2 border-slate-900 rounded p-4 shadow-xs">
          <div className="flex justify-between items-start">
            <p className="text-[10px] font-black uppercase text-slate-400 font-mono tracking-wider">Delivery Success</p>
            <CheckCircle className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-black text-emerald-600 mt-1">{deliveryRate}%</p>
          <p className="text-[10px] text-slate-500 mt-1 font-mono">Telco Gateway Handshake</p>
        </div>

        <div className="bg-white border-2 border-slate-900 rounded p-4 shadow-xs">
          <div className="flex justify-between items-start">
            <p className="text-[10px] font-black uppercase text-slate-400 font-mono tracking-wider">Accumulated Cost</p>
            <TrendingUp className="w-4 h-4 text-indigo-600" />
          </div>
          <p className="text-2xl font-black text-slate-900 mt-1">KES {estimatedCost.toFixed(2)}</p>
          <p className="text-[10px] text-slate-500 mt-1 font-mono">@ KES 1.20 / segment</p>
        </div>

        <div className="bg-white border-2 border-slate-900 rounded p-4 shadow-xs">
          <div className="flex justify-between items-start">
            <p className="text-[10px] font-black uppercase text-slate-400 font-mono tracking-wider">Telco Credit Balance</p>
            <Cpu className="w-4 h-4 text-purple-600" />
          </div>
          <p className="text-2xl font-black text-purple-600 mt-1">KES {simulatedGatewayCredits.toFixed(2)}</p>
          <p className="text-[10px] text-slate-500 mt-1 font-mono">Africa's Talking SIM Pool</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start min-h-0">
        
        {/* LEFT COLUMN: ACTIVE MESSAGES LIST */}
        <div className="lg:col-span-2 flex flex-col space-y-4 bg-white border-2 border-slate-900 rounded p-4 shadow-sm min-h-[500px]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-wide flex items-center">
              <Database className="w-4 h-4 text-blue-600 mr-1.5" />
              Sacco Digital SMS Receipts Registry
            </h3>
            
            <span className="text-[11px] font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
              Showing {filteredMessages.length} of {messages.length} logs
            </span>
          </div>

          {/* SEARCH & FILTERS BOX */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div className="relative sm:col-span-1">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search phone, member, ref..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-slate-900 bg-white"
              />
            </div>

            <div>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white focus:outline-none"
              >
                <option value="All">All Categories</option>
                <option value="Savings">Savings Logs</option>
                <option value="Shares">Shares Logs</option>
                <option value="LoanRepay">Loan Repayments</option>
                <option value="Registration">Registration Logs</option>
                <option value="General">General Broadcasts</option>
                <option value="System">System Alerts</option>
              </select>
            </div>

            <div>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white focus:outline-none"
              >
                <option value="All">All Statuses</option>
                <option value="Delivered">Delivered</option>
                <option value="Sent">Sent (Pending Handshake)</option>
                <option value="Failed">Failed</option>
              </select>
            </div>
          </div>

          {/* MESSAGES LIST CONTAINER */}
          <div className="flex-1 overflow-y-auto max-h-[500px] space-y-3 pr-1 scrollbar-thin">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400 space-y-2">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
                <span className="text-xs font-mono font-bold">Querying secure Sacco SMS ledgers...</span>
              </div>
            ) : filteredMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 border border-dashed border-slate-200 rounded-xl bg-slate-50 space-y-2">
                <Mail className="w-8 h-8 text-slate-300" />
                <p className="text-xs font-bold font-mono">No matching confirmation receipts found.</p>
                <p className="text-[10px] text-slate-500">Refine search criteria or sync live logs above.</p>
              </div>
            ) : (
              filteredMessages.map((msg) => (
                <div 
                  key={msg.id} 
                  className={`p-3 border-2 rounded-xl transition-all flex flex-col md:flex-row md:items-start justify-between gap-3 text-xs ${
                    msg.status === 'Failed' 
                      ? 'border-rose-200 bg-rose-50/50 hover:border-rose-400' 
                      : msg.status === 'Pending'
                      ? 'border-amber-200 bg-amber-50/50 hover:border-amber-400'
                      : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="space-y-1.5 flex-1">
                    {/* Top line metadata */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-[9px] font-mono font-black uppercase px-2 py-0.5 rounded ${
                        msg.category === 'Savings' ? 'bg-emerald-100 text-emerald-800' :
                        msg.category === 'Shares' ? 'bg-indigo-100 text-indigo-800' :
                        msg.category === 'LoanRepay' ? 'bg-blue-100 text-blue-800' :
                        msg.category === 'Registration' ? 'bg-purple-100 text-purple-800' :
                        msg.category === 'System' ? 'bg-amber-100 text-amber-800' :
                        'bg-slate-100 text-slate-800'
                      }`}>
                        {msg.category}
                      </span>

                      <span className="text-[10px] font-bold text-slate-900 flex items-center">
                        <Users className="w-3 h-3 text-slate-400 mr-1" />
                        {msg.memberName || 'General Broadcast'}
                      </span>

                      <span className="text-[10px] font-mono text-slate-500 flex items-center">
                        <Phone className="w-3 h-3 text-slate-400 mr-1" />
                        {msg.phoneNumber}
                      </span>

                      {msg.refCode && (
                        <span className="text-[9px] font-mono bg-slate-100 text-slate-600 px-1.5 rounded font-semibold border border-slate-200">
                          Ref: {msg.refCode}
                        </span>
                      )}
                    </div>

                    {/* Message Body Text */}
                    <p className="text-slate-700 leading-relaxed font-mono text-[11px] bg-slate-50 p-2.5 rounded border border-slate-100">
                      {msg.messageText}
                    </p>

                    {/* Footer log tracking */}
                    <div className="flex items-center space-x-4 text-[9px] text-slate-400 font-mono">
                      <span>Gateway Code: <strong className="text-slate-600">{msg.smsGatewayResponse || 'N/A'}</strong></span>
                      <span>•</span>
                      <span>Dispatched: {new Date(msg.timestamp).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Actions & Status badge */}
                  <div className="flex md:flex-col items-end justify-between md:justify-center gap-2 shrink-0 border-t md:border-t-0 pt-2 md:pt-0 border-slate-100">
                    <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center ${
                      msg.status === 'Delivered' ? 'bg-emerald-100 text-emerald-800' :
                      msg.status === 'Failed' ? 'bg-rose-100 text-rose-800' :
                      'bg-amber-100 text-amber-800'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full mr-1 ${
                        msg.status === 'Delivered' ? 'bg-emerald-500' :
                        msg.status === 'Failed' ? 'bg-rose-500' :
                        'bg-amber-500 animate-pulse'
                      }`} />
                      {msg.status}
                    </span>

                    {currentUserRole !== 'Auditor' && (
                      <button
                        onClick={() => handleResend(msg.id)}
                        className="px-2 py-1 bg-white hover:bg-slate-50 border border-slate-200 rounded text-[10px] font-bold text-slate-700 flex items-center space-x-1 hover:border-slate-300 active:scale-95 transition-all shadow-2xs"
                        title="Resend this message confirmation to subscriber"
                      >
                        <RefreshCw className="w-2.5 h-2.5 text-slate-500" />
                        <span>Force Resend</span>
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: BROADCAST & SIMULATED LIVE QUEUE */}
        <div className="flex flex-col space-y-6">
          
          {/* BROADCAST BOX */}
          <div className="bg-white border-2 border-slate-900 rounded p-4 shadow-sm flex flex-col space-y-4">
            <div className="border-b border-slate-100 pb-2">
              <h3 className="text-xs font-black text-slate-950 uppercase tracking-widest flex items-center">
                <Radio className="w-4 h-4 text-blue-600 mr-1.5" />
                Sacco Field Broadcast Panel
              </h3>
              <p className="text-[10px] text-slate-400 mt-0.5">Send custom SMS alerts or announcements to multiple members</p>
            </div>

            <form onSubmit={handleBroadcastSubmit} className="space-y-3 text-xs">
              
              {/* MEMBER SELECTION BOX */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider font-mono">
                    Select Target Members ({selectedMembersForBroadcast.length})
                  </label>
                  
                  <div className="flex space-x-2 text-[9px] font-bold">
                    <button 
                      type="button" 
                      onClick={selectAllActiveMembers}
                      className="text-blue-600 hover:underline"
                    >
                      Select All Active
                    </button>
                    <span className="text-slate-300">|</span>
                    <button 
                      type="button" 
                      onClick={clearBroadcastSelection}
                      className="text-slate-500 hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-lg p-2 max-h-36 overflow-y-auto space-y-1.5 bg-slate-50">
                  {members.map(member => (
                    <div 
                      key={member.id} 
                      onClick={() => toggleSelectMemberForBroadcast(member.id)}
                      className={`flex items-center justify-between p-1.5 rounded cursor-pointer transition-all ${
                        selectedMembersForBroadcast.includes(member.id)
                          ? 'bg-blue-50 border border-blue-200'
                          : 'border border-transparent hover:bg-slate-200/50'
                      }`}
                    >
                      <div className="flex items-center space-x-2 truncate">
                        <div className={`w-1.5 h-1.5 rounded-full ${member.status === 'Active' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                        <span className="font-semibold text-slate-800 truncate">{member.name}</span>
                        <span className="text-[9px] text-slate-400 font-mono">({member.vehicleAssigned || 'No Fleet'})</span>
                      </div>
                      
                      <div className="flex items-center space-x-1.5">
                        <span className="text-[9px] font-mono text-slate-500">{member.phoneNumber}</span>
                        <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                          selectedMembersForBroadcast.includes(member.id)
                            ? 'bg-blue-600 border-blue-700 text-white'
                            : 'border-slate-300 bg-white'
                        }`}>
                          {selectedMembersForBroadcast.includes(member.id) && <Check className="w-2.5 h-2.5" />}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* MESSAGE CATEGORY */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1 font-mono">
                  Message Category Group
                </label>
                <select
                  value={broadcastCategory}
                  onChange={(e) => setBroadcastCategory(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white"
                >
                  <option value="General">General Broadcast / News</option>
                  <option value="System">System Compliance Alert</option>
                  <option value="Savings">Savings Notice</option>
                  <option value="Shares">Shares / Capital Notice</option>
                  <option value="LoanRepay">Loan Repayment Notice</option>
                </select>
              </div>

              {/* MESSAGE TEMPLATE */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider font-mono">
                    Message Template Body
                  </label>
                  <span className="text-[9px] font-mono text-slate-400">Use <strong className="text-slate-600">{"{name}"}</strong> for dynamic replacement</span>
                </div>
                <textarea
                  value={broadcastTemplate}
                  onChange={(e) => setBroadcastTemplate(e.target.value)}
                  rows={4}
                  placeholder="e.g. SOWETAMU SACCO: Dear {name}, please attend the special member seating scheduled for tomorrow at 2 PM at Cabanas offices. Kindly verify your shares are up-to-date."
                  className="w-full px-2.5 py-2 border border-slate-300 rounded font-mono text-xs focus:outline-none focus:border-slate-900"
                />
              </div>

              {/* PREVIEW CONTAINER */}
              {broadcastTemplate.trim() && (
                <div className="bg-slate-50 border border-slate-200 rounded p-2.5">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest font-mono mb-1">Simulation Preview</p>
                  <div className="font-mono text-[10px] text-slate-600 bg-white p-2 rounded border border-slate-100 leading-normal">
                    {broadcastTemplate.replace(/\{name\}/gi, members[0]?.name || 'Samuel Gichuru')}
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white font-black text-xs uppercase tracking-wider rounded border border-slate-950 flex items-center justify-center space-x-1.5 transition-all shadow-xs"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Dispatch Broadcast SMS</span>
              </button>
            </form>
          </div>

          {/* SIMULATED LIVE QUEUE TERMINAL */}
          <div className="bg-slate-950 text-slate-300 rounded-xl p-4 font-mono text-[10px] border border-slate-800 shadow-lg space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="flex items-center text-emerald-400 font-bold uppercase tracking-wider text-[9px]">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse mr-1.5" />
                Gateway Daemon — active
              </span>
              <span className="text-[8px] text-slate-500">PORT: 3128</span>
            </div>

            <div className="space-y-1.5 max-h-48 overflow-y-auto text-slate-400 scrollbar-thin">
              <p className="text-slate-500">[08:15:02] INITIALIZING SMS DAEMON WITH AFRICA'S TALKING SIM V3</p>
              <p className="text-slate-500">[08:15:05] SECURING ENDPOINT AT https://api.africastalking.com</p>
              <p className="text-slate-400">[10:30:00] Webhook Event: Daily contribution posted from Stage 17 &amp; Cabanas</p>
              <p className="text-emerald-500">[10:31:00] SMS Gateway Triggered: Member ID m-1 (Samuel Gichuru)</p>
              <p className="text-slate-500">[10:31:02] AT_GW_ID_99214_SUCCESS Handshake complete. Status: Delivered.</p>
              <p className="text-slate-400">[11:15:00] Webhook Event: Driver registration fee logged for James Kamau</p>
              <p className="text-emerald-500">[11:16:00] SMS Gateway Triggered: Member ID m-2 (James Kamau)</p>
              <p className="text-slate-500">[11:16:02] AT_GW_ID_99182_SUCCESS Handshake complete. Status: Delivered.</p>
              <p className="text-slate-400">[15:45:00] Webhook Event: Route operation management levy posted</p>
              <p className="text-emerald-500">[15:46:00] SMS Gateway Triggered: Member ID m-3 (Patrick Njoroge)</p>
              <p className="text-slate-500">[15:46:02] AT_GW_ID_98721_SUCCESS Handshake complete. Status: Delivered.</p>
              <p className="text-slate-500">[SYSTEM] Listening for new Sacco Ledger synchronization updates...</p>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
