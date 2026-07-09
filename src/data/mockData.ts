import { Member, Vehicle, Transaction, TargetCollection, User } from '../types';

export const mockUsers: User[] = [
  {
    id: 'u-1',
    name: 'Timothy Mwangi',
    email: 'treasurer@sacco.co.ke',
    role: 'Treasurer',
    phone: '+254 712 345 678'
  },
  {
    id: 'u-2',
    name: 'Jane Wambui',
    email: 'secretary@sacco.co.ke',
    role: 'Secretary',
    phone: '+254 722 987 654'
  },
  {
    id: 'u-3',
    name: 'Hon. Peter Kamau',
    email: 'chairman@sacco.co.ke',
    role: 'Chairman',
    phone: '+254 733 111 222'
  },
  {
    id: 'u-4',
    name: 'David Ochieng',
    email: 'auditor@sacco.co.ke',
    role: 'Auditor',
    phone: '+254 701 555 666'
  },
  {
    id: 'u-5',
    name: 'Beatrice Ndwiga',
    email: 'accountant@sacco.co.ke',
    role: 'Accountant',
    phone: '+254 715 222 333'
  }
];

export const mockMembers: Member[] = [
  {
    id: 'm-1',
    name: 'Samuel Gichuru',
    idNumber: '28401928',
    phoneNumber: '+254 710 440 330',
    status: 'Active',
    dateRegistered: '2023-04-12',
    vehicleAssigned: 'KBB 112L',
    sharesAmount: 150000,
    savingsAmount: 45000
  },
  {
    id: 'm-2',
    name: 'James Kamau',
    idNumber: '31204958',
    phoneNumber: '+254 720 123 456',
    status: 'Active',
    dateRegistered: '2024-01-10',
    vehicleAssigned: 'KCJ 402X',
    sharesAmount: 85000,
    savingsAmount: 22000
  },
  {
    id: 'm-3',
    name: 'Patrick Njoroge',
    idNumber: '29876543',
    phoneNumber: '+254 735 999 888',
    status: 'Active',
    dateRegistered: '2024-03-22',
    vehicleAssigned: 'KCD 883A',
    sharesAmount: 250000,
    savingsAmount: 110000
  },
  {
    id: 'm-4',
    name: 'Mercy Njeri',
    idNumber: '33445566',
    phoneNumber: '+254 712 888 222',
    status: 'Active',
    dateRegistered: '2024-06-01',
    vehicleAssigned: 'KDD 445Z',
    sharesAmount: 120000,
    savingsAmount: 38000
  },
  {
    id: 'm-5',
    name: 'Arap Sang',
    idNumber: '24567890',
    phoneNumber: '+254 728 333 444',
    status: 'Pending',
    dateRegistered: '2026-06-25',
    sharesAmount: 0,
    savingsAmount: 0
  }
];

export const mockVehicles: Vehicle[] = [
  {
    id: 'v-1',
    plateNumber: 'KBB 112L',
    ownerId: 'm-1',
    ownerName: 'Samuel Gichuru',
    driverName: 'John Ndungu',
    driverPhone: '+254 722 000 111',
    route: 'Nairobi - Thika (Route 237)',
    status: 'Active',
    capacity: 14
  },
  {
    id: 'v-2',
    plateNumber: 'KCJ 402X',
    ownerId: 'm-2',
    ownerName: 'James Kamau',
    driverName: 'Peter Kamau Jnr',
    driverPhone: '+254 711 222 333',
    route: 'Nairobi - Thika (Route 237)',
    status: 'Active',
    capacity: 14
  },
  {
    id: 'v-3',
    plateNumber: 'KCD 883A',
    ownerId: 'm-3',
    ownerName: 'Patrick Njoroge',
    driverName: 'Francis Mwangi',
    driverPhone: '+254 700 999 000',
    route: 'Nairobi - Githurai (Route 45)',
    status: 'Maintenance',
    capacity: 33
  },
  {
    id: 'v-4',
    plateNumber: 'KDD 445Z',
    ownerId: 'm-4',
    ownerName: 'Mercy Njeri',
    driverName: 'Robert Kiprop',
    driverPhone: '+254 723 456 789',
    route: 'Nairobi - Ruiru (Route 145)',
    status: 'Active',
    capacity: 14
  }
];

export const mockTransactions: Transaction[] = [
  {
    id: 't-1',
    timestamp: '2026-06-29T09:30:00-07:00',
    memberId: 'm-3',
    memberName: 'Patrick Njoroge',
    vehiclePlate: 'KCD 883A',
    description: 'New Member Registration Fee',
    refCode: 'QE93FD82H1',
    type: 'Credit',
    category: 'Registration Fee',
    amount: 10000,
    recorderName: 'Timothy Mwangi',
    tillNumber: 'VehicleTill'
  },
  {
    id: 't-2',
    timestamp: '2026-06-29T08:15:00-07:00',
    memberId: 'm-1',
    memberName: 'Samuel Gichuru',
    vehiclePlate: 'KBB 112L',
    description: 'Daily Member Contribution',
    refCode: 'RH82-9904',
    type: 'Credit',
    category: 'Daily Contribution',
    amount: 5000,
    recorderName: 'Timothy Mwangi',
    tillNumber: 'VehicleTill'
  },
  {
    id: 't-3',
    timestamp: '2026-06-28T16:10:00-07:00',
    description: 'Office internet & stationery payment',
    refCode: 'CAS-00122',
    type: 'Debit',
    category: 'Office Expenses',
    amount: 1200,
    recorderName: 'Timothy Mwangi',
    tillNumber: 'UtilityTill'
  },
  {
    id: 't-4',
    timestamp: '2026-06-28T14:22:00-07:00',
    memberId: 'm-2',
    memberName: 'James Kamau',
    vehiclePlate: 'KCJ 402X',
    description: 'Daily Member Contribution',
    refCode: 'RH82-9921',
    type: 'Credit',
    category: 'Daily Contribution',
    amount: 2500,
    recorderName: 'Timothy Mwangi',
    tillNumber: 'VehicleTill'
  },
  {
    id: 't-5',
    timestamp: '2026-06-27T11:05:00-07:00',
    memberId: 'm-1',
    memberName: 'Samuel Gichuru',
    vehiclePlate: 'KBB 112L',
    description: 'Vehicle management compliance',
    refCode: 'QKA82901FF',
    type: 'Credit',
    category: 'Management Fee',
    amount: 3000,
    recorderName: 'Timothy Mwangi',
    tillNumber: 'VehicleTill'
  },
  {
    id: 't-6',
    timestamp: '2026-06-26T09:40:00-07:00',
    description: 'Sacco meeting tea and snacks reimbursement',
    refCode: 'CAS-00119',
    type: 'Debit',
    category: 'Petty Cash',
    amount: 2500,
    recorderName: 'Timothy Mwangi',
    tillNumber: 'UtilityTill'
  }
];

export const mockTargets: TargetCollection[] = [
  {
    name: 'WEEKLY SAVINGS GOAL',
    current: 75000,
    target: 100000,
    unit: 'KES'
  },
  {
    name: 'LOAN REPAYMENT QUOTA',
    current: 42000,
    target: 100000,
    unit: 'KES'
  }
];
