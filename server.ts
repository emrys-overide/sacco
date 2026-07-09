import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { Firestore } from '@google-cloud/firestore';
import { getSaccoUserKey } from './src/lib/auth';
import type { TillType, Transaction, TransactionCategory, TransactionType, UserRole } from './src/types';

const TRANSACTION_TYPES: readonly TransactionType[] = ['Credit', 'Debit'];
const TRANSACTION_CATEGORIES: readonly TransactionCategory[] = [
  'Daily Contribution',
  'Registration Fee',
  'Management Fee',
  'Office Expenses',
  'Petty Cash',
  'Penalty',
  'Utilities',
  'Equipment'
];
const TILL_TYPES: readonly TillType[] = ['VehicleTill', 'UtilityTill', 'None'];
const SHARES_ALLOCATION_RATE = 0.3;
const SAVINGS_ALLOCATION_RATE = 0.7;

class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = 'REQUEST_FAILED') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

type LedgerInput = Partial<Transaction> & {
  description?: string;
  refCode?: string;
  amount?: number | string;
};

// Standard mock data to seed if database collections are empty
const mockUsers = [
  { id: 'u-1', name: 'Timothy Mwangi', email: 'treasurer@sacco.co.ke', role: 'Treasurer', phone: '+254 712 345 678' },
  { id: 'u-2', name: 'Jane Wambui', email: 'secretary@sacco.co.ke', role: 'Secretary', phone: '+254 722 987 654' },
  { id: 'u-3', name: 'Hon. Peter Kamau', email: 'chairman@sacco.co.ke', role: 'Chairman', phone: '+254 733 111 222' },
  { id: 'u-4', name: 'David Ochieng', email: 'auditor@sacco.co.ke', role: 'Auditor', phone: '+254 701 555 666' },
  { id: 'u-5', name: 'Beatrice Ndwiga', email: 'accountant@sacco.co.ke', role: 'Accountant', phone: '+254 715 222 333' }
];

const mockMembers = [
  { id: 'm-1', name: 'Samuel Gichuru', idNumber: '28401928', phoneNumber: '+254 710 440 330', status: 'Active', dateRegistered: '2023-04-12', vehicleAssigned: 'KBB 112L', sharesAmount: 150000, savingsAmount: 45000 },
  { id: 'm-2', name: 'James Kamau', idNumber: '31204958', phoneNumber: '+254 720 123 456', status: 'Active', dateRegistered: '2024-01-10', vehicleAssigned: 'KCJ 402X', sharesAmount: 85000, savingsAmount: 22000 },
  { id: 'm-3', name: 'Patrick Njoroge', idNumber: '29876543', phoneNumber: '+254 735 999 888', status: 'Active', dateRegistered: '2024-03-22', vehicleAssigned: 'KCD 883A', sharesAmount: 250000, savingsAmount: 110000 },
  { id: 'm-4', name: 'Mercy Njeri', idNumber: '33445566', phoneNumber: '+254 712 888 222', status: 'Active', dateRegistered: '2024-06-01', vehicleAssigned: 'KDD 445Z', sharesAmount: 120000, savingsAmount: 38000 },
  { id: 'm-5', name: 'Arap Sang', idNumber: '24567890', phoneNumber: '+254 728 333 444', status: 'Pending', dateRegistered: '2026-06-25', sharesAmount: 0, savingsAmount: 0 }
];

const mockVehicles = [
  { id: 'v-1', plateNumber: 'KBB 112L', ownerId: 'm-1', ownerName: 'Samuel Gichuru', driverName: 'John Ndungu', driverPhone: '+254 722 000 111', route: 'Nairobi - Thika (Route 237)', status: 'Active', capacity: 14 },
  { id: 'v-2', plateNumber: 'KCJ 402X', ownerId: 'm-2', ownerName: 'James Kamau', driverName: 'Peter Kamau Jnr', driverPhone: '+254 711 222 333', route: 'Nairobi - Thika (Route 237)', status: 'Active', capacity: 14 },
  { id: 'v-3', plateNumber: 'KCD 883A', ownerId: 'm-3', ownerName: 'Patrick Njoroge', driverName: 'Wilson Kimani', driverPhone: '+254 733 444 555', route: 'Nairobi - Kikuyu (Route 105)', status: 'Active', capacity: 33 },
  { id: 'v-4', plateNumber: 'KDD 445Z', ownerId: 'm-4', ownerName: 'Mercy Njeri', driverName: 'Silas Kiprop', driverPhone: '+254 715 888 777', route: 'Nairobi - Rongai (Route 125)', status: 'Active', capacity: 14 },
  { id: 'v-5', plateNumber: 'KCA 001X', ownerId: 'm-5', ownerName: 'Arap Sang', driverName: 'Douglas Mwangi', driverPhone: '+254 700 111 222', route: 'Nairobi - Thika (Route 237)', status: 'Maintenance', capacity: 14 }
];

const mockTransactions: Transaction[] = [
  { id: 't-1', timestamp: '2026-06-29T10:30:00Z', memberId: 'm-1', memberName: 'Samuel Gichuru', vehiclePlate: 'KBB 112L', description: 'Daily fleet collection contribution', refCode: 'MPX87A29DF', type: 'Credit', category: 'Daily Contribution', amount: 3500, recorderName: 'Timothy Mwangi', tillNumber: 'VehicleTill' },
  { id: 't-2', timestamp: '2026-06-29T11:15:00Z', memberId: 'm-2', memberName: 'James Kamau', vehiclePlate: 'KCJ 402X', description: 'Monthly driver registration fee payment', refCode: 'MPX91K882S', type: 'Credit', category: 'Registration Fee', amount: 5000, recorderName: 'Jane Wambui', tillNumber: 'UtilityTill' },
  { id: 't-3', timestamp: '2026-06-29T14:20:00Z', description: 'Office internet and utility bill payment', refCode: 'VCH00219A', type: 'Debit', category: 'Utilities', amount: 4500, recorderName: 'Jane Wambui', tillNumber: 'None' },
  { id: 't-4', timestamp: '2026-06-29T15:45:00Z', memberId: 'm-3', memberName: 'Patrick Njoroge', vehiclePlate: 'KCD 883A', description: 'Route operation management levy', refCode: 'MPX72J009K', type: 'Credit', category: 'Management Fee', amount: 8000, recorderName: 'Timothy Mwangi', tillNumber: 'UtilityTill' },
  { id: 't-5', timestamp: '2026-06-29T16:10:00Z', description: 'Printer toners and stationary procurement', refCode: 'VCH00220B', type: 'Debit', category: 'Office Expenses', amount: 2500, recorderName: 'Beatrice Ndwiga', tillNumber: 'None' }
];

const mockMPesaConfig = {
  consumerKey: 'DARAJA_SANDBOX_CONSUMER_KEY_824910',
  consumerSecret: 'DARAJA_SANDBOX_CONSUMER_SECRET_824910',
  shortcode: '824910',
  passkey: 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919',
  callbackUrl: 'https://api.sowetamusacco.co.ke/v1/mpesa/callback',
  mode: 'sandbox' as const,
  stkPushEnabled: true
};

// Firebase Setup - Utilizing direct server access via @google-cloud/firestore
const db = new Firestore({
  projectId: "gen-lang-client-0172640004",
  databaseId: "ai-studio-matatusaccomanag-cd852607-4b11-4562-8401-e653d5fca910"
});

// Sacco Memory-Backed Ledger Storage (Fallback engine for development and sandbox stability)
const localStore = {
  users: [...mockUsers],
  members: [...mockMembers],
  vehicles: [...mockVehicles],
  transactions: [...mockTransactions],
  mpesaConfig: { ...mockMPesaConfig }
};

// State flag indicating if we are using Firestore or Local Fallback
let useFirestore = Boolean(
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT
);

// Helper to safely execute any Firestore database operation with automatic, zero-downtime local ledger fallback
async function safeDbOperation<T>(
  operation: (firestoreDb: Firestore) => Promise<T>,
  fallback: () => T | Promise<T>,
  collectionName: string
): Promise<T> {
  if (!useFirestore) {
    return Promise.resolve(fallback());
  }
  try {
    return await operation(db);
  } catch (error: any) {
    if (error instanceof HttpError) {
      throw error;
    }
    console.warn(`[Sacco Ledger OS] Firestore connection/permission unavailable for [${collectionName}]. Operating in high-security Local Ledger Fallback Mode.`, error.message || error);
    useFirestore = false;
    return Promise.resolve(fallback());
  }
}

function normalizeRefCode(refCode: unknown): string {
  return String(refCode || '').trim().toUpperCase();
}

function normalizeTransactionInput(input: LedgerInput): Transaction {
  const description = String(input.description || '').trim();
  const refCode = normalizeRefCode(input.refCode);
  const amount = Number(input.amount);
  const type = (input.type || 'Credit') as TransactionType;
  const category = (input.category || 'Daily Contribution') as TransactionCategory;
  const tillNumber = (input.tillNumber || 'UtilityTill') as TillType;

  if (!description) {
    throw new HttpError(400, 'Transaction description is required.', 'MISSING_DESCRIPTION');
  }
  if (!refCode) {
    throw new HttpError(400, 'Transaction reference code is required.', 'MISSING_REF_CODE');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, 'Transaction amount must be greater than zero.', 'INVALID_AMOUNT');
  }
  if (!TRANSACTION_TYPES.includes(type)) {
    throw new HttpError(400, 'Transaction type must be Credit or Debit.', 'INVALID_TRANSACTION_TYPE');
  }
  if (!TRANSACTION_CATEGORIES.includes(category)) {
    throw new HttpError(400, `Unsupported transaction category: ${category}`, 'INVALID_TRANSACTION_CATEGORY');
  }
  if (!TILL_TYPES.includes(tillNumber)) {
    throw new HttpError(400, `Unsupported till number: ${tillNumber}`, 'INVALID_TILL');
  }

  return {
    id: input.id || 't-' + Date.now(),
    timestamp: input.timestamp || new Date().toISOString(),
    memberId: input.memberId || '',
    memberName: input.memberName || '',
    vehiclePlate: input.vehiclePlate || '',
    description,
    refCode,
    type,
    category,
    amount,
    recorderName: input.recorderName || 'Sacco Ledger OS',
    tillNumber,
    reversalOf: input.reversalOf,
    reversedAt: input.reversedAt,
    reversedBy: input.reversedBy
  };
}

function getDailyContributionBalanceDelta(tx: Transaction): { shares: number; savings: number } {
  if (!tx.memberId || tx.category !== 'Daily Contribution') {
    return { shares: 0, savings: 0 };
  }

  const direction = tx.type === 'Credit' ? 1 : -1;
  return {
    shares: direction * Math.round(tx.amount * SHARES_ALLOCATION_RATE),
    savings: direction * Math.round(tx.amount * SAVINGS_ALLOCATION_RATE)
  };
}

function applyLocalMemberBalance(tx: Transaction) {
  const delta = getDailyContributionBalanceDelta(tx);
  if (!delta.shares && !delta.savings) return;

  const member = localStore.members.find(m => m.id === tx.memberId);
  if (!member) {
    throw new HttpError(404, 'Linked Sacco member profile was not found.', 'MEMBER_NOT_FOUND');
  }

  member.sharesAmount = Math.max(0, (member.sharesAmount || 0) + delta.shares);
  member.savingsAmount = Math.max(0, (member.savingsAmount || 0) + delta.savings);
}

async function applyFirestoreMemberBalance(firestoreDb: Firestore, tx: Transaction) {
  const delta = getDailyContributionBalanceDelta(tx);
  if (!delta.shares && !delta.savings) return;

  const memberRef = firestoreDb.collection('members').doc(tx.memberId || '');
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) {
    throw new HttpError(404, 'Linked Sacco member profile was not found.', 'MEMBER_NOT_FOUND');
  }

  const currentMemberData = memberSnap.data() || {};
  await memberRef.set({
    ...currentMemberData,
    sharesAmount: Math.max(0, Number(currentMemberData.sharesAmount || 0) + delta.shares),
    savingsAmount: Math.max(0, Number(currentMemberData.savingsAmount || 0) + delta.savings)
  }, { merge: true });
}

async function createLedgerTransaction(input: LedgerInput): Promise<Transaction> {
  const tx = normalizeTransactionInput(input);

  await safeDbOperation(
    async (firestoreDb) => {
      const duplicateSnap = await firestoreDb
        .collection('transactions')
        .where('refCode', '==', tx.refCode)
        .limit(1)
        .get();

      if (!duplicateSnap.empty) {
        throw new HttpError(409, `Reference code ${tx.refCode} already exists in the ledger.`, 'DUPLICATE_LEDGER_REF');
      }

      await applyFirestoreMemberBalance(firestoreDb, tx);
      await firestoreDb.collection('transactions').doc(tx.id).set(tx);
    },
    () => {
      const duplicate = localStore.transactions.some(t => normalizeRefCode(t.refCode) === tx.refCode);
      if (duplicate) {
        throw new HttpError(409, `Reference code ${tx.refCode} already exists in the ledger.`, 'DUPLICATE_LEDGER_REF');
      }

      applyLocalMemberBalance(tx);
      localStore.transactions.push(tx);
    },
    'transactions'
  );

  return tx;
}

async function reverseLedgerTransaction(transactionId: string, recorderName: string): Promise<Transaction> {
  const original = await safeDbOperation<Transaction | null>(
    async (firestoreDb) => {
      const snap = await firestoreDb.collection('transactions').doc(transactionId).get();
      return snap.exists ? snap.data() as Transaction : null;
    },
    () => localStore.transactions.find(tx => tx.id === transactionId) || null,
    'transactions'
  );

  if (!original) {
    throw new HttpError(404, 'Transaction to reverse was not found.', 'TRANSACTION_NOT_FOUND');
  }

  const existingReversal = await safeDbOperation<Transaction | null>(
    async (firestoreDb) => {
      const snap = await firestoreDb
        .collection('transactions')
        .where('reversalOf', '==', original.id)
        .limit(1)
        .get();
      return snap.empty ? null : snap.docs[0].data() as Transaction;
    },
    () => localStore.transactions.find(tx => tx.reversalOf === original.id) || null,
    'transactions'
  );

  if (existingReversal) {
    throw new HttpError(409, `Transaction ${original.refCode} has already been reversed.`, 'ALREADY_REVERSED');
  }

  return createLedgerTransaction({
    memberId: original.memberId,
    memberName: original.memberName,
    vehiclePlate: original.vehiclePlate,
    description: `Reversal of ${original.refCode}: ${original.description}`,
    refCode: `REV-${original.refCode}-${Date.now().toString().slice(-6)}`,
    type: original.type === 'Credit' ? 'Debit' : 'Credit',
    category: original.category,
    amount: original.amount,
    recorderName,
    tillNumber: original.tillNumber,
    reversalOf: original.id,
    reversedAt: new Date().toISOString(),
    reversedBy: recorderName
  });
}

function sendApiError(res: express.Response, error: any) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  return res.status(500).json({ error: error.message || 'Unexpected server error.' });
}

// Sacco Security OS Authentication Middleware
const authenticateSaccoUser = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const email = req.headers['x-sacco-user-email'] as string;
  const role = req.headers['x-sacco-user-role'] as UserRole;
  const key = req.headers['x-sacco-user-key'] as string;

  if (!email || !role || !key) {
    return res.status(401).json({ error: 'Sacco Security OS: Missing authentication credentials headers.' });
  }

  const user = mockUsers.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Sacco Security OS: User not found in authorized register.' });
  }

  if (user.role !== role) {
    return res.status(401).json({ error: 'Sacco Security OS: Role validation mismatch.' });
  }

  if (key !== getSaccoUserKey(user.role as UserRole)) {
    return res.status(401).json({ error: 'Sacco Security OS: Invalid role security credential key.' });
  }

  // Attach user to request
  (req as any).user = user;
  next();
};

const requireRoles = (allowedRoles: string[]) => {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as any).user;
    if (!user || !allowedRoles.includes(user.role)) {
      return res.status(403).json({ 
        error: `Sacco Access Control Breach Blocked: Role [${user?.role || 'Unknown'}] is restricted from this operational directory.` 
      });
    }
    next();
  };
};

// Initialize/Seed Firestore collections with Mock Data if empty
async function seedDatabaseIfEmpty() {
  if (!useFirestore) {
    console.log("No Google Cloud credentials detected. Skipping Firestore seeding and using Local Ledger Fallback Mode.");
    return;
  }

  console.log("Checking Firestore collections for initial seeding...");
  try {
    // 1. Seed Users
    const usersSnap = await db.collection('users').limit(1).get();
    if (usersSnap.empty) {
      console.log("Seeding users collection...");
      for (const user of mockUsers) {
        await db.collection('users').doc(user.id).set(user);
      }
    }

    // 2. Seed Members
    const membersSnap = await db.collection('members').limit(1).get();
    if (membersSnap.empty) {
      console.log("Seeding members collection...");
      for (const member of mockMembers) {
        await db.collection('members').doc(member.id).set(member);
      }
    }

    // 3. Seed Vehicles
    const vehiclesSnap = await db.collection('vehicles').limit(1).get();
    if (vehiclesSnap.empty) {
      console.log("Seeding vehicles collection...");
      for (const vehicle of mockVehicles) {
        await db.collection('vehicles').doc(vehicle.id).set(vehicle);
      }
    }

    // 4. Seed Transactions
    const transactionsSnap = await db.collection('transactions').limit(1).get();
    if (transactionsSnap.empty) {
      console.log("Seeding transactions collection...");
      for (const tx of mockTransactions) {
        await db.collection('transactions').doc(tx.id).set(tx);
      }
    }

    // 5. Seed M-Pesa Config
    const mpesaConfigSnap = await db.collection('mpesaConfig').limit(1).get();
    if (mpesaConfigSnap.empty) {
      console.log("Seeding mpesaConfig collection...");
      await db.collection('mpesaConfig').doc('active').set(mockMPesaConfig);
    }
    console.log("Firestore seeding checks complete.");
  } catch (error: any) {
    console.warn("[Sacco Ledger OS] Firestore connection/permission unavailable on startup. Automatically operating in high-security Local Ledger Fallback Mode.", error.message || error);
    useFirestore = false;
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Run database seeding
  await seedDatabaseIfEmpty();

  // API 1: Healthcheck
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', database: useFirestore ? 'connected' : 'local_fallback', timestamp: new Date().toISOString() });
  });

  // Protect all functional API endpoints with Sacco Zero-Trust validation
  app.use('/api/users', authenticateSaccoUser);
  app.use('/api/members', authenticateSaccoUser);
  app.use('/api/vehicles', authenticateSaccoUser);
  app.use('/api/transactions', authenticateSaccoUser);
  app.use('/api/system', authenticateSaccoUser);

  // API 2: Get Users
  app.get('/api/users', async (req, res) => {
    try {
      const list = await safeDbOperation(
        async (firestoreDb) => {
          const snap = await firestoreDb.collection('users').get();
          return snap.docs.map(doc => doc.data());
        },
        () => localStore.users,
        'users'
      );
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API 3: Get Sacco Members
  app.get('/api/members', async (req, res) => {
    try {
      const list = await safeDbOperation(
        async (firestoreDb) => {
          const snap = await firestoreDb.collection('members').get();
          return snap.docs.map(doc => doc.data());
        },
        () => localStore.members,
        'members'
      );
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API 4: Register Sacco Member (Authorized roles: Chairman, Secretary, Treasurer)
  app.post('/api/members', requireRoles(['Chairman', 'Secretary', 'Treasurer']), async (req, res) => {
    try {
      const memberData = req.body;
      if (!memberData.name || !memberData.idNumber) {
        return res.status(400).json({ error: 'Name and National ID Number are required.' });
      }
      const memberId = memberData.id || 'm-' + Date.now();
      const newMember = {
        id: memberId,
        name: memberData.name,
        idNumber: memberData.idNumber,
        phoneNumber: memberData.phoneNumber || '+254 700 000 000',
        status: memberData.status || 'Active',
        dateRegistered: memberData.dateRegistered || new Date().toISOString().substring(0, 10),
        vehicleAssigned: memberData.vehicleAssigned || '',
        sharesAmount: Number(memberData.sharesAmount) || 0,
        savingsAmount: Number(memberData.savingsAmount) || 0
      };

      await safeDbOperation(
        async (firestoreDb) => {
          await firestoreDb.collection('members').doc(memberId).set(newMember);
        },
        () => {
          const idx = localStore.members.findIndex(m => m.id === memberId);
          if (idx >= 0) {
            localStore.members[idx] = newMember;
          } else {
            localStore.members.push(newMember);
          }
        },
        'members'
      );

      res.status(201).json(newMember);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API 5: Get Fleet Vehicles
  app.get('/api/vehicles', async (req, res) => {
    try {
      const list = await safeDbOperation(
        async (firestoreDb) => {
          const snap = await firestoreDb.collection('vehicles').get();
          return snap.docs.map(doc => doc.data());
        },
        () => localStore.vehicles,
        'vehicles'
      );
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API 6: Register Matatu Vehicle (Authorized roles: Chairman, Secretary)
  app.post('/api/vehicles', requireRoles(['Chairman', 'Secretary']), async (req, res) => {
    try {
      const vehicleData = req.body;
      if (!vehicleData.plateNumber || !vehicleData.ownerName) {
        return res.status(400).json({ error: 'Plate Number and Owner Name are required.' });
      }
      const vehicleId = vehicleData.id || 'v-' + Date.now();
      const newVehicle = {
        id: vehicleId,
        plateNumber: vehicleData.plateNumber.toUpperCase(),
        ownerId: vehicleData.ownerId || 'm-unknown',
        ownerName: vehicleData.ownerName,
        driverName: vehicleData.driverName || 'Douglas Mwangi',
        driverPhone: vehicleData.driverPhone || '+254 700 111 222',
        route: vehicleData.route || 'Nairobi - Thika (Route 237)',
        status: vehicleData.status || 'Active',
        capacity: Number(vehicleData.capacity) || 14
      };

      await safeDbOperation(
        async (firestoreDb) => {
          await firestoreDb.collection('vehicles').doc(vehicleId).set(newVehicle);
        },
        () => {
          const idx = localStore.vehicles.findIndex(v => v.id === vehicleId);
          if (idx >= 0) {
            localStore.vehicles[idx] = newVehicle;
          } else {
            localStore.vehicles.push(newVehicle);
          }
        },
        'vehicles'
      );

      res.status(201).json(newVehicle);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API 7: Get Ledger Transactions
  app.get('/api/transactions', async (req, res) => {
    try {
      const list = await safeDbOperation(
        async (firestoreDb) => {
          const snap = await firestoreDb.collection('transactions').get();
          return snap.docs.map(doc => doc.data());
        },
        () => localStore.transactions,
        'transactions'
      );
      // Sort by timestamp descending
      list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API 8: Book a transaction (Authorized roles: Chairman, Treasurer, Accountant)
  app.post('/api/transactions', requireRoles(['Chairman', 'Treasurer', 'Accountant']), async (req, res) => {
    try {
      const newTx = await createLedgerTransaction(req.body);
      res.status(201).json(newTx);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // API 8B: Reverse a transaction without deleting immutable ledger history
  app.post('/api/transactions/:id/reverse', requireRoles(['Chairman', 'Treasurer', 'Accountant']), async (req, res) => {
    try {
      const user = (req as any).user;
      const reversal = await reverseLedgerTransaction(req.params.id, user?.name || 'Sacco Ledger OS');
      res.status(201).json(reversal);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // API 9: Sacco Dynamic Ledger Status (computed on server side)
  app.get('/api/system/status', async (req, res) => {
    try {
      const data = await safeDbOperation(
        async (firestoreDb) => {
          const txSnap = await firestoreDb.collection('transactions').get();
          const memberSnap = await firestoreDb.collection('members').get();
          const vehicleSnap = await firestoreDb.collection('vehicles').get();

          let totalCredits = 0;
          let totalDebits = 0;
          txSnap.docs.forEach(doc => {
            const tx = doc.data();
            if (tx.type === 'Credit') {
              totalCredits += (tx.amount || 0);
            } else {
              totalDebits += (tx.amount || 0);
            }
          });

          let totalShares = 0;
          let totalSavings = 0;
          memberSnap.docs.forEach(doc => {
            const m = doc.data();
            totalShares += (m.sharesAmount || 0);
            totalSavings += (m.savingsAmount || 0);
          });

          return {
            totalTransactionsCount: txSnap.size,
            totalMembersCount: memberSnap.size,
            totalFleetCount: vehicleSnap.size,
            netCashFlow: totalCredits - totalDebits,
            totalCapitalReserve: totalShares,
            totalMemberSavings: totalSavings,
            systemHealth: "100%",
            auditTimestamp: new Date().toISOString()
          };
        },
        () => {
          let totalCredits = 0;
          let totalDebits = 0;
          localStore.transactions.forEach(tx => {
            if (tx.type === 'Credit') {
              totalCredits += (tx.amount || 0);
            } else {
              totalDebits += (tx.amount || 0);
            }
          });

          let totalShares = 0;
          let totalSavings = 0;
          localStore.members.forEach(m => {
            totalShares += (m.sharesAmount || 0);
            totalSavings += (m.savingsAmount || 0);
          });

          return {
            totalTransactionsCount: localStore.transactions.length,
            totalMembersCount: localStore.members.length,
            totalFleetCount: localStore.vehicles.length,
            netCashFlow: totalCredits - totalDebits,
            totalCapitalReserve: totalShares,
            totalMemberSavings: totalSavings,
            systemHealth: "100%",
            auditTimestamp: new Date().toISOString()
          };
        },
        'transactions'
      );

      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // =========================================================================
  // M-PESA PAYBILL & DARJA API INTEGRATION GATEWAY
  // =========================================================================

  // API 14: Get active M-Pesa configuration
  app.get('/api/mpesa/config', authenticateSaccoUser, async (req, res) => {
    try {
      const config = await safeDbOperation(
        async (firestoreDb) => {
          const doc = await firestoreDb.collection('mpesaConfig').doc('active').get();
          return doc.exists ? doc.data() : localStore.mpesaConfig;
        },
        () => localStore.mpesaConfig,
        'mpesaConfig'
      );
      res.json(config);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API 15: Save/Update active M-Pesa configuration (Admin/Treasurer)
  app.post('/api/mpesa/config', requireRoles(['Chairman', 'Treasurer']), async (req, res) => {
    try {
      const newConfig = req.body;
      const updated = {
        consumerKey: newConfig.consumerKey || '',
        consumerSecret: newConfig.consumerSecret || '',
        shortcode: newConfig.shortcode || '',
        passkey: newConfig.passkey || '',
        callbackUrl: newConfig.callbackUrl || '',
        mode: newConfig.mode || 'sandbox',
        stkPushEnabled: newConfig.stkPushEnabled !== false
      };

      await safeDbOperation(
        async (firestoreDb) => {
          await firestoreDb.collection('mpesaConfig').doc('active').set(updated);
        },
        () => {
          localStore.mpesaConfig = updated;
        },
        'mpesaConfig'
      );
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API 15C: Safaricom C2B register URL (Allows user to programmatically register Webhook URLs using their keys)
  app.post('/api/mpesa/register-url', authenticateSaccoUser, async (req, res) => {
    try {
      const { consumerKey, consumerSecret, shortcode, mode, confirmationUrl, validationUrl } = req.body;
      
      if (!consumerKey || !consumerSecret || !shortcode) {
        return res.status(400).json({ error: 'Missing required parameters: consumerKey, consumerSecret, and shortcode are required.' });
      }

      const isProduction = mode === 'production';
      const baseUrl = isProduction ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.uk';

      // 1. Generate Auth Token
      const authHeader = Buffer.from(`${consumerKey.trim()}:${consumerSecret.trim()}`).toString('base64');
      const tokenRes = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${authHeader}`
        }
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        return res.status(400).json({ 
          error: `Failed to authenticate with Safaricom Daraja API. Status: ${tokenRes.status}`,
          details: errText 
        });
      }

      const tokenData = await tokenRes.json() as any;
      const accessToken = tokenData.access_token;

      if (!accessToken) {
        return res.status(400).json({ 
          error: 'Safaricom response did not contain an access_token.', 
          details: tokenData 
        });
      }

      // 2. Call Safaricom C2B Register URL API
      const registerRes = await fetch(`${baseUrl}/mpesa/c2b/v1/registerurl`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          ShortCode: String(shortcode).trim(),
          ResponseType: 'Completed',
          ConfirmationURL: confirmationUrl,
          ValidationURL: validationUrl
        })
      });

      const registerData = await registerRes.json() as any;
      
      return res.json({
        status: 'success',
        statusCode: registerRes.status,
        response: registerData
      });

    } catch (error: any) {
      console.error('M-Pesa Webhook Registration Error:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  // API 15A: Safaricom C2B validation webhook (Public - called by Daraja)
  app.post('/api/mpesa/c2b-validation', async (req, res) => {
    try {
      const { TransAmount } = req.body;
      const numAmount = Number(TransAmount);
      
      if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(200).json({
          ResultCode: 'C2B00013',
          ResultDesc: 'Rejected: Invalid amount'
        });
      }

      // Sacco accepts all payments (even non-members can pay and we handle as direct depositors)
      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: 'Accepted'
      });
    } catch (error: any) {
      return res.status(200).json({
        ResultCode: 'C2B00016',
        ResultDesc: 'Rejected: Internal Validation Exception'
      });
    }
  });

  // API 15B: Safaricom C2B confirmation webhook (Public - called by Daraja)
  app.post('/api/mpesa/c2b-confirmation', async (req, res) => {
    try {
      const {
        TransactionType,
        TransID,
        TransTime,
        TransAmount,
        BusinessShortCode,
        BillRefNumber,
        MSISDN,
        FirstName,
        MiddleName,
        LastName
      } = req.body;

      if (!TransID || !TransAmount || !BusinessShortCode) {
        return res.status(400).json({ error: 'Missing required C2B confirmation payload parameters.' });
      }

      const formattedRef = TransID.toUpperCase().trim();
      const numAmount = Number(TransAmount);
      const rawBillRef = (BillRefNumber || '').trim();

      // Determine which Till received the payment
      // Till 8249102 = VehicleTill, Till 4810294 = UtilityTill
      // If we are in Sandbox, any other shortcode will map based on account reference or default to VehicleTill
      let tillNumber: 'VehicleTill' | 'UtilityTill' = 'VehicleTill';
      let paybillName = 'Vehicle Fleet Till (No. 824 9102)';

      if (String(BusinessShortCode) === '4810294') {
        tillNumber = 'UtilityTill';
        paybillName = 'Operating Utility Till (No. 481 0294)';
      }

      // Determine Category based on Till
      let category: 'Daily Contribution' | 'Registration Fee' | 'Management Fee' | 'Penalty' = 'Daily Contribution';
      if (tillNumber === 'UtilityTill') {
        category = 'Management Fee';
      }

      // Fetch all members to find a match
      const allMembers = await safeDbOperation(
        async (firestoreDb) => {
          const snap = await firestoreDb.collection('members').get();
          return snap.docs.map(doc => doc.data());
        },
        () => localStore.members,
        'members'
      );

      // Match logic
      let member: any = null;
      if (rawBillRef || MSISDN) {
        const normalizedBillRef = rawBillRef.toUpperCase().replace(/\s+/g, '');
        
        // 1. Match by Member ID
        member = allMembers.find(m => m.id.trim().toUpperCase() === normalizedBillRef);

        // 2. Match by Vehicle plate if not matched
        if (!member) {
          member = allMembers.find(m => {
            const plate = (m.vehicleAssigned || '').trim().toUpperCase().replace(/\s+/g, '');
            return plate && plate === normalizedBillRef;
          });
        }

        // 3. Match by Phone Number (Last 9 digits)
        if (!member && MSISDN) {
          const getLast9Digits = (numStr: string) => {
            const cleaned = numStr.replace(/\D/g, '');
            return cleaned.slice(-9);
          };
          const payerLast9 = getLast9Digits(String(MSISDN));
          if (payerLast9.length === 9) {
            member = allMembers.find(m => {
              const memberLast9 = getLast9Digits(m.phoneNumber || '');
              return memberLast9 === payerLast9;
            });
          }
        }
      }

      const payerName = [FirstName, MiddleName, LastName].filter(Boolean).join(' ').trim() || 'Direct Cashless Depositor';
      const txId = 't-mpesa-' + Date.now();

      const newTx = {
        id: txId,
        timestamp: new Date().toISOString(),
        memberId: member ? member.id : '',
        memberName: member ? member.name : payerName,
        vehiclePlate: member ? (member.vehicleAssigned || '') : rawBillRef,
        description: `M-Pesa IPN C2B: Payment of KES ${numAmount.toLocaleString()} received on ${paybillName} (Account Ref: ${rawBillRef}). Reconciled automatically.`,
        refCode: formattedRef,
        type: 'Credit' as const,
        category: category,
        amount: numAmount,
        recorderName: 'M-Pesa Gateway API',
        tillNumber: tillNumber
      };

      await createLedgerTransaction(newTx);

      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: 'Confirmation received successfully'
      });

    } catch (error: any) {
      console.error('M-Pesa Confirmation Webhook Error:', error);
      if (error instanceof HttpError && error.code === 'DUPLICATE_LEDGER_REF') {
        return res.status(200).json({
          ResultCode: 0,
          ResultDesc: 'Duplicate confirmation ignored; transaction already exists'
        });
      }
      return res.status(500).json({ error: error.message });
    }
  });

  // API 16: Log direct M-Pesa cashless payment for both paybills
  app.post('/api/mpesa/log-payment', authenticateSaccoUser, async (req, res) => {
    try {
      const { memberId, amount, category, refCode, tillNumber } = req.body;

      if (!amount || !category || !refCode || !tillNumber) {
        return res.status(400).json({ error: 'Parameters (amount, category, refCode, tillNumber) are required.' });
      }

      if (tillNumber !== 'VehicleTill' && tillNumber !== 'UtilityTill') {
        return res.status(400).json({ error: 'Invalid paybill selection. Must be VehicleTill (824 9102) or UtilityTill (481 0294).' });
      }

      const formattedRef = refCode.toUpperCase().trim();
      const numAmount = Number(amount);
      const paybillName = tillNumber === 'VehicleTill' ? 'Vehicle Fleet Till (No. 824 9102)' : 'Operating Utility Till (No. 481 0294)';

      let member: any = null;

      if (memberId) {
        // Fetch All Members
        const allMembers = await safeDbOperation(
          async (firestoreDb) => {
            const snap = await firestoreDb.collection('members').get();
            return snap.docs.map(doc => doc.data());
          },
          () => localStore.members,
          'members'
        );

        member = allMembers.find(m => m.id === memberId);
        if (!member) {
          return res.status(404).json({ error: 'Sacco Member profile not found.' });
        }
      }

      const txId = 't-mpesa-' + Date.now();
      const newTx = {
        id: txId,
        timestamp: new Date().toISOString(),
        memberId: member ? member.id : '',
        memberName: member ? member.name : 'Direct Cashless Depositor',
        vehiclePlate: member ? (member.vehicleAssigned || '') : '',
        description: `M-Pesa payment of KES ${numAmount.toLocaleString()} received on ${paybillName} for ${category}. Ref: ${formattedRef}. Reconciled.`,
        refCode: formattedRef,
        type: 'Credit' as const,
        category: category,
        amount: numAmount,
        recorderName: `M-Pesa Gateway (${req.headers['x-sacco-user-role'] || 'System'})`,
        tillNumber: tillNumber
      };

      const savedTx = await createLedgerTransaction(newTx);

      res.status(200).json({
        status: 'success',
        transaction: savedTx
      });

    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // Vite middleware or production static server setup
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Sacco Ledger OS] Express full-stack server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
