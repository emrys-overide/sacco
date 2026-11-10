import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  X,
  PhoneCall,
  CheckCircle2,
  AlertCircle,
  Clock,
  Bus,
  User,
  Phone,
  Calendar,
  Layers,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  Receipt,
  UserRound,
  BadgeCheck
} from 'lucide-react';
import { Member, Vehicle, VehicleClass, Transaction } from '../types';

interface CollectionPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: string;
  vehicles: Vehicle[];
  members: Member[];
  token?: string;
  initialRow?: {
    no?: number;
    vehiclePlate?: string;
    vehicleClass?: VehicleClass;
    operation?: number;
    entranceFee?: number;
    loanRepay?: number;
    savings?: number;
    sTicket?: number;
    legalFee?: number;
    transactionId?: string;
  } | null;
  onComplete: (savedTransaction: Omit<Transaction, 'id' | 'recorderName'>) => Promise<void>;
}

export const CollectionPaymentModal: React.FC<CollectionPaymentModalProps> = ({
  isOpen,
  onClose,
  selectedDate,
  vehicles,
  members,
  token,
  initialRow,
  onComplete
}) => {
  const [entryDate, setEntryDate] = useState<string>(selectedDate || new Date().toISOString().slice(0, 10));
  const [vehiclePlate, setVehiclePlate] = useState<string>('');
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>('Nissan');
  const [memberId, setMemberId] = useState<string>('');
  const [memberName, setMemberName] = useState<string>('');
  const [phoneNumber, setPhoneNumber] = useState<string>('');

  // Table breakdown fields
  const [operationAmount, setOperationAmount] = useState<number>(0);
  const [entranceFee, setEntranceFee] = useState<number>(0);
  const [loanRepay, setLoanRepay] = useState<number>(0);
  const [savingsContribution, setSavingsContribution] = useState<number>(0);
  const [sTicket, setSTicket] = useState<number>(0);
  const [legalFee, setLegalFee] = useState<number>(0);

  const [paymentMethod, setPaymentMethod] = useState<'STK' | 'DIRECT'>('STK');
  const [directRefCode, setDirectRefCode] = useState<string>('');

  // STK State
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [activeCheckoutId, setActiveCheckoutId] = useState<string | null>(null);
  const [stkStatus, setStkStatus] = useState<{
    status: 'PENDING' | 'SUCCESS' | 'FAILED';
    receiptNumber?: string;
    description?: string;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Synchronize when opened or initialRow changes
  useEffect(() => {
    if (isOpen) {
      setEntryDate(selectedDate || new Date().toISOString().slice(0, 10));
      setErrorMessage('');
      setActiveCheckoutId(null);
      setStkStatus(null);
      setIsSubmitting(false);

      if (initialRow) {
        const rowPlate = (initialRow.vehiclePlate || '').trim();
        setVehiclePlate(rowPlate);
        setVehicleClass(initialRow.vehicleClass || (rowPlate ? 'Nissan' : 'Member Contribution'));
        setOperationAmount(initialRow.operation || 0);
        setEntranceFee(initialRow.entranceFee || 0);
        setLoanRepay(initialRow.loanRepay || 0);
        setSavingsContribution(initialRow.savings || 0);
        setSTicket(initialRow.sTicket || 0);
        setLegalFee(initialRow.legalFee || 0);

        // Attempt to find owner
        if (rowPlate) {
          const matchedVeh = vehicles.find(v => v.plateNumber === rowPlate);
          if (matchedVeh && matchedVeh.ownerId) {
            const owner = members.find(m => m.id === matchedVeh.ownerId);
            if (owner) {
              setMemberId(owner.id);
              setMemberName(owner.name);
              setPhoneNumber(owner.phoneNumber || '');
            }
          }
        } else {
          const rowMemId = (initialRow as any).memberId;
          const rowMemName = (initialRow as any).memberName;
          const matchedMem = members.find(m => m.id === rowMemId || m.name.toLowerCase() === (rowMemName || '').toLowerCase());
          if (matchedMem) {
            setMemberId(matchedMem.id);
            setMemberName(matchedMem.name);
            setPhoneNumber(matchedMem.phoneNumber || '');
          } else if (rowMemName) {
            setMemberName(rowMemName);
          }
        }
      } else {
        // Defaults: Member-first design
        if (members[0]) {
          setMemberId(members[0].id);
          setMemberName(members[0].name);
          setPhoneNumber(members[0].phoneNumber || '');
          const ownerVeh = vehicles.find(v => v.ownerId === members[0].id || v.plateNumber === members[0].vehicleAssigned);
          if (ownerVeh) {
            setVehiclePlate(ownerVeh.plateNumber);
            setVehicleClass(ownerVeh.capacity && ownerVeh.capacity > 7 ? 'Nissan' : 'Sienta');
          } else {
            setVehiclePlate('');
            setVehicleClass('Member Contribution');
          }
        } else if (vehicles[0]) {
          setVehiclePlate(vehicles[0].plateNumber);
          setVehicleClass(vehicles[0].capacity && vehicles[0].capacity > 7 ? 'Nissan' : 'Sienta');
          const owner = members.find(m => m.id === vehicles[0].ownerId);
          if (owner) {
            setMemberId(owner.id);
            setMemberName(owner.name);
            setPhoneNumber(owner.phoneNumber || '');
          }
        } else {
          setVehiclePlate('');
          setVehicleClass('Member Contribution');
        }
        setOperationAmount(400);
        setEntranceFee(0);
        setLoanRepay(0);
        setSavingsContribution(500);
        setSTicket(0);
        setLegalFee(0);
      }
    }
  }, [isOpen, initialRow, selectedDate, vehicles, members]);

  // Handle vehicle plate selection change
  const handleVehicleChange = (plate: string) => {
    const cleanPlate = plate.toUpperCase().trim();
    setVehiclePlate(cleanPlate);
    if (cleanPlate) {
      const matched = vehicles.find(v => v.plateNumber.replace(/\s+/g, '').toUpperCase() === cleanPlate.replace(/\s+/g, ''));
      if (matched) {
        setVehicleClass(matched.capacity && matched.capacity > 7 ? 'Nissan' : 'Sienta');
        const owner = members.find(m => m.id === matched.ownerId);
        if (owner) {
          setMemberId(owner.id);
          setMemberName(owner.name);
          setPhoneNumber(owner.phoneNumber || '');
        }
      }
    } else {
      setVehicleClass('Member Contribution');
    }
  };

  const handleClearVehicle = () => {
    setVehiclePlate('');
    setVehicleClass('Member Contribution');
  };

  // Handle member selection change
  const handleMemberChange = (id: string) => {
    setMemberId(id);
    const matched = members.find(m => m.id === id);
    if (matched) {
      setMemberName(matched.name);
      setPhoneNumber(matched.phoneNumber || '');
      // If member has a vehicle, auto-fill it; otherwise clear plate and switch to Member Contribution
      const ownerVeh = vehicles.find(v => v.ownerId === matched.id || v.plateNumber === matched.vehicleAssigned);
      if (ownerVeh) {
        setVehiclePlate(ownerVeh.plateNumber);
        setVehicleClass(ownerVeh.capacity && ownerVeh.capacity > 7 ? 'Nissan' : 'Sienta');
      } else {
        setVehiclePlate('');
        setVehicleClass('Member Contribution');
      }
    } else {
      setMemberName('');
    }
  };

  // Dynamic total sum of every table field
  const totalAmount =
    Number(operationAmount || 0) +
    Number(entranceFee || 0) +
    Number(loanRepay || 0) +
    Number(savingsContribution || 0) +
    Number(sTicket || 0) +
    Number(legalFee || 0);

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
            if (data.transaction.status === 'SUCCESS') {
              const receipt = data.transaction.mpesaReceiptNumber || `REC_${activeCheckoutId.slice(-6)}`;
              setStkStatus({
                status: 'SUCCESS',
                receiptNumber: receipt,
                description: 'Payment verified and confirmed by Safaricom.'
              });
              clearInterval(interval);

              // Auto-book to daily ledger table
              const cleanPlate = vehiclePlate.trim();
              const payer = memberName.trim() || 'Registered Member';
              const autoDesc = cleanPlate
                ? `Daily collection for ${payer} - ${cleanPlate} (${vehicleClass}) [${receipt}]`
                : `Daily contribution for ${payer} (${vehicleClass}) [${receipt}]`;

              await onComplete({
                timestamp: `${entryDate}T${new Date().toTimeString().slice(0, 8)}.000Z`,
                type: 'Credit',
                category: 'Daily Contribution',
                amount: totalAmount,
                memberId: memberId || undefined,
                memberName: memberName.trim() || undefined,
                vehiclePlate: cleanPlate || undefined,
                vehicleClass,
                operationAmount,
                entranceFee,
                loanRepay,
                savingsContribution,
                sTicket,
                legalFee,
                refCode: receipt,
                description: autoDesc,
                tillNumber: 'VehicleTill'
              });
            } else if (data.transaction.status === 'FAILED' || data.transaction.status === 'EXPIRED_UNPAID') {
              setStkStatus({
                status: 'FAILED',
                description: data.transaction.resultDescription || 'Transaction was cancelled or declined on handset.'
              });
              clearInterval(interval);
            }
          }
        }
      } catch (err) {
        console.error('Error polling STK status:', err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [
    activeCheckoutId,
    stkStatus,
    token,
    entryDate,
    totalAmount,
    memberId,
    memberName,
    vehiclePlate,
    vehicleClass,
    operationAmount,
    entranceFee,
    loanRepay,
    savingsContribution,
    sTicket,
    legalFee,
    onComplete
  ]);

  if (!isOpen) return null;

  const handlePayClick = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!memberName.trim() && !memberId) {
      setErrorMessage('Please select a member or enter the payer name.');
      return;
    }
    if (totalAmount <= 0) {
      setErrorMessage('Total payable amount must be greater than KES 0.');
      return;
    }

    if (paymentMethod === 'STK') {
      const cleanPhone = (phoneNumber || '').replace(/[^\d+]/g, '');
      if (!cleanPhone || cleanPhone.length < 9) {
        setErrorMessage('Please provide a valid member mobile phone number for M-Pesa STK Push.');
        return;
      }

      setIsSubmitting(true);
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const cleanPlate = vehiclePlate.trim();
        const payer = memberName.trim() || 'MEMBER';
        const accRef = cleanPlate
          ? cleanPlate.replace(/\s+/g, '').slice(0, 12)
          : payer.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);

        const res = await fetch('/api/v1/mpesa/stk-push', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            memberId: memberId || 'mem-direct',
            transactionType: loanRepay > 0 ? 'LOAN_REPAYMENT' : 'SAVINGS',
            accountReference: accRef,
            vehiclePlate: cleanPlate || undefined,
            payerName: payer,
            amount: totalAmount,
            phoneNumber: cleanPhone
          })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || data.message || 'Failed to initiate M-Pesa STK prompt.');
        }

        setActiveCheckoutId(data.checkoutRequestId);
        setStkStatus({ status: 'PENDING', description: 'M-Pesa STK PIN prompt sent to handset.' });
      } catch (err: any) {
        setErrorMessage(err.message || 'Error initiating M-Pesa STK payment.');
      } finally {
        setIsSubmitting(false);
      }
    } else {
      // Direct Reference / Cash Booking
      const ref = directRefCode.trim() || `CASH-${Date.now().toString().slice(-6)}`;
      setIsSubmitting(true);
      try {
        const cleanPlate = vehiclePlate.trim();
        const payer = memberName.trim() || 'Registered Member';
        const directDesc = cleanPlate
          ? `Daily collection for ${payer} - ${cleanPlate} (${vehicleClass}) [${ref}]`
          : `Daily contribution for ${payer} (${vehicleClass}) [${ref}]`;

        await onComplete({
          timestamp: `${entryDate}T${new Date().toTimeString().slice(0, 8)}.000Z`,
          type: 'Credit',
          category: 'Daily Contribution',
          amount: totalAmount,
          memberId: memberId || undefined,
          memberName: memberName.trim() || undefined,
          vehiclePlate: cleanPlate || undefined,
          vehicleClass,
          operationAmount,
          entranceFee,
          loanRepay,
          savingsContribution,
          sTicket,
          legalFee,
          refCode: ref,
          description: directDesc,
          tillNumber: 'VehicleTill'
        });
        onClose();
      } catch (err: any) {
        setErrorMessage(err.message || 'Failed to save collection to ledger.');
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs animate-fade-in">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-emerald-950/20 bg-gradient-to-r from-emerald-800 via-emerald-700 to-teal-800 px-6 py-4 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 backdrop-blur-md">
              <CreditCard className="h-5 w-5 text-emerald-300" />
            </div>
            <div>
              <h3 className="font-black text-base tracking-wide">Daily Collection Payment Form</h3>
              <p className="text-xs text-emerald-200/80">Itemized table details &amp; direct M-Pesa settlement</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-emerald-100 hover:bg-white/10 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-slate-50">
          
          {/* Active Handset STK Prompt Banner */}
          {activeCheckoutId && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm animate-fade-in">
              <div className="flex items-center gap-3.5">
                <div
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
                    stkStatus?.status === 'SUCCESS'
                      ? 'bg-emerald-100 text-emerald-700'
                      : stkStatus?.status === 'FAILED'
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-amber-100 text-amber-700 animate-pulse'
                  }`}
                >
                  {stkStatus?.status === 'SUCCESS' ? (
                    <CheckCircle2 className="h-6 w-6" />
                  ) : stkStatus?.status === 'FAILED' ? (
                    <AlertCircle className="h-6 w-6" />
                  ) : (
                    <Clock className="h-6 w-6 animate-spin" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-bold text-slate-900">
                    {stkStatus?.status === 'SUCCESS'
                      ? 'Payment Confirmed & Saved to Table!'
                      : stkStatus?.status === 'FAILED'
                      ? 'M-Pesa STK Declined or Expired'
                      : 'Enter M-Pesa PIN on Member Phone'}
                  </h4>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {stkStatus?.status === 'SUCCESS'
                      ? `Receipt: ${stkStatus.receiptNumber}. Ledger entry successfully updated.`
                      : stkStatus?.status === 'FAILED'
                      ? stkStatus.description || 'Request was cancelled or timed out.'
                      : `A prompt of KES ${totalAmount.toLocaleString()} has been sent to ${phoneNumber}. Please complete the transaction.`}
                  </p>
                </div>
              </div>

              {stkStatus?.status === 'SUCCESS' && (
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 transition-colors shadow-sm"
                  >
                    Done &amp; Return to Table
                  </button>
                </div>
              )}

              {stkStatus?.status === 'FAILED' && (
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveCheckoutId(null);
                      setStkStatus(null);
                    }}
                    className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    Retry Payment
                  </button>
                </div>
              )}
            </div>
          )}

          {errorMessage && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Form Content (Disabled when waiting for STK) */}
          <form onSubmit={handlePayClick} className={`space-y-5 ${activeCheckoutId && stkStatus?.status === 'PENDING' ? 'opacity-50 pointer-events-none' : ''}`}>
            
            {/* Section 1: Member & Optional Vehicle Identifiers */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-xs font-bold uppercase tracking-wider text-slate-700">
                <span className="flex items-center gap-1.5">
                  <UserRound className="h-4 w-4 text-emerald-600" />
                  <span>Contributor &amp; Vehicle Identification</span>
                </span>
                <span className="text-[10px] text-slate-400 font-normal">
                  {vehiclePlate ? 'Vehicle & Owner Linked' : 'Direct Member Contribution'}
                </span>
              </div>

              {/* Row 1: Member / Contributor Name (Permanent & Primary) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-bold uppercase text-slate-700">
                    1. Member / Payer Name <span className="text-rose-500">* (Required)</span>
                  </label>
                  {memberId ? (
                    <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-800 flex items-center gap-1">
                      <BadgeCheck className="h-3 w-3 text-emerald-600" />
                      Active Member Record
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold text-slate-400">
                      Select or type below
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select
                    value={memberId}
                    onChange={e => handleMemberChange(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-emerald-600 focus:outline-none"
                  >
                    <option value="">-- Select Member from Directory --</option>
                    {members.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.membershipNumber || 'Member'}) {m.phoneNumber ? `• ${m.phoneNumber}` : ''}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={memberName}
                    onChange={e => {
                      setMemberName(e.target.value);
                      if (!e.target.value) setMemberId('');
                    }}
                    placeholder="Or type payer / owner name"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-emerald-600 focus:outline-none"
                    required
                  />
                </div>

                {/* Quick Fleet Tag for selected member */}
                {(() => {
                  const memberVehicles = vehicles.filter(v => v.ownerId === memberId || (memberId && members.find(m => m.id === memberId)?.vehicleAssigned === v.plateNumber));
                  if (memberVehicles.length > 0) {
                    return (
                      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-bold text-slate-500 uppercase">Registered Fleet:</span>
                        {memberVehicles.map(v => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => handleVehicleChange(v.plateNumber)}
                            className={`rounded-md px-2 py-0.5 text-[10px] font-bold font-mono transition cursor-pointer ${
                              vehiclePlate.toUpperCase() === v.plateNumber.toUpperCase()
                                ? 'bg-emerald-600 text-white shadow-xs'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                          >
                            🚗 {v.plateNumber}
                          </button>
                        ))}
                        {vehiclePlate && (
                          <button
                            type="button"
                            onClick={handleClearVehicle}
                            className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 hover:text-slate-800"
                          >
                            ✕ Detach Vehicle
                          </button>
                        )}
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>

              {/* Row 2: Vehicle Plate (Optional) + Contribution Type + Collection Date */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                {/* Vehicle Plate */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-bold uppercase text-slate-600">
                      Vehicle Plate <span className="text-slate-400 font-normal">(Optional)</span>
                    </label>
                    {vehiclePlate && (
                      <button
                        type="button"
                        onClick={handleClearVehicle}
                        className="text-[10px] font-bold text-rose-500 hover:underline cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Bus className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      list="registered-plates"
                      value={vehiclePlate}
                      onChange={e => handleVehicleChange(e.target.value.toUpperCase())}
                      placeholder="Optional plate"
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-3 text-xs font-bold uppercase font-mono text-slate-900 focus:border-emerald-600 focus:outline-none"
                    />
                  </div>
                  <datalist id="registered-plates">
                    {vehicles.map(v => (
                      <option key={v.id} value={v.plateNumber}>
                        {v.ownerName ? `${v.plateNumber} - ${v.ownerName}` : v.plateNumber}
                      </option>
                    ))}
                  </datalist>
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    {vehiclePlate ? 'Attached to vehicle' : 'No vehicle — direct member contribution'}
                  </p>
                </div>

                {/* Contribution Type / Fleet Class */}
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Contribution Type</label>
                  <select
                    value={vehicleClass}
                    onChange={e => setVehicleClass(e.target.value as VehicleClass)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-emerald-600 focus:outline-none"
                  >
                    <option value="Nissan">Nissan (14s)</option>
                    <option value="Sienta">Sienna (7s)</option>
                    <option value="Member Contribution">Member Contribution (No Vehicle)</option>
                  </select>
                </div>

                {/* Date */}
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Collection Date</label>
                  <input
                    type="date"
                    value={entryDate}
                    onChange={e => setEntryDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-emerald-600 focus:outline-none"
                    required
                  />
                </div>
              </div>

              {/* Row 3: Payer M-Pesa Phone */}
              <div className="pt-1">
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Payer M-Pesa Phone <span className="text-slate-400 font-normal">(for STK push)</span>
                </label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={phoneNumber}
                    onChange={e => setPhoneNumber(e.target.value)}
                    placeholder="e.g. 0712345678"
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-3 text-xs font-bold font-mono text-slate-900 focus:border-emerald-600 focus:outline-none"
                    required={paymentMethod === 'STK'}
                  />
                </div>
              </div>
            </div>

            {/* Section 2: Detailed Table Amounts Breakdown */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-xs font-bold uppercase tracking-wider text-slate-700">
                <span className="flex items-center gap-1.5">
                  <Receipt className="h-4 w-4 text-emerald-600" />
                  <span>Itemized Collection Breakdown (Table Columns)</span>
                </span>
                <span className="text-[10px] text-slate-400 font-normal lowercase">enter numbers in KES</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {/* 1. Operation */}
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">Operation</label>
                  <input
                    type="number"
                    min="0"
                    value={operationAmount || ''}
                    onChange={e => setOperationAmount(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    placeholder="0"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono font-bold text-slate-900 text-right focus:border-emerald-600 focus:outline-none"
                  />
                </div>

                {/* 2. Entrance Fee */}
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">Entrance Fee</label>
                  <input
                    type="number"
                    min="0"
                    value={entranceFee || ''}
                    onChange={e => setEntranceFee(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    placeholder="0"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono font-bold text-slate-900 text-right focus:border-emerald-600 focus:outline-none"
                  />
                </div>

                {/* 3. Loan Repay */}
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">Loan Repay</label>
                  <input
                    type="number"
                    min="0"
                    value={loanRepay || ''}
                    onChange={e => setLoanRepay(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    placeholder="0"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono font-bold text-slate-900 text-right focus:border-emerald-600 focus:outline-none"
                  />
                </div>

                {/* 4. Savings */}
                <div>
                  <label className="block text-[10px] font-bold uppercase text-blue-700 mb-1">Savings</label>
                  <input
                    type="number"
                    min="0"
                    value={savingsContribution || ''}
                    onChange={e => setSavingsContribution(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    placeholder="0"
                    className="w-full rounded-lg border border-blue-200 bg-blue-50/40 px-3 py-2 text-xs font-mono font-bold text-blue-900 text-right focus:border-emerald-600 focus:outline-none"
                  />
                </div>

                {/* 5. S-Ticket */}
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">S/Ticket</label>
                  <input
                    type="number"
                    min="0"
                    value={sTicket || ''}
                    onChange={e => setSTicket(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    placeholder="0"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono font-bold text-slate-900 text-right focus:border-emerald-600 focus:outline-none"
                  />
                </div>

                {/* 6. Legal Fee */}
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">Legal Fee</label>
                  <input
                    type="number"
                    min="0"
                    value={legalFee || ''}
                    onChange={e => setLegalFee(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    placeholder="0"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono font-bold text-slate-900 text-right focus:border-emerald-600 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Section 3: Payment Method & Dynamic Total Banner */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200/60 pb-2">
                <span className="text-xs font-bold uppercase text-emerald-900">Payment Option</span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-emerald-950 cursor-pointer">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="STK"
                      checked={paymentMethod === 'STK'}
                      onChange={() => setPaymentMethod('STK')}
                      className="text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>M-Pesa STK Push</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-emerald-950 cursor-pointer">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="DIRECT"
                      checked={paymentMethod === 'DIRECT'}
                      onChange={() => setPaymentMethod('DIRECT')}
                      className="text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>Direct Ref / Cash</span>
                  </label>
                </div>
              </div>

              {paymentMethod === 'DIRECT' && (
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">Receipt / Voucher Ref Code</label>
                  <input
                    type="text"
                    value={directRefCode}
                    onChange={e => setDirectRefCode(e.target.value.toUpperCase())}
                    placeholder="e.g. BNK-001 or VOUCHER-45"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-mono font-bold uppercase text-slate-900 focus:border-emerald-600 focus:outline-none"
                  />
                </div>
              )}

              {/* Total Calculation Display */}
              <div className="flex items-center justify-between pt-1">
                <div>
                  <span className="text-xs font-bold text-slate-600 block">TOTAL SUM PAYABLE</span>
                  <span className="text-[10px] text-slate-400">Sum of Operation, Savings, Loan &amp; Fees</span>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-black font-mono text-emerald-900">
                    KES {totalAmount.toLocaleString('en-KE')}
                  </span>
                </div>
              </div>
            </div>

            {/* Submit / Pay Button */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              
              <button
                type="submit"
                disabled={isSubmitting || totalAmount <= 0}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-700 to-teal-800 px-6 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-md hover:from-emerald-800 hover:to-teal-900 transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <PhoneCall className="h-4 w-4 text-emerald-300" />
                    <span>Pay KES {totalAmount.toLocaleString('en-KE')}</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
