/**
 * Simple test to debug why transactions aren't changing monthly totals
 */

import { parseDate, monthEnd } from './performance-engine';

interface TestTransaction {
  date: Date;
  security_id: string;
  quantity: number;
  type: string;
}

interface TestPosition {
  security_id: string;
  quantity: number;
}

/**
 * Test: Apply transactions and track how positions change month by month
 */
export function testTransactionApplication() {
  console.log('\n=== Testing Transaction Application ===\n');

  // Sample transactions from the CSV
  const transactions: TestTransaction[] = [
    { date: parseDate('2025-10-14'), security_id: 'EWZ', quantity: -49.02909689729298, type: 'sell' },
    { date: parseDate('2025-10-15'), security_id: 'NFLX', quantity: 4211.152345617756, type: 'buy' },
    { date: parseDate('2025-10-15'), security_id: 'CASH', quantity: -1200, type: 'contribution' },
    { date: parseDate('2025-10-24'), security_id: 'EWZ', quantity: -49.02909689729298, type: 'sell' },
    { date: parseDate('2025-10-25'), security_id: 'NFLX', quantity: 4211.152345617756, type: 'buy' },
    { date: parseDate('2025-10-25'), security_id: 'CASH', quantity: -1200, type: 'contribution' },
  ];

  // Starting positions (from START row in positions CSV)
  let positions: Map<string, number> = new Map([
    ['CASH', 7200.01],
    ['NFLX', -15266.914073706535],
    ['EWZ', 348.2036782810508],
  ]);

  console.log('Starting positions:');
  for (const [sid, qty] of positions) {
    console.log(`  ${sid}: ${qty}`);
  }

  // Month-ends to check
  const monthEnds = [
    parseDate('2025-10-31'),
    parseDate('2025-11-30'),
    parseDate('2025-12-31'),
  ];

  // Group transactions by month-end
  const transactionsByMonthEnd = new Map<string, TestTransaction[]>();
  for (const tx of transactions) {
    const me = monthEnd(tx.date);
    const meKey = me.toISOString().split('T')[0];
    if (!transactionsByMonthEnd.has(meKey)) {
      transactionsByMonthEnd.set(meKey, []);
    }
    transactionsByMonthEnd.get(meKey)!.push(tx);
    console.log(`\nTransaction: ${tx.date.toISOString().split('T')[0]} -> month-end: ${meKey}`);
    console.log(`  ${tx.type} ${tx.security_id}: ${tx.quantity > 0 ? '+' : ''}${tx.quantity}`);
  }

  console.log('\n=== Applying transactions month by month ===\n');

  // Track positions at each month-end
  const positionsByMonth = new Map<string, Map<string, number>>();

  for (const me of monthEnds) {
    const meKey = me.toISOString().split('T')[0];
    console.log(`\n--- Month-end: ${meKey} ---`);
    
    // Get transactions for this month-end
    const monthTxs = transactionsByMonthEnd.get(meKey) || [];
    console.log(`Transactions to apply: ${monthTxs.length}`);
    
    // Apply transactions
    for (const tx of monthTxs) {
      const currentQty = positions.get(tx.security_id) || 0;
      const newQty = currentQty + tx.quantity;
      positions.set(tx.security_id, newQty);
      console.log(`  ${tx.type} ${tx.security_id}: ${currentQty} -> ${newQty} (delta: ${tx.quantity > 0 ? '+' : ''}${tx.quantity})`);
    }
    
    // Save positions snapshot
    const snapshot = new Map(positions);
    positionsByMonth.set(meKey, snapshot);
    
    console.log(`\nPositions after ${meKey}:`);
    for (const [sid, qty] of positions) {
      console.log(`  ${sid}: ${qty}`);
    }
  }

  console.log('\n=== Summary ===\n');
  console.log('Positions at each month-end:');
  for (const [meKey, snapshot] of positionsByMonth) {
    console.log(`\n${meKey}:`);
    for (const [sid, qty] of snapshot) {
      console.log(`  ${sid}: ${qty}`);
    }
  }

  return {
    transactions,
    startingPositions: new Map([
      ['CASH', 7200.01],
      ['NFLX', -15266.914073706535],
      ['EWZ', 348.2036782810508],
    ]),
    positionsByMonth,
  };
}

