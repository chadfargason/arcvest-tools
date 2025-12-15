/**
 * Debug utilities for portfolio calculation validation
 * Exports portfolio reconstruction data to CSV files
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  parsePlaidHoldings,
  parsePlaidInvestmentTransactions,
  InvestmentTx,
  Holding,
  SecurityMeta,
  iterMonthEnds,
  monthEnd,
  parseDate,
  resolveTicker,
  computePortfolioValuesMonthly,
  reconstructStartPositions,
  computeCashStart,
  MarketDataProvider,
} from './performance-engine';

export interface TransactionRecord {
  date: string;
  type: string;
  subtype: string;
  security_id: string;
  ticker: string;
  name: string;
  quantity: number;
  price: number;
  amount: number;
  fees: number;
  account_id: string;
}

export interface PositionRecord {
  month: string;
  security_id: string;
  ticker: string;
  name: string;
  quantity: number;
  price: number;
  value: number;
  account_id: string;
}

export interface PortfolioSnapshot {
  month: string;
  date: Date;
  total_value: number;
  cash: number;
  positions_count: number;
}

export interface MonthlyValuation {
  month: string;
  date: Date;
  portfolio_value: number;
  cash: number;
  positions: Array<{
    security_id: string;
    ticker: string;
    quantity: number;
    value: number;
  }>;
}

/**
 * Export transactions to CSV with detailed information
 */
export function exportTransactionsToCSV(
  transactions: InvestmentTx[],
  securities: Map<string, SecurityMeta>,
  outputPath: string
): void {
  const records: TransactionRecord[] = [];

  for (const tx of transactions) {
    const security = securities.get(tx.security_id || '');
    const ticker = security?.ticker || resolveTicker(tx.security_id || '', securities) || 'N/A';
    const name = security?.name || tx.name || 'Unknown';

    records.push({
      date: tx.date.toISOString().split('T')[0],
      type: tx.type,
      subtype: tx.subtype || '',
      security_id: tx.security_id || '',
      ticker,
      name,
      quantity: tx.quantity,
      price: tx.price,
      amount: tx.amount,
      fees: tx.fees || 0,
      account_id: tx.account_id,
    });
  }

  // Sort by date
  records.sort((a, b) => a.date.localeCompare(b.date));

  // Write CSV
  const headers = [
    'date',
    'type',
    'subtype',
    'security_id',
    'ticker',
    'name',
    'quantity',
    'price',
    'amount',
    'fees',
    'account_id',
  ];

  const lines = [
    headers.join(','),
    ...records.map((r) =>
      [
        r.date,
        r.type,
        r.subtype,
        r.security_id,
        r.ticker,
        `"${r.name.replace(/"/g, '""')}"`,
        r.quantity,
        r.price,
        r.amount,
        r.fees,
        r.account_id,
      ].join(',')
    ),
  ];

  try {
    fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
    console.log(`[DEBUG] Exported ${records.length} transactions to ${outputPath}`);
  } catch (error: any) {
    console.error(`[DEBUG] Error writing transactions CSV: ${error.message}`);
    throw error;
  }
}

/**
 * Export starting and ending positions to CSV
 */
export function exportPositionsToCSV(
  startPositions: Map<string, number>,
  endPositions: Map<string, number>,
  securities: Map<string, SecurityMeta>,
  holdings: Holding[],
  startDate: Date,
  endDate: Date,
  outputPath: string
): void {
  const records: PositionRecord[] = [];

  // Get all unique security IDs
  const allSecurityIds = new Set<string>();
  for (const sid of startPositions.keys()) {
    allSecurityIds.add(sid);
  }
  for (const sid of endPositions.keys()) {
    allSecurityIds.add(sid);
  }
  for (const h of holdings) {
    allSecurityIds.add(h.security_id);
  }

  // Create a map of current prices from holdings
  const currentPrices = new Map<string, number>();
  for (const h of holdings) {
    currentPrices.set(h.security_id, h.institution_price);
  }

  for (const securityId of allSecurityIds) {
    const security = securities.get(securityId);
    const ticker = security?.ticker || resolveTicker(securityId, securities) || 'N/A';
    const name = security?.name || 'Unknown';
    const startQty = startPositions.get(securityId) || 0;
    const endQty = endPositions.get(securityId) || 0;
    const price = currentPrices.get(securityId) || 0;

    // Find account_id from holdings
    const holding = holdings.find((h) => h.security_id === securityId);
    const accountId = holding?.account_id || '';

    // Starting position
    if (startQty !== 0) {
      records.push({
        month: `START (${startDate.toISOString().split('T')[0]})`,
        security_id: securityId,
        ticker,
        name,
        quantity: startQty,
        price,
        value: startQty * price,
        account_id: accountId,
      });
    }

    // Ending position
    if (endQty !== 0) {
      records.push({
        month: `END (${endDate.toISOString().split('T')[0]})`,
        security_id: securityId,
        ticker,
        name,
        quantity: endQty,
        price,
        value: endQty * price,
        account_id: accountId,
      });
    }
  }

  // Write CSV
  const headers = ['month', 'security_id', 'ticker', 'name', 'quantity', 'price', 'value', 'account_id'];
  const lines = [
    headers.join(','),
    ...records.map((r) =>
      [
        r.month,
        r.security_id,
        r.ticker,
        `"${r.name.replace(/"/g, '""')}"`,
        r.quantity,
        r.price,
        r.value,
        r.account_id,
      ].join(',')
    ),
  ];

  try {
    fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
    console.log(`[DEBUG] Exported positions to ${outputPath}`);
  } catch (error: any) {
    console.error(`[DEBUG] Error writing positions CSV: ${error.message}`);
    throw error;
  }
}

/**
 * Reconstruct monthly portfolio positions from transactions
 */
export function reconstructMonthlyPositions(
  startQty: Map<string, number>,
  transactions: InvestmentTx[],
  securities: Map<string, SecurityMeta>,
  holdings: Holding[],
  startDate: Date,
  endDate: Date,
  monthEnds: Date[]
): Map<string, Map<Date, number>> {
  // Track positions by security_id at each month-end
  const monthlyPositions = new Map<string, Map<Date, number>>();

  // Initialize all securities
  for (const sid of startQty.keys()) {
    monthlyPositions.set(sid, new Map());
  }

  // Start with starting positions
  const currentPositions = new Map<string, number>(startQty);

  // Group transactions by month-end
  const transactionsByMonthEnd = new Map<Date, InvestmentTx[]>();
  for (const tx of transactions) {
    if (tx.date < startDate || tx.date > endDate) continue;
    if (tx.type === 'cancel') continue;
    const me = monthEnd(tx.date);
    if (!transactionsByMonthEnd.has(me)) {
      transactionsByMonthEnd.set(me, []);
    }
    transactionsByMonthEnd.get(me)!.push(tx);
  }

  // Process each month-end
  for (const me of monthEnds) {
    // Apply all transactions up to this month-end
    const txsToApply = transactionsByMonthEnd.get(me) || [];
    for (const tx of txsToApply) {
      if (tx.security_id) {
        const current = currentPositions.get(tx.security_id) || 0;
        currentPositions.set(tx.security_id, current + tx.quantity);
      }
    }

    // Record positions at this month-end
    for (const [sid, qty] of currentPositions) {
      if (qty !== 0) {
        if (!monthlyPositions.has(sid)) {
          monthlyPositions.set(sid, new Map());
        }
        monthlyPositions.get(sid)!.set(me, qty);
      }
    }
  }

  return monthlyPositions;
}

/**
 * Export monthly portfolio snapshots to CSV
 */
export function exportMonthlySnapshotsToCSV(
  monthlyPositions: Map<string, Map<Date, number>>,
  securities: Map<string, SecurityMeta>,
  holdings: Holding[],
  monthEnds: Date[],
  portfolioValues: Map<Date, number>,
  outputPath: string
): void {
  const records: Array<{
    month: string;
    date: string;
    security_id: string;
    ticker: string;
    name: string;
    quantity: number;
    price: number;
    value: number;
    portfolio_total_value: number;
  }> = [];

  // Create price map from holdings
  const priceMap = new Map<string, number>();
  for (const h of holdings) {
    priceMap.set(h.security_id, h.institution_price);
  }

  for (const me of monthEnds) {
    const portfolioValue = portfolioValues.get(me) || 0;
    const monthStr = me.toISOString().substring(0, 7); // YYYY-MM

    for (const [securityId, positionsMap] of monthlyPositions) {
      const qty = positionsMap.get(me);
      if (qty != null && qty !== 0) {
        const security = securities.get(securityId);
        const ticker = security?.ticker || resolveTicker(securityId, securities) || 'N/A';
        const name = security?.name || 'Unknown';
        const price = priceMap.get(securityId) || 0;
        const value = qty * price;

        records.push({
          month: monthStr,
          date: me.toISOString().split('T')[0],
          security_id: securityId,
          ticker,
          name,
          quantity: qty,
          price,
          value,
          portfolio_total_value: portfolioValue,
        });
      }
    }

    // Also add a summary row with total
    records.push({
      month: monthStr,
      date: me.toISOString().split('T')[0],
      security_id: 'TOTAL',
      ticker: 'TOTAL',
      name: 'Total Portfolio Value',
      quantity: 0,
      price: 0,
      value: 0,
      portfolio_total_value: portfolioValue,
    });
  }

  // Write CSV
  const headers = [
    'month',
    'date',
    'security_id',
    'ticker',
    'name',
    'quantity',
    'price',
    'value',
    'portfolio_total_value',
  ];
  const lines = [
    headers.join(','),
    ...records.map((r) =>
      [
        r.month,
        r.date,
        r.security_id,
        r.ticker,
        `"${r.name.replace(/"/g, '""')}"`,
        r.quantity,
        r.price,
        r.value,
        r.portfolio_total_value,
      ].join(',')
    ),
  ];

  try {
    fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
    console.log(`[DEBUG] Exported monthly snapshots to ${outputPath}`);
  } catch (error: any) {
    console.error(`[DEBUG] Error writing monthly snapshots CSV: ${error.message}`);
    throw error;
  }
}

/**
 * Main export function - generates all debug CSV files
 */
export async function exportPortfolioDebugData(
  accountId: string,
  holdingsResp: any,
  transactionsResp: any,
  startDate: Date,
  endDate: Date,
  monthEnds: Date[],
  outputDir: string
): Promise<void> {
  console.log(`[DEBUG] Starting export for account ${accountId} to ${outputDir}`);
  
  // Ensure output directory exists
  try {
    if (!fs.existsSync(outputDir)) {
      console.log(`[DEBUG] Creating directory: ${outputDir}`);
      fs.mkdirSync(outputDir, { recursive: true });
    } else {
      console.log(`[DEBUG] Directory already exists: ${outputDir}`);
    }
    
    // Verify directory was created/exists
    if (!fs.existsSync(outputDir)) {
      throw new Error(`Failed to create or verify output directory: ${outputDir}`);
    }
    console.log(`[DEBUG] Output directory verified: ${outputDir}`);
  } catch (error: any) {
    console.error(`[DEBUG] Error creating output directory: ${error.message}`);
    throw error;
  }

  // Parse data
  console.log(`[DEBUG] Parsing holdings and transactions...`);
  const { accounts, holdings: holdingsAll, securities } = parsePlaidHoldings(holdingsResp);
  const txsAll = parsePlaidInvestmentTransactions(transactionsResp);

  console.log(`[DEBUG] Total holdings: ${holdingsAll.length}, Total transactions: ${txsAll.length}`);
  
  const holdings = holdingsAll.filter((h) => h.account_id === accountId);
  const txs = txsAll
    .filter((t) => t.account_id === accountId)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
    
  console.log(`[DEBUG] Filtered holdings for account ${accountId}: ${holdings.length}`);
  console.log(`[DEBUG] Filtered transactions for account ${accountId}: ${txs.length}`);
  
  if (holdings.length === 0 && txs.length === 0) {
    throw new Error(`No holdings or transactions found for account ${accountId}`);
  }

  // Get end quantities
  const endQty = new Map<string, number>();
  for (const h of holdings) {
    endQty.set(h.security_id, h.quantity);
  }

  // Reconstruct start positions
  const startQty = reconstructStartPositions(endQty, txs, startDate, endDate);

  // Export transactions
  const transactionsPath = path.join(outputDir, '01_transactions_chronological.csv');
  exportTransactionsToCSV(txs, securities, transactionsPath);

  // Export starting and ending positions
  const positionsPath = path.join(outputDir, '02_positions_start_end.csv');
  exportPositionsToCSV(startQty, endQty, securities, holdings, startDate, endDate, positionsPath);

  // Reconstruct monthly positions
  const monthlyPositions = reconstructMonthlyPositions(
    startQty,
    txs,
    securities,
    holdings,
    startDate,
    endDate,
    monthEnds
  );

  // Note: For portfolio values, we'd need market data provider
  // For now, use simple valuation based on current prices
  const portfolioValues = new Map<Date, number>();
  for (const me of monthEnds) {
    let total = 0;
    for (const [securityId, positionsMap] of monthlyPositions) {
      const qty = positionsMap.get(me) || 0;
      const holding = holdings.find((h) => h.security_id === securityId);
      const price = holding?.institution_price || 0;
      total += qty * price;
    }
    portfolioValues.set(me, total);
  }

  // Export monthly snapshots
  const monthlyPath = path.join(outputDir, '03_monthly_portfolio_snapshots.csv');
  exportMonthlySnapshotsToCSV(monthlyPositions, securities, holdings, monthEnds, portfolioValues, monthlyPath);

  // Export summary
  const summaryPath = path.join(outputDir, '00_summary.txt');
  const summary = [
    'Portfolio Debug Data Summary',
    '============================',
    '',
    `Account ID: ${accountId}`,
    `Start Date: ${startDate.toISOString().split('T')[0]}`,
    `End Date: ${endDate.toISOString().split('T')[0]}`,
    `Number of Transactions: ${txs.length}`,
    `Number of Holdings: ${holdings.length}`,
    `Number of Securities: ${securities.size}`,
    `Number of Month-Ends: ${monthEnds.length}`,
    '',
    'Files Generated:',
    '  1. 01_transactions_chronological.csv - All transactions in chronological order',
    '  2. 02_positions_start_end.csv - Starting and ending positions',
    '  3. 03_monthly_portfolio_snapshots.csv - Portfolio positions at each month-end',
    '  4. 00_summary.txt - This summary file',
    '',
    'Starting Positions:',
    ...Array.from(startQty.entries())
      .filter(([, qty]) => qty !== 0)
      .map(([sid, qty]) => {
        const sec = securities.get(sid);
        const ticker = sec?.ticker || resolveTicker(sid, securities) || 'N/A';
        return `  ${ticker} (${sid}): ${qty} shares`;
      }),
    '',
    'Ending Positions:',
    ...Array.from(endQty.entries())
      .filter(([, qty]) => qty !== 0)
      .map(([sid, qty]) => {
        const sec = securities.get(sid);
        const ticker = sec?.ticker || resolveTicker(sid, securities) || 'N/A';
        return `  ${ticker} (${sid}): ${qty} shares`;
      }),
  ];

  fs.writeFileSync(summaryPath, summary.join('\n'), 'utf-8');
  console.log(`[DEBUG] Summary file written to ${summaryPath}`);
  
  // Verify files were created
  const filesCreated = [
    transactionsPath,
    positionsPath,
    monthlyPath,
    summaryPath,
  ];
  
  for (const filePath of filesCreated) {
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      console.log(`[DEBUG] File created: ${filePath} (${stats.size} bytes)`);
    } else {
      console.error(`[DEBUG] ERROR: File not created: ${filePath}`);
    }
  }
  
  console.log(`[DEBUG] Debug data export completed for account ${accountId} to ${outputDir}`);
}

/**
 * Generate CSV data in memory (returns as strings instead of writing files)
 * Useful for Vercel/serverless environments where filesystem is read-only
 */
export async function generateDebugCSVs(
  accountId: string,
  holdingsResp: any,
  transactionsResp: any,
  startDate: Date,
  endDate: Date,
  monthEnds: Date[]
): Promise<{ transactions: string; positions: string; monthly: string }> {
  // Parse data
  const { accounts, holdings: holdingsAll, securities } = parsePlaidHoldings(holdingsResp);
  const txsAll = parsePlaidInvestmentTransactions(transactionsResp);

  const holdings = holdingsAll.filter((h) => h.account_id === accountId);
  const txs = txsAll
    .filter((t) => t.account_id === accountId)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Generate transactions CSV
  const transactionRecords: TransactionRecord[] = [];
  for (const tx of txs) {
    const security = securities.get(tx.security_id || '');
    const ticker = security?.ticker || resolveTicker(tx.security_id || '', securities) || 'N/A';
    const name = security?.name || tx.name || 'Unknown';

    transactionRecords.push({
      date: tx.date.toISOString().split('T')[0],
      type: tx.type,
      subtype: tx.subtype || '',
      security_id: tx.security_id || '',
      ticker,
      name,
      quantity: tx.quantity,
      price: tx.price,
      amount: tx.amount,
      fees: tx.fees || 0,
      account_id: tx.account_id,
    });
  }
  transactionRecords.sort((a, b) => a.date.localeCompare(b.date));

  const transactionsHeaders = [
    'date',
    'type',
    'subtype',
    'security_id',
    'ticker',
    'name',
    'quantity',
    'price',
    'amount',
    'fees',
    'account_id',
  ];
  const transactionsCSV = [
    transactionsHeaders.join(','),
    ...transactionRecords.map((r) =>
      [
        r.date,
        r.type,
        r.subtype,
        r.security_id,
        r.ticker,
        `"${r.name.replace(/"/g, '""')}"`,
        r.quantity,
        r.price,
        r.amount,
        r.fees,
        r.account_id,
      ].join(',')
    ),
  ].join('\n');

  // Generate positions CSV
  const endQty = new Map<string, number>();
  for (const h of holdings) {
    endQty.set(h.security_id, h.quantity);
  }
  const startQty = reconstructStartPositions(endQty, txs, startDate, endDate);

  const currentPrices = new Map<string, number>();
  for (const h of holdings) {
    currentPrices.set(h.security_id, h.institution_price);
  }

  const allSecurityIds = new Set<string>();
  for (const sid of startQty.keys()) {
    allSecurityIds.add(sid);
  }
  for (const sid of endQty.keys()) {
    allSecurityIds.add(sid);
  }

  const positionRecords: PositionRecord[] = [];
  for (const securityId of allSecurityIds) {
    const security = securities.get(securityId);
    const ticker = security?.ticker || resolveTicker(securityId, securities) || 'N/A';
    const name = security?.name || 'Unknown';
    const startQ = startQty.get(securityId) || 0;
    const endQ = endQty.get(securityId) || 0;
    const price = currentPrices.get(securityId) || 0;
    const holding = holdings.find((h) => h.security_id === securityId);
    const accountId = holding?.account_id || '';

    if (startQ !== 0) {
      positionRecords.push({
        month: `START (${startDate.toISOString().split('T')[0]})`,
        security_id: securityId,
        ticker,
        name,
        quantity: startQ,
        price,
        value: startQ * price,
        account_id: accountId,
      });
    }

    if (endQ !== 0) {
      positionRecords.push({
        month: `END (${endDate.toISOString().split('T')[0]})`,
        security_id: securityId,
        ticker,
        name,
        quantity: endQ,
        price,
        value: endQ * price,
        account_id: accountId,
      });
    }
  }

  const positionsHeaders = ['month', 'security_id', 'ticker', 'name', 'quantity', 'price', 'value', 'account_id'];
  const positionsCSV = [
    positionsHeaders.join(','),
    ...positionRecords.map((r) =>
      [
        r.month,
        r.security_id,
        r.ticker,
        `"${r.name.replace(/"/g, '""')}"`,
        r.quantity,
        r.price,
        r.value,
        r.account_id,
      ].join(',')
    ),
  ].join('\n');

  // Generate monthly snapshots CSV
  const monthlyPositions = reconstructMonthlyPositions(
    startQty,
    txs,
    securities,
    holdings,
    startDate,
    endDate,
    monthEnds
  );

  const portfolioValues = new Map<Date, number>();
  for (const me of monthEnds) {
    let total = 0;
    for (const [securityId, positionsMap] of monthlyPositions) {
      const qty = positionsMap.get(me) || 0;
      const holding = holdings.find((h) => h.security_id === securityId);
      const price = holding?.institution_price || 0;
      total += qty * price;
    }
    portfolioValues.set(me, total);
  }

  const monthlyRecords: Array<{
    month: string;
    date: string;
    security_id: string;
    ticker: string;
    name: string;
    quantity: number;
    price: number;
    value: number;
    portfolio_total_value: number;
  }> = [];

  const priceMap = new Map<string, number>();
  for (const h of holdings) {
    priceMap.set(h.security_id, h.institution_price);
  }

  for (const me of monthEnds) {
    const portfolioValue = portfolioValues.get(me) || 0;
    const monthStr = me.toISOString().substring(0, 7);

    for (const [securityId, positionsMap] of monthlyPositions) {
      const qty = positionsMap.get(me);
      if (qty != null && qty !== 0) {
        const security = securities.get(securityId);
        const ticker = security?.ticker || resolveTicker(securityId, securities) || 'N/A';
        const name = security?.name || 'Unknown';
        const price = priceMap.get(securityId) || 0;
        const value = qty * price;

        monthlyRecords.push({
          month: monthStr,
          date: me.toISOString().split('T')[0],
          security_id: securityId,
          ticker,
          name,
          quantity: qty,
          price,
          value,
          portfolio_total_value: portfolioValue,
        });
      }
    }

    monthlyRecords.push({
      month: monthStr,
      date: me.toISOString().split('T')[0],
      security_id: 'TOTAL',
      ticker: 'TOTAL',
      name: 'Total Portfolio Value',
      quantity: 0,
      price: 0,
      value: 0,
      portfolio_total_value: portfolioValue,
    });
  }

  const monthlyHeaders = [
    'month',
    'date',
    'security_id',
    'ticker',
    'name',
    'quantity',
    'price',
    'value',
    'portfolio_total_value',
  ];
  const monthlyCSV = [
    monthlyHeaders.join(','),
    ...monthlyRecords.map((r) =>
      [
        r.month,
        r.date,
        r.security_id,
        r.ticker,
        `"${r.name.replace(/"/g, '""')}"`,
        r.quantity,
        r.price,
        r.value,
        r.portfolio_total_value,
      ].join(',')
    ),
  ].join('\n');

  return {
    transactions: transactionsCSV,
    positions: positionsCSV,
    monthly: monthlyCSV,
  };
}

