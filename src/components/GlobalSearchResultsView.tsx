import React, { useState } from 'react';
import { Member, Vehicle, Transaction } from '../types';
import { 
  Users, 
  Bus, 
  Receipt, 
  ArrowUpRight, 
  Search, 
  Sparkles, 
  FileText, 
  MapPin, 
  Phone, 
  ShieldCheck, 
  Calendar,
  CreditCard,
  UserCheck
} from 'lucide-react';

interface GlobalSearchResultsViewProps {
  query: string;
  onClearQuery: () => void;
  members: Member[];
  vehicles: Vehicle[];
  transactions: Transaction[];
  onNavigateToTab: (tab: string) => void;
}

export default function GlobalSearchResultsView({
  query,
  onClearQuery,
  members,
  vehicles,
  transactions,
  onNavigateToTab
}: GlobalSearchResultsViewProps) {
  const [activeFilter, setActiveFilter] = useState<'all' | 'members' | 'vehicles' | 'transactions'>('all');

  const normalizedQuery = query.toLowerCase().trim();

  // Highlight search terms helper
  const highlightText = (text: string | undefined, search: string) => {
    if (!text) return '';
    if (!search) return <span>{text}</span>;
    
    const parts = text.split(new RegExp(`(${search.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')})`, 'gi'));
    return (
      <span>
        {parts.map((part, index) => 
          part.toLowerCase() === search.toLowerCase() ? (
            <mark key={index} className="bg-emerald-100 text-emerald-900 font-bold px-0.5 rounded">
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </span>
    );
  };

  // 1. Filter Members
  const filteredMembers = members.filter(m => 
    m.name.toLowerCase().includes(normalizedQuery) ||
    m.phoneNumber.toLowerCase().includes(normalizedQuery) ||
    m.idNumber.toLowerCase().includes(normalizedQuery) ||
    m.status.toLowerCase().includes(normalizedQuery) ||
    (m.vehicleAssigned && m.vehicleAssigned.toLowerCase().includes(normalizedQuery))
  );

  // 2. Filter Vehicles
  const filteredVehicles = vehicles.filter(v => 
    v.plateNumber.toLowerCase().includes(normalizedQuery) ||
    v.ownerName.toLowerCase().includes(normalizedQuery) ||
    v.driverName.toLowerCase().includes(normalizedQuery) ||
    v.driverPhone.toLowerCase().includes(normalizedQuery) ||
    v.route.toLowerCase().includes(normalizedQuery) ||
    v.status.toLowerCase().includes(normalizedQuery)
  );

  // 3. Filter Transactions
  const filteredTransactions = transactions.filter(t => 
    t.refCode.toLowerCase().includes(normalizedQuery) ||
    t.description.toLowerCase().includes(normalizedQuery) ||
    t.category.toLowerCase().includes(normalizedQuery) ||
    t.amount.toString().includes(normalizedQuery) ||
    (t.memberName && t.memberName.toLowerCase().includes(normalizedQuery)) ||
    (t.vehiclePlate && t.vehiclePlate.toLowerCase().includes(normalizedQuery)) ||
    t.recorderName.toLowerCase().includes(normalizedQuery)
  );

  const totalMatches = filteredMembers.length + filteredVehicles.length + filteredTransactions.length;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-slate-50 p-4 sm:p-8 font-sans" id="global-search-results-viewport">
      {/* Search Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 border border-indigo-200 rounded text-[9px] font-mono font-bold uppercase tracking-wider">
              REAL-TIME LEDGER PARSER
            </span>
            <span className="text-[10px] text-slate-400 font-mono">Matched {totalMatches} record{totalMatches !== 1 ? 's' : ''}</span>
          </div>
          <h2 className="text-xl font-bold font-display text-slate-800 mt-1 flex items-center space-x-2">
            <span>Search Results for</span>
            <span className="text-emerald-700 font-black">"{query}"</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 leading-normal">
            Query matched across immutable registers, daily sheets, and active vehicle logs.
          </p>
        </div>
        <button
          onClick={onClearQuery}
          className="px-3.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-xl uppercase tracking-wider transition-all cursor-pointer self-start sm:self-center"
        >
          &times; Clear Search
        </button>
      </div>

      {/* Filter Tabs / Pills */}
      <div className="flex flex-wrap gap-2 mb-6 border-b border-slate-200 pb-4">
        <button
          onClick={() => setActiveFilter('all')}
          className={`px-4 py-2 text-xs font-bold rounded-xl transition-all uppercase tracking-wider cursor-pointer border ${
            activeFilter === 'all'
              ? 'bg-slate-900 border-slate-900 text-white shadow-xs'
              : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-600'
          }`}
        >
          🌟 All Results ({totalMatches})
        </button>
        <button
          onClick={() => setActiveFilter('members')}
          className={`px-4 py-2 text-xs font-bold rounded-xl transition-all uppercase tracking-wider cursor-pointer border flex items-center space-x-1.5 ${
            activeFilter === 'members'
              ? 'bg-slate-900 border-slate-900 text-white shadow-xs'
              : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-600'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Members ({filteredMembers.length})</span>
        </button>
        <button
          onClick={() => setActiveFilter('vehicles')}
          className={`px-4 py-2 text-xs font-bold rounded-xl transition-all uppercase tracking-wider cursor-pointer border flex items-center space-x-1.5 ${
            activeFilter === 'vehicles'
              ? 'bg-slate-900 border-slate-900 text-white shadow-xs'
              : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-600'
          }`}
        >
          <Bus className="w-3.5 h-3.5" />
          <span>Vehicles ({filteredVehicles.length})</span>
        </button>
        <button
          onClick={() => setActiveFilter('transactions')}
          className={`px-4 py-2 text-xs font-bold rounded-xl transition-all uppercase tracking-wider cursor-pointer border flex items-center space-x-1.5 ${
            activeFilter === 'transactions'
              ? 'bg-slate-900 border-slate-900 text-white shadow-xs'
              : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-600'
          }`}
        >
          <Receipt className="w-3.5 h-3.5" />
          <span>Transactions ({filteredTransactions.length})</span>
        </button>
      </div>

      {/* Empty State */}
      {totalMatches === 0 && (
        <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center max-w-lg mx-auto my-12 shadow-[0_8px_30px_rgb(0,0,0,0.015)] space-y-4" id="search-empty-state">
          <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto border border-slate-200/60">
            <Search className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-800 uppercase tracking-wider font-display">No Matches Found</h3>
            <p className="text-xs text-slate-500 leading-relaxed max-w-sm mx-auto">
              We scanned the Sacco registries, vehicle records, and transactions ledger but couldn't find matches for "{query}".
            </p>
          </div>
          <div className="bg-slate-50 border border-slate-150 rounded-2xl p-4 text-left space-y-2">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">💡 Search Tips:</h4>
            <ul className="text-[11px] text-slate-600 list-disc list-inside space-y-1">
              <li>Check your spelling (e.g. "Matatu", "Ref").</li>
              <li>Search for exact license plates like <code className="bg-slate-200 text-slate-800 px-1 py-0.5 rounded font-mono">KCJ</code>.</li>
              <li>Search for transaction bank references like <code className="bg-slate-200 text-slate-800 px-1 py-0.5 rounded font-mono">QRT</code>.</li>
              <li>Filter by status e.g. <code className="bg-slate-200 text-slate-800 px-1 py-0.5 rounded font-mono">Active</code> or category names.</li>
            </ul>
          </div>
        </div>
      )}

      {/* Grid of Results */}
      {totalMatches > 0 && (
        <div className="space-y-8">
          
          {/* Members Subsection */}
          {(activeFilter === 'all' || activeFilter === 'members') && filteredMembers.length > 0 && (
            <div className="space-y-3" id="search-section-members">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 font-mono flex items-center space-x-1.5">
                <Users className="w-4 h-4 text-emerald-600" />
                <span>Sacco Members Registry ({filteredMembers.length})</span>
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredMembers.map(member => (
                  <div key={member.id} className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-emerald-600 hover:shadow-md transition-all flex flex-col justify-between space-y-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-mono font-bold text-slate-400 uppercase">ID: {member.id}</span>
                        <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full ${
                          member.status === 'Active' ? 'bg-emerald-100 text-emerald-800' :
                          member.status === 'Pending' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {member.status.toUpperCase()}
                        </span>
                      </div>
                      <h4 className="text-sm font-bold text-slate-800 font-display">
                        {highlightText(member.name, query)}
                      </h4>
                      <div className="space-y-1 text-xs text-slate-500">
                        <p className="flex items-center">
                          <Phone className="w-3.5 h-3.5 text-slate-400 mr-2 shrink-0" />
                          <span>{highlightText(member.phoneNumber, query)}</span>
                        </p>
                        <p className="flex items-center">
                          <CreditCard className="w-3.5 h-3.5 text-slate-400 mr-2 shrink-0" />
                          <span>National ID: {highlightText(member.idNumber, query)}</span>
                        </p>
                        {member.vehicleAssigned && (
                          <p className="flex items-center">
                            <Bus className="w-3.5 h-3.5 text-slate-400 mr-2 shrink-0" />
                            <span>Assigned: <strong className="font-mono text-slate-700 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-150">{highlightText(member.vehicleAssigned, query)}</strong></span>
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-100 text-center">
                      <div>
                        <span className="text-[9px] uppercase font-bold text-slate-400 block font-mono">Shares Pool</span>
                        <span className="text-xs font-extrabold text-slate-700">Ksh {member.sharesAmount.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-[9px] uppercase font-bold text-slate-400 block font-mono">Savings Balance</span>
                        <span className="text-xs font-extrabold text-emerald-700">Ksh {member.savingsAmount.toLocaleString()}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => onNavigateToTab('Members')}
                      className="w-full py-2 bg-slate-55 bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-200 hover:border-emerald-200 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center space-x-1 cursor-pointer"
                    >
                      <span>Go to Directory</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Vehicles Subsection */}
          {(activeFilter === 'all' || activeFilter === 'vehicles') && filteredVehicles.length > 0 && (
            <div className="space-y-3" id="search-section-vehicles">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 font-mono flex items-center space-x-1.5">
                <Bus className="w-4 h-4 text-indigo-600" />
                <span>Active Sacco Fleet ({filteredVehicles.length})</span>
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredVehicles.map(vehicle => (
                  <div key={vehicle.id} className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-indigo-600 hover:shadow-md transition-all flex flex-col justify-between space-y-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black font-mono text-indigo-900 bg-indigo-50 border border-indigo-100 px-2.5 py-0.5 rounded-lg">
                          {highlightText(vehicle.plateNumber, query)}
                        </span>
                        <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full ${
                          vehicle.status === 'Active' ? 'bg-emerald-100 text-emerald-800' :
                          vehicle.status === 'Maintenance' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                        }`}>
                          {vehicle.status.toUpperCase()}
                        </span>
                      </div>
                      
                      <div className="space-y-1 text-xs text-slate-500 pt-1">
                        <p className="flex items-center">
                          <Users className="w-3.5 h-3.5 text-slate-400 mr-2 shrink-0" />
                          <span>Owner: <strong className="text-slate-700">{highlightText(vehicle.ownerName, query)}</strong></span>
                        </p>
                        <p className="flex items-center">
                          <UserCheck className="w-3.5 h-3.5 text-slate-400 mr-2 shrink-0" />
                          <span>Driver: <strong className="text-slate-700">{highlightText(vehicle.driverName, query)}</strong> ({highlightText(vehicle.driverPhone, query)})</span>
                        </p>
                        <p className="flex items-center">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 mr-2 shrink-0" />
                          <span>Route: {highlightText(vehicle.route, query)}</span>
                        </p>
                        <p className="flex items-center">
                          <FileText className="w-3.5 h-3.5 text-slate-400 mr-2 shrink-0" />
                          <span>Seating Capacity: <strong className="text-slate-700">{vehicle.capacity} Seater</strong></span>
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => onNavigateToTab('Fleet')}
                      className="w-full py-2 bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center space-x-1 cursor-pointer"
                    >
                      <span>View Fleet Panel</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Transactions Subsection */}
          {(activeFilter === 'all' || activeFilter === 'transactions') && filteredTransactions.length > 0 && (
            <div className="space-y-3" id="search-section-transactions">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 font-mono flex items-center space-x-1.5">
                <Receipt className="w-4 h-4 text-amber-600" />
                <span>Immune Ledger Registry ({filteredTransactions.length})</span>
              </h3>
              
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.01)]">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-mono uppercase text-[9px] font-black tracking-wider">
                        <th className="p-4">Reference / Date</th>
                        <th className="p-4">Entity</th>
                        <th className="p-4">Category / Desc</th>
                        <th className="p-4">Audited By</th>
                        <th className="p-4 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredTransactions.map(tx => (
                        <tr key={tx.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="p-4 space-y-1">
                            <span className="font-mono font-bold text-slate-800 bg-slate-100 border border-slate-200/60 px-2 py-0.5 rounded text-[10px] uppercase block w-fit">
                              {highlightText(tx.refCode, query)}
                            </span>
                            <span className="text-[10px] text-slate-400 block font-mono">
                              {new Date(tx.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </td>
                          <td className="p-4 space-y-1">
                            {tx.memberName && (
                              <p className="font-semibold text-slate-700 flex items-center">
                                <Users className="w-3.5 h-3.5 text-slate-400 mr-1.5 shrink-0" />
                                <span>{highlightText(tx.memberName, query)}</span>
                              </p>
                            )}
                            {tx.vehiclePlate && (
                              <p className="text-[10px] font-mono text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded w-fit uppercase font-black">
                                {highlightText(tx.vehiclePlate, query)}
                              </p>
                            )}
                            {!tx.memberName && !tx.vehiclePlate && (
                              <span className="text-slate-400 font-mono text-[10px]">Sacco Central</span>
                            )}
                          </td>
                          <td className="p-4 space-y-1">
                            <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                              tx.type === 'Credit' 
                                ? 'bg-emerald-100 text-emerald-800' 
                                : 'bg-rose-100 text-rose-800'
                            }`}>
                              {highlightText(tx.category, query)}
                            </span>
                            <p className="text-[11px] text-slate-500 max-w-xs truncate" title={tx.description}>
                              {highlightText(tx.description, query)}
                            </p>
                          </td>
                          <td className="p-4">
                            <span className="text-[10px] font-medium text-slate-600 block">
                              {highlightText(tx.recorderName, query)}
                            </span>
                            <span className="text-[8px] font-mono text-slate-400 uppercase tracking-widest block font-bold">
                              {tx.tillNumber === 'VehicleTill' ? '🏦 OPERATIONS 48277' : tx.tillNumber === 'UtilityTill' ? '💰 SAVINGS 871671' : '💼 CASH DRAWER'}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            <span className={`font-mono font-bold text-sm ${
                              tx.type === 'Credit' ? 'text-emerald-700' : 'text-rose-600'
                            }`}>
                              {tx.type === 'Credit' ? '+' : '-'} Ksh {highlightText(tx.amount.toLocaleString(), query)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
