/**
 * Portfolio X-Ray - Debug Export Utilities
 *
 * Exports portfolio data to CSV and text files for debugging.
 */

import { PortfolioSnapshot, Transaction, Security, PortfolioResult } from './types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Ensure directory exists.
 */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Export monthly snapshots to CSV.
 */
export function exportSnapshotsToCSV(
  accountId: string,
  snapshots: PortfolioSnapshot[],
  securities: Map<string, Security>,
  outputDir: string
): void {
  ensureDir(outputDir);

  const lines = ['Date,Security,Ticker,Quantity,Price,Value,Cash,TotalValue'];

  for (const snapshot of snapshots) {
    for (const [secId, position] of snapshot.positions) {
      const security = securities.get(secId);
      const ticker = security?.ticker_symbol || security?.name || secId;

      lines.push(
        [
          snapshot.date,
          security?.name || 'Unknown',
          ticker,
          position.quantity.toFixed(6),
          position.price.toFixed(4),
          position.value.toFixed(2),
          snapshot.cash.toFixed(2),
          snapshot.totalValue.toFixed(2),
        ].join(',')
      );
    }

    // Add cash line if there's cash
    if (Math.abs(snapshot.cash) > 0.01) {
      lines.push(
        [
          snapshot.date,
          'Cash',
          'CASH',
          '1',
          snapshot.cash.toFixed(2),
          snapshot.cash.toFixed(2),
          snapshot.cash.toFixed(2),
          snapshot.totalValue.toFixed(2),
        ].join(',')
      );
    }
  }

  const filepath = path.join(outputDir, 'monthly_snapshots.csv');
  fs.writeFileSync(filepath, lines.join('\n'));
  console.log(`Exported monthly snapshots to ${filepath}`);
}

/**
 * Export transactions to CSV.
 */
export function exportTransactionsToCSV(
  accountId: string,
  transactions: Transaction[],
  securities: Map<string, Security>,
  outputDir: string
): void {
  ensureDir(outputDir);

  const lines = ['Date,Type,Subtype,Security,Ticker,Quantity,Price,Amount,Fees,Name'];

  const sortedTxs = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  for (const tx of sortedTxs) {
    const security = tx.security_id ? securities.get(tx.security_id) : null;
    const ticker = security?.ticker_symbol || security?.name || 'N/A';

    lines.push(
      [
        tx.date,
        tx.type,
        tx.subtype || '',
        security?.name || 'N/A',
        ticker,
        tx.quantity.toFixed(6),
        tx.price.toFixed(4),
        tx.amount.toFixed(2),
        tx.fees.toFixed(2),
        `"${tx.name.replace(/"/g, '""')}"`,
      ].join(',')
    );
  }

  const filepath = path.join(outputDir, 'transactions.csv');
  fs.writeFileSync(filepath, lines.join('\n'));
  console.log(`Exported transactions to ${filepath}`);
}

/**
 * Export summary to text file.
 */
export function exportSummaryToText(
  accountId: string,
  result: PortfolioResult,
  outputDir: string
): void {
  ensureDir(outputDir);

  const lines = [
    '='.repeat(60),
    `Portfolio X-Ray Summary - Account ${accountId}`,
    '='.repeat(60),
    '',
    `Period: ${result.startDate} to ${result.endDate}`,
    '',
    'PORTFOLIO PERFORMANCE',
    '-'.repeat(60),
    `Start Value:           $${result.startValue.toFixed(2).padStart(15)}`,
    `End Value:             $${result.endValue.toFixed(2).padStart(15)}`,
    `Total Return:           ${result.totalReturn.toFixed(2).padStart(14)}%`,
    `Annualized Return:      ${result.annualizedReturn.toFixed(2).padStart(14)}%`,
    `IRR:                    ${result.irr ? result.irr.toFixed(2).padStart(14) + '%' : 'N/A'.padStart(15)}`,
    '',
    'BENCHMARK COMPARISON',
    '-'.repeat(60),
    `Benchmark Return:       ${result.benchmark.return.toFixed(2).padStart(14)}%`,
    `Benchmark IRR:          ${result.benchmark.irr ? result.benchmark.irr.toFixed(2).padStart(14) + '%' : 'N/A'.padStart(15)}`,
    `Outperformance:         ${result.outperformance.toFixed(2).padStart(14)}%`,
    '',
    'BENCHMARK WEIGHTS',
    '-'.repeat(60),
  ];

  for (const [ticker, weight] of result.benchmark.weights) {
    lines.push(`  ${ticker.padEnd(10)}: ${weight.toFixed(2).padStart(10)}%`);
  }

  lines.push('');
  lines.push('FEES');
  lines.push('-'.repeat(60));
  lines.push(`Explicit Fees:         $${result.fees.explicitFees.toFixed(2).padStart(15)}`);
  lines.push(`Implicit Fees (est):   $${result.fees.implicitFees.toFixed(2).padStart(15)}`);
  lines.push(`Total Fees:            $${result.fees.totalFees.toFixed(2).padStart(15)}`);
  lines.push('');
  lines.push('='.repeat(60));

  const filepath = path.join(outputDir, 'summary.txt');
  fs.writeFileSync(filepath, lines.join('\n'));
  console.log(`Exported summary to ${filepath}`);
}

/**
 * Export transaction ledger showing running balances.
 */
export function exportTransactionLedger(
  accountId: string,
  snapshots: PortfolioSnapshot[],
  transactions: Transaction[],
  securities: Map<string, Security>,
  outputDir: string
): void {
  ensureDir(outputDir);

  if (snapshots.length === 0) {
    console.log('No snapshots to export ledger');
    return;
  }

  const startSnapshot = snapshots[0];
  const endSnapshot = snapshots[snapshots.length - 1];

  const sortedTxs = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  // Get all unique securities
  const allSecurityIds = new Set<string>();
  for (const tx of sortedTxs) {
    if (tx.security_id) {
      allSecurityIds.add(tx.security_id);
    }
  }
  for (const [secId] of startSnapshot.positions) {
    allSecurityIds.add(secId);
  }

  const lines: string[] = [];

  // Header
  lines.push('='.repeat(120));
  lines.push(`TRANSACTION LEDGER - Account ${accountId}`);
  lines.push(`Period: ${startSnapshot.date} to ${endSnapshot.date}`);
  lines.push('='.repeat(120));
  lines.push('');

  // Process each security
  for (const securityId of Array.from(allSecurityIds).sort()) {
    const security = securities.get(securityId);
    const ticker = security?.ticker_symbol || security?.name || securityId;
    const name = security?.name || 'Unknown';

    lines.push('');
    lines.push('-'.repeat(120));
    lines.push(`SECURITY: ${ticker} - ${name}`);
    lines.push('-'.repeat(120));

    // Starting position
    const startPos = startSnapshot.positions.get(securityId);
    if (startPos) {
      lines.push(`START (${startSnapshot.date}): Qty=${startPos.quantity.toFixed(6)}, Price=$${startPos.price.toFixed(4)}, Value=$${startPos.value.toFixed(2)}`);
    } else {
      lines.push(`START (${startSnapshot.date}): No position`);
    }
    lines.push('');

    // Column headers
    lines.push('Date       | Type       | Quantity      | Price      | Amount      | Fees      | Running Qty   | Description');
    lines.push('-'.repeat(120));

    // Track running quantity
    let runningQty = startPos ? startPos.quantity : 0;

    // Show all transactions for this security
    const securityTxs = sortedTxs.filter(tx => tx.security_id === securityId);

    if (securityTxs.length === 0) {
      lines.push('(No transactions for this security)');
    } else {
      for (const tx of securityTxs) {
        runningQty += tx.quantity;

        const qtyStr = tx.quantity >= 0 ? `+${tx.quantity.toFixed(6)}` : tx.quantity.toFixed(6);
        const priceStr = tx.price > 0 ? `$${tx.price.toFixed(4)}` : 'N/A';
        const amountStr = `$${tx.amount.toFixed(2)}`;
        const feesStr = tx.fees > 0 ? `$${tx.fees.toFixed(2)}` : '-';
        const runningStr = runningQty.toFixed(6);

        lines.push(
          `${tx.date} | ${tx.type.padEnd(10)} | ${qtyStr.padStart(13)} | ${priceStr.padStart(10)} | ${amountStr.padStart(11)} | ${feesStr.padStart(9)} | ${runningStr.padStart(13)} | ${tx.name.substring(0, 40)}`
        );
      }
    }

    lines.push('');

    // Ending position
    const endPos = endSnapshot.positions.get(securityId);
    if (endPos) {
      lines.push(`END (${endSnapshot.date}):   Qty=${endPos.quantity.toFixed(6)}, Price=$${endPos.price.toFixed(4)}, Value=$${endPos.value.toFixed(2)}`);
    } else {
      lines.push(`END (${endSnapshot.date}):   No position`);
    }
  }

  // Cash section
  lines.push('');
  lines.push('');
  lines.push('-'.repeat(120));
  lines.push('CASH');
  lines.push('-'.repeat(120));
  lines.push(`START (${startSnapshot.date}): $${startSnapshot.cash.toFixed(2)}`);
  lines.push('');
  lines.push('Date       | Type       | Amount      | Description');
  lines.push('-'.repeat(120));

  // Show cash transactions
  const cashTxs = sortedTxs.filter(tx =>
    !tx.security_id || securities.get(tx.security_id)?.is_cash_equivalent
  );

  if (cashTxs.length === 0) {
    lines.push('(No cash transactions)');
  } else {
    for (const tx of cashTxs) {
      const amountStr = `$${tx.amount.toFixed(2)}`;
      lines.push(
        `${tx.date} | ${tx.type.padEnd(10)} | ${amountStr.padStart(11)} | ${tx.name.substring(0, 60)}`
      );
    }
  }

  lines.push('');
  lines.push(`END (${endSnapshot.date}):   $${endSnapshot.cash.toFixed(2)}`);
  lines.push('');
  lines.push('='.repeat(120));

  const filepath = path.join(outputDir, 'transaction_ledger.txt');
  fs.writeFileSync(filepath, lines.join('\n'));
  console.log(`Exported transaction ledger to ${filepath}`);
}
