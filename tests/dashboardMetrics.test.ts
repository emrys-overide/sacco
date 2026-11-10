import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDashboardMetrics, getRecentDailySeries } from '../src/lib/dashboardMetrics.ts';
import type { Transaction, Vehicle, Member } from '../src/types.ts';

test('dashboardMetrics temporal scoping and accurate calculations', async (t) => {
  const dummyVehicles: Vehicle[] = [
    { id: 'v1', plateNumber: 'KAA 001A', status: 'Active', capacity: 14, route: 'Town', ownerId: 'm1', ownerName: 'Alice', driverName: 'Driver 1', driverPhone: '0700000001', dateRegistered: '2026-01-01' },
    { id: 'v2', plateNumber: 'KBB 002B', status: 'Active', capacity: 14, route: 'Town', ownerId: 'm2', ownerName: 'Bob', driverName: 'Driver 2', driverPhone: '0700000002', dateRegistered: '2026-01-01' }
  ];

  const dummyMembers: Member[] = [
    { id: 'm1', name: 'Alice Member', membershipNumber: 'SWT-001', phoneNumber: '0711111111', idNumber: '11111111', dateRegistered: '2026-01-01', status: 'Active', sharesAmount: 5000, savingsAmount: 10000 },
    { id: 'm2', name: 'Bob Member', membershipNumber: 'SWT-002', phoneNumber: '0722222222', idNumber: '22222222', dateRegistered: '2026-01-01', status: 'Active', sharesAmount: 5000, savingsAmount: 10000 }
  ];

  const transactions: Transaction[] = [
    // Month 1 (September)
    { id: 't1', timestamp: '2026-09-15T08:00:00.000Z', type: 'Credit', category: 'Daily Contribution', amount: 500, tillNumber: 'VehicleTill', refCode: 'SWT-1', recorderName: 'Admin', description: 'daily' },
    { id: 't2', timestamp: '2026-09-15T09:00:00.000Z', type: 'Credit', category: 'Daily Contribution', amount: 500, tillNumber: 'VehicleTill', refCode: 'SWT-2', recorderName: 'Admin', description: 'daily' },
    
    // Month 2 (October)
    { id: 't3', timestamp: '2026-10-20T08:00:00.000Z', type: 'Credit', category: 'Daily Contribution', amount: 600, tillNumber: 'VehicleTill', refCode: 'SWT-3', recorderName: 'Admin', description: 'daily' },

    // Month 3 (November) - Previous day (Nov 5)
    { id: 't4', timestamp: '2026-11-05T08:00:00.000Z', type: 'Credit', category: 'Daily Contribution', amount: 1000, tillNumber: 'VehicleTill', refCode: 'SWT-4', recorderName: 'Admin', description: 'daily' },

    // Month 3 (November) - Operational day (Nov 6)
    { id: 't5', timestamp: '2026-11-06T08:00:00.000Z', type: 'Credit', category: 'Daily Contribution', amount: 1200, tillNumber: 'VehicleTill', refCode: 'SWT-5', recorderName: 'Admin', description: 'daily' },
    { id: 't6', timestamp: '2026-11-06T09:00:00.000Z', type: 'Credit', category: 'Daily Contribution', amount: 800, tillNumber: 'VehicleTill', refCode: 'SWT-6', recorderName: 'Admin', description: 'daily' },
    { id: 't7', timestamp: '2026-11-06T10:00:00.000Z', type: 'Debit', category: 'Office Expenses', amount: 200, tillNumber: 'VehicleTill', refCode: 'EXP-1', recorderName: 'Admin', description: 'expense' }
  ];

  await t.test('scopes todayCredits strictly to the active operational day', () => {
    const metrics = calculateDashboardMetrics(transactions, dummyVehicles, dummyMembers);

    // Active operational day should be 2026-11-06 with total 1200 + 800 = 2000
    assert.equal(metrics.todayCredits, 2000, 'Today credits must only sum entries on active operational day (not all-time 4600)');
    assert.equal(metrics.operationalDateLabel, 'Nov 6');
    assert.equal(metrics.yesterdayCredits, 1000, 'Yesterday credits must match previous operating day (Nov 5)');
    assert.equal(metrics.dailyPercentChange, 100, '+100% growth from 1000 to 2000');
  });

  await t.test('scopes monthToDateCredits strictly to the active month (November)', () => {
    const metrics = calculateDashboardMetrics(transactions, dummyVehicles, dummyMembers);

    // November credits: 1000 (Nov 5) + 1200 (Nov 6) + 800 (Nov 6) = 3000
    assert.equal(metrics.monthToDateCredits, 3000, 'Month-to-date must only sum November credits');
    assert.equal(metrics.monthToDateDebits, 200, 'Month-to-date debits must only sum November expenses');
  });

  await t.test('preserves allTimeCredits without conflating it with today', () => {
    const metrics = calculateDashboardMetrics(transactions, dummyVehicles, dummyMembers);

    // All-time credits: 500 + 500 + 600 + 1000 + 1200 + 800 = 4600
    assert.equal(metrics.allTimeCredits, 4600);
    assert.equal(metrics.allTimeDebits, 200);

    // Operations account net: 4600 - 200 = 4400
    assert.equal(metrics.operationsAccountBalance, 4400);
  });
});
