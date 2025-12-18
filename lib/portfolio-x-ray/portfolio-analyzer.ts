/**
 * Portfolio X-Ray - Portfolio Analyzer
 *
 * Main orchestrator that coordinates all analysis modules.
 */

import {
  Security,
  Holding,
  Transaction,
  PortfolioResult,
  PortfolioSnapshot,
  Cashflow,
} from './types';
import { LOOKBACK_MONTHS } from './config';
import {
  formatDate,
  getLastCompleteMonthEnd,
  getMonthEnds,
  monthsBetween,
} from './date-utils';
import { MarketDataProvider } from './market-data';
import {
  buildCurrentPositions,
  getCurrentCash,
  reconstructStartPositions,
  buildMonthlySnapshots,
  calculateTotalValue,
} from './holdings-tracker';
import { extractExternalCashflows } from './cashflow-analyzer';
import { calculatePortfolioReturns, calculateBenchmark } from './return-calculator';
import { calculateFees } from './fee-calculator';

export interface AnalyzerOptions {
  lookbackMonths?: number;
  debug?: boolean;
}

/**
 * Portfolio Analyzer - main entry point for portfolio analysis.
 */
export class PortfolioAnalyzer {
  private marketData: MarketDataProvider;
  private options: Required<AnalyzerOptions>;

  constructor(
    supabaseUrl: string,
    supabaseKey: string,
    options: AnalyzerOptions = {}
  ) {
    this.marketData = new MarketDataProvider(supabaseUrl, supabaseKey);
    this.options = {
      lookbackMonths: options.lookbackMonths ?? LOOKBACK_MONTHS,
      debug: options.debug ?? false,
    };
  }

  /**
   * Analyze a portfolio from Plaid data.
   *
   * @param holdings Current holdings from Plaid (as of today)
   * @param transactions Transaction history from Plaid
   * @param securities Security metadata
   * @returns Complete portfolio analysis result
   */
  async analyze(
    holdings: Holding[],
    transactions: Transaction[],
    securities: Map<string, Security>
  ): Promise<PortfolioResult> {
    // Sort transactions by date
    const sortedTransactions = [...transactions].sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    if (sortedTransactions.length === 0) {
      throw new Error('No transactions found for analysis');
    }

    // Determine date range
    // End date: last complete month-end
    const endDate = getLastCompleteMonthEnd();
    const endDateStr = formatDate(endDate);

    // Start date: lookback months before end
    const startDate = new Date(endDate);
    startDate.setMonth(startDate.getMonth() - this.options.lookbackMonths);
    const startDateStr = formatDate(startDate);

    this.log(`Analysis period: ${startDateStr} to ${endDateStr}`);

    // Build current state from Plaid holdings (as of today)
    const currentPositions = buildCurrentPositions(holdings, securities);
    const currentCash = getCurrentCash(holdings, securities);

    this.log(`Current positions: ${currentPositions.size}, Cash: $${currentCash.toFixed(2)}`);

    // Get all transactions from start date to today (for position reconstruction)
    const allTxsFromStart = sortedTransactions.filter(t => t.date >= startDateStr);

    this.log(`Transactions from ${startDateStr} to today: ${allTxsFromStart.length}`);

    // Reconstruct starting positions
    const { positions: startPositions, cash: startCash } = reconstructStartPositions(
      currentPositions,
      allTxsFromStart,
      securities,
      currentCash
    );

    const startValue = calculateTotalValue(startPositions, startCash);
    this.log(`Start value: $${startValue.toFixed(2)} (cash: $${startCash.toFixed(2)})`);

    // Get month-ends for the analysis period
    const monthEnds = getMonthEnds(startDate, endDate);
    this.log(`Month-ends in period: ${monthEnds.length}`);

    // Filter transactions to analysis period
    const txsInRange = sortedTransactions.filter(
      t => t.date >= startDateStr && t.date <= endDateStr
    );

    // Build monthly snapshots
    const snapshots = await buildMonthlySnapshots(
      startPositions,
      startCash,
      txsInRange,
      securities,
      monthEnds,
      this.marketData
    );

    if (snapshots.length === 0) {
      throw new Error('No snapshots generated');
    }

    // Use first snapshot as true start (more reliable than reconstruction)
    const firstSnapshot = snapshots[0];
    const snapshotStartValue = firstSnapshot.totalValue;
    const snapshotStartDate = firstSnapshot.date;
    const snapshotStartCash = firstSnapshot.cash;

    // Use last snapshot as end value
    const lastSnapshot = snapshots[snapshots.length - 1];
    const endValue = lastSnapshot.totalValue;

    this.log(`Snapshot start: $${snapshotStartValue.toFixed(2)} on ${snapshotStartDate}`);
    this.log(`Snapshot end: $${endValue.toFixed(2)} on ${endDateStr}`);

    // Extract external cashflows (after first snapshot)
    const allCashflows = extractExternalCashflows(txsInRange, startDateStr, endDateStr);
    const externalCashflows = allCashflows.filter(cf => cf.date > snapshotStartDate);

    this.log(`External cashflows: ${externalCashflows.length}`);

    // Calculate portfolio returns
    const months = monthsBetween(new Date(snapshotStartDate), endDate);
    const portfolioReturns = calculatePortfolioReturns(
      snapshotStartValue,
      endValue,
      externalCashflows,
      snapshotStartDate,
      endDateStr,
      months
    );

    this.log(`Portfolio IRR: ${portfolioReturns.irr?.toFixed(2)}%`);

    // Calculate benchmark returns
    // Filter monthEnds to start from first snapshot
    const benchmarkMonthEnds = monthEnds.filter(d => formatDate(d) >= snapshotStartDate);

    const benchmark = await calculateBenchmark(
      snapshotStartValue,
      firstSnapshot.positions,
      snapshotStartCash,
      externalCashflows,
      securities,
      benchmarkMonthEnds,
      this.marketData,
      snapshotStartDate,
      endDateStr
    );

    this.log(`Benchmark IRR: ${benchmark.irr?.toFixed(2)}%`);

    // Calculate fees
    const years = months / 12;
    const fees = calculateFees(
      transactions,
      holdings,
      securities,
      snapshotStartValue,
      endValue,
      years,
      snapshotStartDate,
      endDateStr
    );

    this.log(`Total fees: $${fees.totalFees.toFixed(2)}`);

    // Calculate outperformance
    const outperformance = portfolioReturns.annualizedReturn - benchmark.return;

    return {
      startDate: snapshotStartDate,
      endDate: endDateStr,
      startValue: snapshotStartValue,
      endValue,
      totalReturn: portfolioReturns.totalReturn,
      annualizedReturn: portfolioReturns.annualizedReturn,
      irr: portfolioReturns.irr,
      benchmark,
      outperformance,
      fees,
      monthlySnapshots: snapshots,
      externalCashflows,
    };
  }

  /**
   * Log debug messages if debug mode is enabled.
   */
  private log(message: string): void {
    if (this.options.debug) {
      console.log(`[PortfolioAnalyzer] ${message}`);
    }
  }
}

/**
 * Convenience function to create analyzer and run analysis.
 */
export async function analyzePortfolio(
  holdings: Holding[],
  transactions: Transaction[],
  securities: Map<string, Security>,
  supabaseUrl: string,
  supabaseKey: string,
  options: AnalyzerOptions = {}
): Promise<PortfolioResult> {
  const analyzer = new PortfolioAnalyzer(supabaseUrl, supabaseKey, options);
  return analyzer.analyze(holdings, transactions, securities);
}
