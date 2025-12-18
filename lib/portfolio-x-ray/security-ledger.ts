/**
 * Portfolio X-Ray - Security Ledger Builder
 *
 * Builds a per-security transaction ledger showing:
 * - Starting position (inferred)
 * - Each transaction with running quantity
 * - Ending position
 *
 * This is invaluable for debugging position reconstruction.
 */

import {
  Security,
  Transaction,
  PortfolioSnapshot,
  SecurityLedger,
  SecurityLedgerEntry,
} from './types';

/**
 * Build security ledgers from snapshots and transactions.
 *
 * @param snapshots Monthly portfolio snapshots
 * @param transactions All transactions in the period
 * @param securities Security metadata
 * @returns Array of security ledgers, one per security
 */
export function buildSecurityLedgers(
  snapshots: PortfolioSnapshot[],
  transactions: Transaction[],
  securities: Map<string, Security>
): SecurityLedger[] {
  if (snapshots.length === 0) {
    return [];
  }

  const firstSnapshot = snapshots[0];
  const lastSnapshot = snapshots[snapshots.length - 1];

  // Collect all security IDs from snapshots and transactions
  const allSecurityIds = new Set<string>();

  for (const snapshot of snapshots) {
    for (const secId of snapshot.positions.keys()) {
      allSecurityIds.add(secId);
    }
  }

  for (const tx of transactions) {
    if (tx.security_id) {
      allSecurityIds.add(tx.security_id);
    }
  }

  // Sort transactions by date
  const sortedTxs = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  // Build ledger for each security
  const ledgers: SecurityLedger[] = [];

  for (const securityId of allSecurityIds) {
    const security = securities.get(securityId);

    // Skip cash equivalents
    if (security?.is_cash_equivalent) {
      continue;
    }

    const ticker = security?.ticker_symbol || security?.name || securityId;
    const name = security?.name || 'Unknown';

    // Get starting position from first snapshot
    const startPos = firstSnapshot.positions.get(securityId);
    const startingQty = startPos?.quantity || 0;
    const startingPrice = startPos?.price || 0;

    // Get ending position from last snapshot
    const endPos = lastSnapshot.positions.get(securityId);
    const endingQty = endPos?.quantity || 0;
    const endingPrice = endPos?.price || 0;

    // Build entries
    const entries: SecurityLedgerEntry[] = [];

    // Add starting position entry
    if (Math.abs(startingQty) > 0.000001) {
      entries.push({
        date: firstSnapshot.date,
        type: 'starting_position',
        quantity: startingQty,
        price: startingPrice,
        amount: startingQty * startingPrice,
        fees: 0,
        runningQty: startingQty,
        description: 'Starting position (inferred)',
      });
    }

    // Add transaction entries
    let runningQty = startingQty;
    const securityTxs = sortedTxs.filter(tx => tx.security_id === securityId);

    for (const tx of securityTxs) {
      runningQty += tx.quantity;

      entries.push({
        date: tx.date,
        type: tx.type,
        quantity: tx.quantity,
        price: tx.price,
        amount: tx.amount,
        fees: tx.fees,
        runningQty: runningQty,
        description: tx.name || `${tx.type}${tx.subtype ? ` (${tx.subtype})` : ''}`,
      });
    }

    // Only include securities that have transactions or non-zero positions
    if (entries.length > 0 || Math.abs(endingQty) > 0.000001) {
      ledgers.push({
        securityId,
        ticker,
        name,
        entries,
        startingQty,
        endingQty,
        startingPrice,
        endingPrice,
      });
    }
  }

  // Sort ledgers by ticker for consistent ordering
  ledgers.sort((a, b) => a.ticker.localeCompare(b.ticker));

  return ledgers;
}

/**
 * Build a cash ledger (similar to security ledger but for cash).
 *
 * Shows ALL transactions that affect cash, including:
 * - Pure cash transactions (deposits, withdrawals)
 * - Cash equivalents (money market funds)
 * - Buy/sell transactions (these move cash in/out)
 */
export function buildCashLedger(
  snapshots: PortfolioSnapshot[],
  transactions: Transaction[],
  securities: Map<string, Security>
): SecurityLedger {
  if (snapshots.length === 0) {
    return {
      securityId: 'CASH',
      ticker: 'CASH',
      name: 'Cash',
      entries: [],
      startingQty: 0,
      endingQty: 0,
      startingPrice: 1,
      endingPrice: 1,
    };
  }

  const firstSnapshot = snapshots[0];
  const lastSnapshot = snapshots[snapshots.length - 1];

  const startingCash = firstSnapshot.cash;
  const endingCash = lastSnapshot.cash;

  // Sort transactions by date
  const sortedTxs = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  // ALL transactions affect cash (via the amount field)
  // Only skip transactions with zero cash impact
  const cashTxs = sortedTxs.filter(tx => Math.abs(tx.amount) > 0.001);

  const entries: SecurityLedgerEntry[] = [];

  // Add starting position
  entries.push({
    date: firstSnapshot.date,
    type: 'starting_position',
    quantity: 1,
    price: startingCash,
    amount: startingCash,
    fees: 0,
    runningQty: startingCash,
    description: 'Starting cash (inferred)',
  });

  // Add cash transactions
  let runningCash = startingCash;

  for (const tx of cashTxs) {
    // Cash changes by -amount (positive amount = cash out)
    runningCash -= tx.amount;

    // Build description with security info if applicable
    let description = tx.name || `${tx.type}${tx.subtype ? ` (${tx.subtype})` : ''}`;
    if (tx.security_id) {
      const security = securities.get(tx.security_id);
      const ticker = security?.ticker_symbol || security?.name;
      if (ticker) {
        description = `${tx.type}: ${ticker}`;
      }
    }

    entries.push({
      date: tx.date,
      type: tx.type,
      quantity: -tx.amount, // Show as change in cash
      price: 1,
      amount: tx.amount,
      fees: tx.fees,
      runningQty: runningCash,
      description,
    });
  }

  return {
    securityId: 'CASH',
    ticker: 'CASH',
    name: 'Cash',
    entries,
    startingQty: startingCash,
    endingQty: endingCash,
    startingPrice: 1,
    endingPrice: 1,
  };
}
