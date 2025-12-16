/**
 * Debug utilities for Portfolio Calculator V2
 */

import { PortfolioSnapshot, Transaction, Security, Holding } from './portfolio-calculator-v2';
import * as fs from 'fs';
import * as path from 'path';

export function exportSnapshotsToCSV(
  accountId: string,
  snapshots: PortfolioSnapshot[],
  securities: Map<string, Security>,
  outputDir: string
): void {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Monthly snapshots CSV
  const monthlyLines = ['Date,Security,Ticker,Quantity,Price,Value,Cash,TotalValue'];

  for (const snapshot of snapshots) {
    for (const [secId, position] of snapshot.positions) {
      const security = securities.get(secId);
      const ticker = security?.ticker_symbol || security?.name || secId;

      monthlyLines.push(
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
    if (snapshot.cash > 0.01) {
      monthlyLines.push(
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

  fs.writeFileSync(path.join(outputDir, 'monthly_snapshots.csv'), monthlyLines.join('\n'));
  console.log(`Exported monthly snapshots to ${path.join(outputDir, 'monthly_snapshots.csv')}`);
}

export function exportTransactionsToCSV(
  accountId: string,
  transactions: Transaction[],
  securities: Map<string, Security>,
  outputDir: string
): void {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const lines = ['Date,Type,Subtype,Security,Ticker,Quantity,Price,Amount,Fees,Name'];

  const sortedTxs = [...transactions]
    .filter(t => t.account_id === accountId)
    .sort((a, b) => a.date.localeCompare(b.date));

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

  fs.writeFileSync(path.join(outputDir, 'transactions.csv'), lines.join('\n'));
  console.log(`Exported transactions to ${path.join(outputDir, 'transactions.csv')}`);
}

export function exportSummaryToText(
  accountId: string,
  result: {
    startDate: string;
    endDate: string;
    startValue: number;
    endValue: number;
    totalReturn: number;
    annualizedReturn: number;
    irr: number | null;
    benchmarkReturn: number;
    benchmarkIrr: number | null;
    explicitFees: number;
    implicitFees: number;
    totalFees: number;
  },
  outputDir: string
): void {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

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
    `Benchmark Return:       ${result.benchmarkReturn.toFixed(2).padStart(14)}%`,
    `Benchmark IRR:          ${result.benchmarkIrr ? result.benchmarkIrr.toFixed(2).padStart(14) + '%' : 'N/A'.padStart(15)}`,
    `Outperformance:         ${(result.annualizedReturn - result.benchmarkReturn).toFixed(2).padStart(14)}%`,
    '',
    'FEES',
    '-'.repeat(60),
    `Explicit Fees:         $${result.explicitFees.toFixed(2).padStart(15)}`,
    `Implicit Fees (est):   $${result.implicitFees.toFixed(2).padStart(15)}`,
    `Total Fees:            $${result.totalFees.toFixed(2).padStart(15)}`,
    '',
    '='.repeat(60),
  ];

  fs.writeFileSync(path.join(outputDir, 'summary.txt'), lines.join('\n'));
  console.log(`Exported summary to ${path.join(outputDir, 'summary.txt')}`);
}

/**
 * Export complete transaction ledger by security showing running balances
 */
export function exportTransactionLedger(
  accountId: string,
  snapshots: PortfolioSnapshot[],
  transactions: Transaction[],
  securities: Map<string, Security>,
  outputDir: string
): void {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  if (snapshots.length === 0) {
    console.log('No snapshots to export ledger');
    return;
  }

  const startSnapshot = snapshots[0];
  const endSnapshot = snapshots[snapshots.length - 1];

  // Group transactions by security
  const accountTxs = transactions
    .filter(t => t.account_id === accountId)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Get all unique securities from transactions and snapshots
  const allSecurityIds = new Set<string>();
  for (const tx of accountTxs) {
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
    const securityTxs = accountTxs.filter(tx => tx.security_id === securityId);

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

  // Show all cash transactions
  const cashTxs = accountTxs.filter(tx => !tx.security_id || securities.get(tx.security_id)?.is_cash_equivalent);

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

  fs.writeFileSync(path.join(outputDir, 'transaction_ledger.txt'), lines.join('\n'));
  console.log(`Exported transaction ledger to ${path.join(outputDir, 'transaction_ledger.txt')}`);
}
