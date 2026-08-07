import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Vehicle, Member, UserRole } from '../types';
import { Search, Bus, PlusCircle, Wrench, Ban, CheckCircle2, LogOut, LogIn, Pencil, UserRound, UsersRound } from 'lucide-react';
import {
  isValidPersonName,
  isValidPhoneNumber,
  sanitizePersonName,
  sanitizePhoneNumber,
  sanitizeVehiclePlate
} from '../lib/inputValidation';
import { APPROVED_VEHICLE_ROUTES, isApprovedVehicleRoute } from '../lib/vehicleRegistration';

type OwnerMode = 'member' | 'other';
type VehicleDraft = {
  plateNumber: string;
  ownerMode: OwnerMode;
  ownerId: string;
  ownerName: string;
  driverName: string;
  driverPhone: string;
  route: string;
  capacity: Vehicle['capacity'];
};

interface VehiclesViewProps {
  vehicles: Vehicle[];
  members: Member[];
  onAddVehicle: (newVehicle: Omit<Vehicle, 'id'>) => Promise<void>;
  onUpdateVehicle: (vehicleId: string, changes: Pick<Vehicle, 'plateNumber' | 'ownerId' | 'ownerName' | 'driverName' | 'driverPhone' | 'route' | 'capacity'>) => Promise<void>;
  onVehicleLifecycle: (vehicleId: string, action: 'onboard' | 'offboard', reason?: string) => Promise<void>;
  currentUserRole: UserRole;
}

const emptyDraft = (): VehicleDraft => ({
  plateNumber: '',
  ownerMode: 'member',
  ownerId: '',
  ownerName: '',
  driverName: '',
  driverPhone: '',
  route: APPROVED_VEHICLE_ROUTES[0],
  capacity: 14
});

function VehicleFormFields({ draft, setDraft, members, allowMemberPlatePrefill = false }: {
  draft: VehicleDraft;
  setDraft: React.Dispatch<React.SetStateAction<VehicleDraft>>;
  members: Member[];
  allowMemberPlatePrefill?: boolean;
}) {
  const selectMember = (memberId: string) => {
    const owner = members.find(member => member.id === memberId);
    setDraft(current => ({
      ...current,
      ownerId: memberId,
      ownerName: owner?.name || '',
      plateNumber: allowMemberPlatePrefill && owner?.vehicleAssigned?.trim()
        ? owner.vehicleAssigned.trim().toUpperCase()
        : current.plateNumber
    }));
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Plate number *</span>
          <input required value={draft.plateNumber} onChange={event => setDraft(current => ({ ...current, plateNumber: sanitizeVehiclePlate(event.target.value) }))} placeholder="KDA 123A" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm font-bold uppercase outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Approved route *</span>
          <select required value={draft.route} onChange={event => setDraft(current => ({ ...current, route: event.target.value }))} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100">
            {APPROVED_VEHICLE_ROUTES.map(route => <option key={route} value={route}>{route}</option>)}
          </select>
        </label>
      </div>

      <fieldset className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
        <legend className="px-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Vehicle owner *</legend>
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-200/70 p-1">
          <button type="button" onClick={() => setDraft(current => ({ ...current, ownerMode: 'member', ownerName: '' }))} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[11px] font-bold transition ${draft.ownerMode === 'member' ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><UsersRound className="h-4 w-4" />Registered member</button>
          <button type="button" onClick={() => setDraft(current => ({ ...current, ownerMode: 'other', ownerId: '', ownerName: '' }))} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[11px] font-bold transition ${draft.ownerMode === 'other' ? 'bg-white text-sky-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><UserRound className="h-4 w-4" />Other owner</button>
        </div>
        {draft.ownerMode === 'member' ? (
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Select SACCO member</span>
            <select required value={draft.ownerId} onChange={event => selectMember(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs outline-none focus:border-emerald-600">
              <option value="">Select a registered member...</option>
              {members.map(member => <option key={member.id} value={member.id}>{member.membershipNumber} · {member.name}</option>)}
            </select>
          </label>
        ) : (
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Owner's full name</span>
            <input required value={draft.ownerName} onChange={event => setDraft(current => ({ ...current, ownerName: sanitizePersonName(event.target.value) }))} placeholder="Type any vehicle owner's name" pattern="[A-Za-z .'-]+" title="Use letters only." className="w-full rounded-xl border border-sky-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100" />
            <p className="mt-1.5 text-[10px] text-slate-500">Use this when the vehicle owner is not registered as a SACCO member.</p>
          </label>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Current driver *</span>
          <input required value={draft.driverName} onChange={event => setDraft(current => ({ ...current, driverName: sanitizePersonName(event.target.value) }))} placeholder="Driver's full name" pattern="[A-Za-z .'-]+" title="Use letters only." className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Driver phone *</span>
          <input type="tel" required value={draft.driverPhone} onChange={event => setDraft(current => ({ ...current, driverPhone: sanitizePhoneNumber(event.target.value) }))} placeholder="0700000000" inputMode="tel" pattern="[+]?[0-9]{9,15}" title="Use a phone number only." className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" />
        </label>
      </div>

      <label className="block sm:max-w-xs">
        <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Vehicle capacity *</span>
        <select value={draft.capacity} onChange={event => setDraft(current => ({ ...current, capacity: Number(event.target.value) as Vehicle['capacity'] }))} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs outline-none focus:border-emerald-600">
          <option value="7">7-Seater Sienta</option>
          <option value="14">14-Seater Nissan</option>
          <option value="33">33-Seater Minibus</option>
          <option value="50">50-Seater Coach</option>
        </select>
      </label>
    </div>
  );
}

function validateDraft(draft: VehicleDraft, members: Member[]): string {
  if (!draft.plateNumber.trim() || !draft.driverName.trim() || !draft.driverPhone.trim()) return 'Fill in every required vehicle and driver field.';
  if (draft.ownerMode === 'member' && !members.some(member => member.id === draft.ownerId)) return 'Select a valid registered member as the owner.';
  if (draft.ownerMode === 'other' && !isValidPersonName(draft.ownerName)) return 'Enter a valid vehicle owner name using letters only.';
  if (!isValidPersonName(draft.driverName)) return 'Driver name must use letters only.';
  if (!isValidPhoneNumber(draft.driverPhone)) return 'Enter a valid driver phone number using digits only.';
  if (!isApprovedVehicleRoute(draft.route)) return 'Select one of the six approved SACCO routes.';
  if (!/^[Kk][A-Dd][A-Zz]\s?\d{3}[A-Zz]$/.test(draft.plateNumber.trim())) return 'Use a valid Kenyan plate number such as KCJ 402X.';
  return '';
}

export default function VehiclesView({ vehicles, members, onAddVehicle, onUpdateVehicle, onVehicleLifecycle, currentUserRole }: VehiclesViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [routeFilter, setRouteFilter] = useState('All');
  const [showAddModal, setShowAddModal] = useState(false);
  const [createDraft, setCreateDraft] = useState<VehicleDraft>(emptyDraft);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [editDraft, setEditDraft] = useState<VehicleDraft>(emptyDraft);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [busyVehicleId, setBusyVehicleId] = useState<string | null>(null);
  const canRegister = currentUserRole === 'Chairman' || currentUserRole === 'Secretary';
  const routeOptions = ['All', ...Array.from(new Set([...APPROVED_VEHICLE_ROUTES, ...vehicles.map(vehicle => vehicle.route)]))];

  const filteredVehicles = vehicles.filter(vehicle => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = vehicle.plateNumber.toLowerCase().includes(term) || vehicle.driverName.toLowerCase().includes(term) || vehicle.ownerName.toLowerCase().includes(term) || vehicle.route.toLowerCase().includes(term);
    return matchesSearch && (routeFilter === 'All' || vehicle.route === routeFilter);
  });

  const vehicleChanges = (draft: VehicleDraft) => {
    const member = draft.ownerMode === 'member' ? members.find(item => item.id === draft.ownerId) : undefined;
    return {
      plateNumber: draft.plateNumber.toUpperCase().trim(),
      ownerId: member?.id || '',
      ownerName: member?.name || draft.ownerName.trim(),
      driverName: draft.driverName.trim(),
      driverPhone: draft.driverPhone.trim(),
      route: draft.route,
      capacity: draft.capacity
    };
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validateDraft(createDraft, members);
    if (validationError) return setError(validationError);
    try {
      await onAddVehicle({ ...vehicleChanges(createDraft), status: 'Active' });
      setCreateDraft(emptyDraft());
      setError('');
      setShowAddModal(false);
      setActionMessage(`${createDraft.plateNumber.toUpperCase().trim()} was registered and onboarded.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Vehicle registration failed.');
    }
  };

  const openEdit = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle);
    setEditDraft({
      plateNumber: vehicle.plateNumber,
      ownerMode: vehicle.ownerId ? 'member' : 'other',
      ownerId: vehicle.ownerId,
      ownerName: vehicle.ownerName,
      driverName: vehicle.driverName,
      driverPhone: vehicle.driverPhone,
      route: isApprovedVehicleRoute(vehicle.route) ? vehicle.route : APPROVED_VEHICLE_ROUTES[0],
      capacity: vehicle.capacity
    });
    setError('');
  };

  const handleEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingVehicle) return;
    const validationError = validateDraft(editDraft, members);
    if (validationError) return setError(validationError);
    setBusyVehicleId(editingVehicle.id);
    try {
      await onUpdateVehicle(editingVehicle.id, vehicleChanges(editDraft));
      setActionMessage(`${editDraft.plateNumber.toUpperCase().trim()} details were updated.`);
      setEditingVehicle(null);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Vehicle details could not be updated.');
    } finally {
      setBusyVehicleId(null);
    }
  };

  const handleLifecycle = async (vehicle: Vehicle) => {
    const action = vehicle.status === 'Exited' ? 'onboard' : 'offboard';
    let reason = '';
    if (action === 'offboard') {
      const response = window.prompt(`Reason for offboarding ${vehicle.plateNumber}? This is optional.`);
      if (response === null) return;
      reason = response;
    }
    const confirmation = action === 'onboard'
      ? `Onboard ${vehicle.plateNumber} and allow it to operate again?`
      : `Offboard ${vehicle.plateNumber}? It will no longer accept collections.`;
    if (!window.confirm(confirmation)) return;
    setBusyVehicleId(vehicle.id);
    setActionMessage('');
    try {
      await onVehicleLifecycle(vehicle.id, action, reason);
      setActionMessage(`${vehicle.plateNumber} was ${action === 'onboard' ? 'onboarded' : 'offboarded'}.`);
    } catch (caught) {
      setActionMessage(caught instanceof Error ? caught.message : `The vehicle could not be ${action}ed.`);
    } finally {
      setBusyVehicleId(null);
    }
  };

  const statusBadge = (status: Vehicle['status']) => {
    if (status === 'Active') return <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase text-emerald-700"><CheckCircle2 className="mr-1 h-3 w-3" />Onboarded</span>;
    if (status === 'Maintenance') return <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase text-amber-700"><Wrench className="mr-1 h-3 w-3" />Maintenance</span>;
    if (status === 'Suspended') return <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-bold uppercase text-rose-700"><Ban className="mr-1 h-3 w-3" />Suspended</span>;
    return <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-600"><LogOut className="mr-1 h-3 w-3" />Offboarded</span>;
  };

  return (
    <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }} className="flex flex-1 flex-col space-y-6 overflow-y-auto bg-slate-50 p-4 font-sans sm:p-8">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 md:flex-row md:items-center">
        <div>
          <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-700">Fleet desk</p>
          <h2 className="font-display text-xl font-bold text-slate-800">Vehicle Registration</h2>
          <p className="text-xs text-slate-500">Register owners, assign drivers and routes, then control each vehicle's service status.</p>
        </div>
        {canRegister ? (
          <button onClick={() => { setCreateDraft(emptyDraft()); setError(''); setShowAddModal(true); }} id="open-register-vehicle-modal" className="flex items-center gap-2 self-start rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-sm transition hover:bg-emerald-800 md:self-auto"><PlusCircle className="h-4 w-4" />Register vehicle</button>
        ) : <div className="self-start rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800 md:self-auto">Role <strong>{currentUserRole}</strong> has view-only access.</div>}
      </div>

      {actionMessage && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">{actionMessage}</p>}
      <div className="flex flex-col items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 md:flex-row">
        <div className="relative w-full md:w-80"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input type="search" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Search plate, owner, driver or route" className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-xs outline-none focus:border-emerald-600 focus:bg-white" /></div>
        <select value={routeFilter} onChange={event => setRouteFilter(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 outline-none focus:border-emerald-600 md:w-auto"><option value="All">All approved routes</option>{routeOptions.filter(route => route !== 'All').map(route => <option key={route} value={route}>{route}</option>)}</select>
      </div>

      <div className="flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-4">Plate</th><th className="px-5 py-4">Route</th><th className="px-5 py-4">Owner</th><th className="px-5 py-4">Driver</th><th className="px-5 py-4">Capacity</th><th className="px-5 py-4">Status</th><th className="px-5 py-4 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredVehicles.length ? filteredVehicles.map(vehicle => (
                <tr key={vehicle.id} className="transition hover:bg-slate-50/70">
                  <td className="px-5 py-4"><span className="rounded-lg border border-emerald-800 bg-emerald-950 px-3 py-1.5 font-mono text-xs font-bold tracking-wider text-emerald-400">{vehicle.plateNumber}</span></td>
                  <td className="max-w-48 px-5 py-4 font-semibold text-slate-700">{vehicle.route}</td>
                  <td className="px-5 py-4"><div className="flex flex-col"><span className="font-bold text-slate-800">{vehicle.ownerName}</span>{vehicle.ownerMembershipNumber ? <span className="font-mono text-[10px] font-bold text-emerald-700">Member · {vehicle.ownerMembershipNumber}</span> : <span className="text-[10px] font-semibold text-sky-700">Non-member owner</span>}</div></td>
                  <td className="px-5 py-4"><div className="flex flex-col"><span className="font-semibold text-slate-800">{vehicle.driverName}</span><span className="text-[10px] text-slate-500">{vehicle.driverPhone}</span></div></td>
                  <td className="px-5 py-4 font-mono font-medium text-slate-600">{vehicle.capacity} seats</td>
                  <td className="px-5 py-4">{statusBadge(vehicle.status)}</td>
                  <td className="px-5 py-4"><div className="flex justify-end gap-2">{canRegister && <><button type="button" onClick={() => openEdit(vehicle)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold uppercase text-slate-600 hover:border-slate-300 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" />Edit</button><button type="button" disabled={busyVehicleId === vehicle.id} onClick={() => void handleLifecycle(vehicle)} className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold uppercase transition disabled:opacity-50 ${vehicle.status === 'Exited' ? 'border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'}`}>{vehicle.status === 'Exited' ? <LogIn className="h-3.5 w-3.5" /> : <LogOut className="h-3.5 w-3.5" />}{busyVehicleId === vehicle.id ? 'Updating...' : vehicle.status === 'Exited' ? 'Onboard' : 'Offboard'}</button></>}</div></td>
                </tr>
              )) : <tr><td colSpan={7} className="px-6 py-14 text-center text-slate-400"><Bus className="mx-auto mb-2 h-6 w-6" />No vehicles matched this search.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/45 p-4 backdrop-blur-sm"><div className="my-6 w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"><div className="mb-5 border-b border-slate-100 pb-4"><p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-700">New fleet record</p><h3 className="mt-1 font-display text-lg font-bold text-slate-800">Register vehicle</h3><p className="mt-1 text-xs text-slate-500">The vehicle will be onboarded immediately after registration.</p></div><form onSubmit={handleCreate}><VehicleFormFields draft={createDraft} setDraft={setCreateDraft} members={members} allowMemberPlatePrefill />{error && <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}<div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={() => { setShowAddModal(false); setError(''); }} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold uppercase text-slate-500">Cancel</button><button type="submit" id="register-vehicle-submit" className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold uppercase text-white shadow-sm hover:bg-emerald-800">Register and onboard</button></div></form></div></div>}

      {editingVehicle && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/45 p-4 backdrop-blur-sm"><div className="my-6 w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"><div className="mb-5 border-b border-slate-100 pb-4"><p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-sky-700">Fleet correction</p><h3 className="mt-1 font-display text-lg font-bold text-slate-800">Edit {editingVehicle.plateNumber}</h3><p className="mt-1 text-xs text-slate-500">Update the owner, driver, route, plate or capacity. Driver changes remain in the assignment history.</p></div><form onSubmit={handleEdit}><VehicleFormFields draft={editDraft} setDraft={setEditDraft} members={members} />{error && <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}<div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={() => { setEditingVehicle(null); setError(''); }} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold uppercase text-slate-500">Cancel</button><button type="submit" disabled={busyVehicleId === editingVehicle.id} className="rounded-lg bg-sky-700 px-4 py-2 text-xs font-bold uppercase text-white shadow-sm hover:bg-sky-800 disabled:opacity-50">{busyVehicleId === editingVehicle.id ? 'Saving...' : 'Save vehicle changes'}</button></div></form></div></div>}
    </motion.div>
  );
}
