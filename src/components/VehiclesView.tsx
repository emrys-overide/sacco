import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Vehicle, Member, UserRole } from '../types';
import { Search, Bus, PlusCircle, Wrench, Ban, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface VehiclesViewProps {
  vehicles: Vehicle[];
  members: Member[];
  onAddVehicle: (newVehicle: Omit<Vehicle, 'id'>) => void;
  currentUserRole: UserRole;
}

export default function VehiclesView({ vehicles, members, onAddVehicle, currentUserRole }: VehiclesViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [routeFilter, setRouteFilter] = useState('All');
  const [showAddModal, setShowAddModal] = useState(false);

  // New Vehicle form state
  const [plateNumber, setPlateNumber] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [route, setRoute] = useState('Nairobi - Thika (Route 237)');
  const [capacity, setCapacity] = useState<14 | 33 | 50>(14);
  const [error, setError] = useState('');

  // Role validation
  const canRegister = currentUserRole === 'Chairman' || currentUserRole === 'Secretary';

  // Extract unique routes for filtering
  const uniqueRoutes = ['All', ...Array.from(new Set(vehicles.map(v => v.route)))];

  const filteredVehicles = vehicles.filter(vehicle => {
    const matchesSearch = vehicle.plateNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          vehicle.driverName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          vehicle.ownerName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRoute = routeFilter === 'All' || vehicle.route === routeFilter;
    return matchesSearch && matchesRoute;
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!plateNumber.trim() || !ownerId || !driverName.trim() || !driverPhone.trim()) {
      setError('Please fill in all required fields.');
      return;
    }

    const owner = members.find(m => m.id === ownerId);
    if (!owner) {
      setError('Selected owner is invalid.');
      return;
    }

    // Plate format simulation check e.g. KAA 000A or KCJ 402X
    const plateRegex = /^[Kk][A-Dd][A-Zz]\s?\d{3}[A-Zz]$/;
    if (!plateRegex.test(plateNumber.trim())) {
      setError('Invalid Kenyan plate number format (e.g. KCJ 402X or KBB 112L).');
      return;
    }

    onAddVehicle({
      plateNumber: plateNumber.toUpperCase().trim(),
      ownerId,
      ownerName: owner.name,
      driverName: driverName.trim(),
      driverPhone: driverPhone.trim(),
      route,
      status: 'Active',
      capacity
    });

    // Reset Form
    setPlateNumber('');
    setOwnerId('');
    setDriverName('');
    setDriverPhone('');
    setRoute('Nairobi - Thika (Route 237)');
    setCapacity(14);
    setError('');
    setShowAddModal(false);
  };

  const getStatusBadge = (status: Vehicle['status']) => {
    switch (status) {
      case 'Active':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Active
          </span>
        );
      case 'Maintenance':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-50 text-amber-700 border border-amber-200">
            <Wrench className="w-3 h-3 mr-1" />
            Maintenance
          </span>
        );
      case 'Suspended':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-50 text-rose-700 border border-rose-200">
            <Ban className="w-3 h-3 mr-1" />
            Suspended
          </span>
        );
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="flex-1 p-4 sm:p-8 overflow-y-auto bg-slate-50 font-sans flex flex-col space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-slate-200 gap-4">
        <div>
          <h2 className="text-xl font-bold font-display text-slate-800">Vehicle Fleet Register</h2>
          <p className="text-xs text-slate-500">Track active matatus, routes, drivers, and capacity configurations</p>
        </div>

        {canRegister ? (
          <button
            onClick={() => setShowAddModal(true)}
            id="open-register-vehicle-modal"
            className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded uppercase tracking-wider flex items-center space-x-2 shadow-sm self-start md:self-auto"
          >
            <Bus className="w-4 h-4" />
            <span>Onboard New Matatu</span>
          </button>
        ) : (
          <div className="text-[11px] bg-amber-50 border border-amber-200 text-amber-800 px-3 py-1.5 rounded self-start md:self-auto">
            Role <strong>{currentUserRole}</strong> does not have vehicle registration rights.
          </div>
        )}
      </div>

      {/* Fleet Controls */}
      <div className="bg-white p-4 rounded-lg border border-slate-200 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-72">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
            <Search className="w-4 h-4" />
          </span>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded text-xs bg-slate-50 focus:outline-none focus:border-emerald-600 focus:bg-white"
          />
        </div>

        <div className="flex space-x-2 overflow-x-auto w-full md:w-auto">
          {uniqueRoutes.map((route) => (
            <button
              key={route}
              onClick={() => setRouteFilter(route)}
              className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap transition-colors ${
                routeFilter === route
                  ? 'bg-emerald-800 text-white'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
            >
              {route === 'All' ? 'All Routes' : route.split('(')[0]}
            </button>
          ))}
        </div>
      </div>

      {/* Fleet Table */}
      <div className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden flex-1">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[10px] text-slate-400 font-bold uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-6 py-4">Plate Number</th>
                <th className="px-6 py-4">Assigned Route</th>
                <th className="px-6 py-4">Vehicle Owner</th>
                <th className="px-6 py-4">Driver Details</th>
                <th className="px-6 py-4">Capacity</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-center">Compliance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredVehicles.length > 0 ? (
                filteredVehicles.map((vehicle) => (
                  <tr key={vehicle.id} className="hover:bg-slate-50/50">
                    <td className="px-6 py-4">
                      <span className="bg-emerald-950 text-emerald-400 font-bold text-xs tracking-wider px-3 py-1.5 rounded border border-emerald-800 font-mono">
                        {vehicle.plateNumber}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-semibold text-slate-700">{vehicle.route}</td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-800">{vehicle.ownerName}</span>
                        <span className="text-[10px] text-slate-400 font-mono">ID: {vehicle.ownerId}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-800">{vehicle.driverName}</span>
                        <span className="text-[10px] text-slate-500">{vehicle.driverPhone}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono font-medium text-slate-600">{vehicle.capacity} Seater</td>
                    <td className="px-6 py-4">{getStatusBadge(vehicle.status)}</td>
                    <td className="px-6 py-4 text-center">
                      <span className="text-[10px] text-emerald-600 font-semibold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                        Matched OK
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                    No Sacco vehicles matched the search criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border-4 border-slate-200 rounded max-w-md w-full p-6 shadow-xl">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 border-b border-slate-100 pb-2 mb-4 font-display">
              Onboard New Sacco Vehicle
            </h3>

            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                    Plate Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={plateNumber}
                    onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                    className="w-full p-2 border border-slate-200 rounded text-xs font-mono uppercase focus:outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                    Asset Owner *
                  </label>
                  <select
                    required
                    value={ownerId}
                    onChange={(e) => setOwnerId(e.target.value)}
                    className="w-full p-2 border border-slate-200 rounded text-xs focus:outline-none focus:border-emerald-600 bg-white"
                  >
                    <option value="">Select Sacco Member...</option>
                    {members.map(member => (
                      <option key={member.id} value={member.id}>{member.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                  Active Driver Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  className="w-full p-2 border border-slate-200 rounded text-xs focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                    Driver Mobile Phone *
                  </label>
                  <input
                    type="text"
                    required
                    value={driverPhone}
                    onChange={(e) => setDriverPhone(e.target.value)}
                    className="w-full p-2 border border-slate-200 rounded text-xs focus:outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                    Matatu Capacity *
                  </label>
                  <select
                    value={capacity}
                    onChange={(e) => setCapacity(Number(e.target.value) as 14 | 33 | 50)}
                    className="w-full p-2 border border-slate-200 rounded text-xs focus:outline-none focus:border-emerald-600 bg-white"
                  >
                    <option value="14">14-Seater Nissan</option>
                    <option value="33">33-Seater Minibus</option>
                    <option value="50">50-Seater Coach</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                  Approved Transit Corridor Route *
                </label>
                <select
                  value={route}
                  onChange={(e) => setRoute(e.target.value)}
                  className="w-full p-2 border border-slate-200 rounded text-xs focus:outline-none focus:border-emerald-600 bg-white"
                >
                  <option value="Nairobi - Thika (Route 237)">Nairobi - Thika (Route 237)</option>
                  <option value="Nairobi - Githurai (Route 45)">Nairobi - Githurai (Route 45)</option>
                  <option value="Nairobi - Ruiru (Route 145)">Nairobi - Ruiru (Route 145)</option>
                </select>
              </div>

              {error && <p className="text-xs text-rose-600 font-bold">{error}</p>}

              <div className="flex justify-end space-x-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setError('');
                  }}
                  className="px-3 py-1.5 border border-slate-200 rounded text-xs font-bold text-slate-500 uppercase tracking-wider"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="register-vehicle-submit"
                  className="px-4 py-1.5 bg-emerald-800 text-white rounded text-xs font-bold uppercase tracking-wider shadow-sm hover:bg-emerald-900"
                >
                  Confirm Asset Onboard
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </motion.div>
  );
}
