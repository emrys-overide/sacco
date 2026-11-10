// src/server/nightlyReconciliation.ts
// Automated Nightly Reconciliation Worker (Scheduled nightly at 23:30 EAT / 20:30 UTC)

import type { Pool } from 'pg';
import {
  listPendingStkTransactionsForReconciliation,
  resolveReconciledStkTransaction
} from './postgresStore';
import { queryDarajaStkStatus } from './darajaMpesa';

export interface ReconciliationReport {
  timestamp: string;
  totalPendingScanned: number;
  reconciledSuccessCount: number;
  expiredUnpaidCount: number;
  reconciledTotalAmount: number;
  transactions: Array<{
    checkoutRequestId: string;
    memberId: string;
    amount: number;
    finalStatus: 'RESOLVED_RECONCILED' | 'EXPIRED_UNPAID';
    receiptNumber?: string;
    reason: string;
  }>;
}

export async function runNightlyReconciliation(
  pool: Pool,
  onNotifyManagement?: (report: ReconciliationReport) => Promise<void>
): Promise<ReconciliationReport> {
  const pendingTransactions = await listPendingStkTransactionsForReconciliation(pool);

  const report: ReconciliationReport = {
    timestamp: new Date().toISOString(),
    totalPendingScanned: pendingTransactions.length,
    reconciledSuccessCount: 0,
    expiredUnpaidCount: 0,
    reconciledTotalAmount: 0,
    transactions: []
  };

  for (const tx of pendingTransactions) {
    try {
      const statusRes = await queryDarajaStkStatus(tx.checkoutRequestId);

      if (statusRes.resultCode === 0) {
        const receipt = `REC_${tx.checkoutRequestId.slice(-8).toUpperCase()}`;
        await resolveReconciledStkTransaction(pool, {
          checkoutRequestId: tx.checkoutRequestId,
          mpesaReceiptNumber: receipt,
          status: 'RESOLVED_RECONCILED',
          resultDescription: statusRes.resultDesc || 'Auto-resolved via Daraja Status Query'
        });

        report.reconciledSuccessCount++;
        report.reconciledTotalAmount += tx.amount;
        report.transactions.push({
          checkoutRequestId: tx.checkoutRequestId,
          memberId: tx.memberId,
          amount: tx.amount,
          finalStatus: 'RESOLVED_RECONCILED',
          receiptNumber: receipt,
          reason: statusRes.resultDesc
        });
      } else {
        await resolveReconciledStkTransaction(pool, {
          checkoutRequestId: tx.checkoutRequestId,
          status: 'EXPIRED_UNPAID',
          resultDescription: statusRes.resultDesc || 'Unpaid / Expired after timeout'
        });

        report.expiredUnpaidCount++;
        report.transactions.push({
          checkoutRequestId: tx.checkoutRequestId,
          memberId: tx.memberId,
          amount: tx.amount,
          finalStatus: 'EXPIRED_UNPAID',
          reason: statusRes.resultDesc
        });
      }
    } catch (err) {
      console.error(
        `[Reconciliation Worker] Error querying Daraja for ${tx.checkoutRequestId}:`,
        err
      );
    }
  }

  if (onNotifyManagement) {
    try {
      await onNotifyManagement(report);
    } catch (notifyErr) {
      console.error('[Reconciliation Worker] Notification error:', notifyErr);
    }
  }

  return report;
}

let reconciliationTimer: NodeJS.Timeout | null = null;
let lastRunDateString = '';

/**
 * Starts the nightly background scheduler.
 * Runs check every minute; triggers when East Africa Time is 23:30 (20:30 UTC).
 */
export function startNightlyReconciliationScheduler(
  pool: Pool,
  onNotifyManagement?: (report: ReconciliationReport) => Promise<void>
) {
  if (reconciliationTimer) clearInterval(reconciliationTimer);

  reconciliationTimer = setInterval(async () => {
    const now = new Date();
    // EAT is UTC+3
    const eatHours = (now.getUTCHours() + 3) % 24;
    const eatMinutes = now.getUTCMinutes();
    const dateStr = now.toISOString().slice(0, 10);

    // Trigger at 23:30 EAT once per day
    if (eatHours === 23 && eatMinutes === 30 && lastRunDateString !== dateStr) {
      lastRunDateString = dateStr;
      console.log(`[Reconciliation Worker] 23:30 EAT reached. Starting nightly audit for ${dateStr}...`);
      try {
        const report = await runNightlyReconciliation(pool, onNotifyManagement);
        console.log(
          `[Reconciliation Worker] Completed: Scanned ${report.totalPendingScanned}, Reconciled: ${report.reconciledSuccessCount}, Expired: ${report.expiredUnpaidCount}`
        );
      } catch (err) {
        console.error('[Reconciliation Worker] Nightly audit failed:', err);
      }
    }
  }, 60 * 1000);

  return () => {
    if (reconciliationTimer) {
      clearInterval(reconciliationTimer);
      reconciliationTimer = null;
    }
  };
}
