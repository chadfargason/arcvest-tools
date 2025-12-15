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
