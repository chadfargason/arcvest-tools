/**
 * Portfolio X-Ray Calculation Engine V2
 *
 * Complete rewrite with simplified, working logic for:
 * - Portfolio position reconstruction
 * - Monthly returns calculation
 * - IRR calculation
 * - Benchmark comparison
 * - Fee analysis
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getBenchmarkForPlaidSecurity } from './benchmark-matcher';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface Security {
  security_id: string;
  ticker_symbol: string | null;
  name: string;
  type: string;
  is_cash_equivalent: boolean;
}

export interface Holding {
  account_id: string;
  security_id: string;
  quantity: number;
  institution_value: number;
  institution_price: number;
}

export interface Transaction {
  account_id: string;
  security_id: string | null;
  date: string; // YYYY-MM-DD
  type: string; // buy, sell, dividend, fee, cash, etc.
  subtype: string | null;
  quantity: number;
  amount: number; // Cash impact (positive = cash out, negative = cash in)
  price: number;
  fees: number;
  name: string;
}

export interface Position {
  security_id: string;
  quantity: number;
  value: number;
  price: number;
}

export interface PortfolioSnapshot {
  date: string; // YYYY-MM-DD (month-end)
  positions: Map<string, Position>;
  cash: number;
  totalValue: number;
}

export interface BenchmarkMonthlyData {
  month: string; // YYYY-MM-DD
  return: number; // % monthly return
  cashflow: number; // $ cashflow applied this month
  value: number; // $ ending value for this month
}

export interface CalculationResult {
  accountId: string;
  startDate: string;
  endDate: string;
  startValue: number;
  endValue: number;
  totalReturn: number; // %
  annualizedReturn: number; // %
  irr: number | null; // %
  benchmarkReturn: number; // %
  benchmarkIrr: number | null; // %
  benchmarkWeights: Map<string, number>; // Benchmark allocation (ticker -> weight %)
  benchmarkMonthlyData: BenchmarkMonthlyData[]; // Monthly benchmark evolution
  benchmarkEndValue: number; // $ final benchmark value
  outperformance: number; // %
  explicitFees: number; // $
  implicitFees: number; // $
  totalFees: number; // $
  monthlySnapshots: PortfolioSnapshot[];
  externalCashflows: Array<{ date: string; amount: number }>;
}

// ============================================================================
// Helper Functions
// ============================================================================

function parseDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00.000Z');
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function getMonthEnd(date: Date): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  // Get first day of next month, then subtract 1 day
  return new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
}

function getMonthEnds(startDate: Date, endDate: Date): Date[] {
  const monthEnds: Date[] = [];
  let current = new Date(startDate);

  while (current <= endDate) {
    const monthEnd = getMonthEnd(current);
    if (monthEnd >= startDate && monthEnd <= endDate) {
      monthEnds.push(monthEnd);
    }
    // Move to first day of next month
    current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
  }

  return monthEnds;
}

function isExternalCashflow(tx: Transaction): boolean {
  // Deposits, withdrawals, contributions, distributions
  const externalTypes = ['deposit', 'withdrawal', 'contribution', 'distribution'];

  if (tx.type === 'cash' && tx.subtype && externalTypes.includes(tx.subtype)) {
    return true;
  }

  if ((tx.type === 'buy' || tx.type === 'sell') && tx.subtype &&
      (tx.subtype === 'contribution' || tx.subtype === 'distribution')) {
    return true;
  }

  return false;
}

function isFeeTransaction(tx: Transaction): boolean {
  if (tx.type === 'fee') return true;

  const feeSubtypes = ['account fee', 'management fee', 'legal fee', 'margin expense', 'transfer fee', 'trust fee'];
  if (tx.type === 'cash' && tx.subtype && feeSubtypes.includes(tx.subtype)) {
    return true;
  }

  return false;
}

// ============================================================================
// Market Data Provider
// ============================================================================

export class MarketDataProvider {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Fetch monthly returns for tickers between dates
   * Returns: Map<ticker, Map<month-end-date, return>>
   */
  async getMonthlyReturns(
    tickers: string[],
    startDate: string,
    endDate: string
  ): Promise<Map<string, Map<string, number>>> {
    if (tickers.length === 0) {
      return new Map();
    }

    const { data, error } = await this.supabase
      .from('asset_returns')
      .select('asset_ticker, return_date, monthly_return')
      .in('asset_ticker', tickers)
      .gte('return_date', startDate)
      .lte('return_date', endDate)
      .order('return_date');

    if (error) {
      console.error('Error fetching market data:', error);
      return new Map();
    }

    const result = new Map<string, Map<string, number>>();

    if (data) {
      for (const row of data) {
        const ticker = row.asset_ticker;
        const date = row.return_date;
        const returnValue = parseFloat(row.monthly_return);

        if (!result.has(ticker)) {
          result.set(ticker, new Map());
        }
        result.get(ticker)!.set(date, returnValue);
      }
    }

    return result;
  }
}

// ============================================================================
// Portfolio Calculator
// ============================================================================

export class PortfolioCalculator {
  constructor(private marketData: MarketDataProvider) {}

  /**
   * Main calculation function
   */
  async calculate(
    accountId: string,
    holdings: Holding[],
    transactions: Transaction[],
    securities: Map<string, Security>,
    lookbackMonths: number = 24
  ): Promise<CalculationResult> {
    // Filter to this account only
    const accountHoldings = holdings.filter(h => h.account_id === accountId);
    const accountTxs = transactions
      .filter(t => t.account_id === accountId)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (accountTxs.length === 0) {
      throw new Error(`No transactions found for account ${accountId}`);
    }

    // Determine date range - use last complete month-end
    const today = new Date();
    const lastCompleteMonthEnd = getMonthEnd(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)));
    const endDate = lastCompleteMonthEnd;
    const startDate = new Date(endDate);
    startDate.setMonth(startDate.getMonth() - lookbackMonths);

    // Filter transactions to date range
    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);
    const txsInRange = accountTxs.filter(t => t.date >= startDateStr && t.date <= endDateStr);

    console.log(`[Calculator] Account ${accountId}: ${txsInRange.length} transactions from ${startDateStr} to ${endDateStr}`);

    // Step 1: Build ending positions from holdings (for reconstructing start)
    const endPositions = this.buildEndPositions(accountHoldings, securities);

    // Step 2: Reconstruct starting positions
    const { startPositions, startCash } = this.reconstructStartPositions(
      endPositions,
      txsInRange,
      securities
    );
    const startValue = this.calculateTotalValue(startPositions, startCash);

    // Step 3: Build monthly snapshots
    const monthEnds = getMonthEnds(startDate, endDate);
    const snapshots = await this.buildMonthlySnapshots(
      startPositions,
      startCash,
      txsInRange,
      securities,
      monthEnds
    );

    // Use the last snapshot's value as the ending value (last complete month-end)
    const endValue = snapshots.length > 0 ? snapshots[snapshots.length - 1].totalValue : startValue;

    console.log(`[Calculator] Start value: $${startValue.toFixed(2)}, End value: $${endValue.toFixed(2)}`);

    // Step 4: Calculate returns
    const totalReturn = ((endValue - startValue) / startValue) * 100;
    const years = lookbackMonths / 12;
    const annualizedReturn = (Math.pow(1 + totalReturn / 100, 1 / years) - 1) * 100;

    // Step 5: Calculate IRR
    const externalCashflows = this.extractExternalCashflows(txsInRange);
    const irr = this.calculateIRR(startValue, endValue, externalCashflows, startDateStr, endDateStr);

    // Step 6: Calculate benchmark
    const {
      benchmarkReturn,
      benchmarkIrr,
      benchmarkWeights,
      benchmarkMonthlyData,
      benchmarkEndValue
    } = await this.calculateBenchmark(
      startValue,
      endValue,
      startPositions,
      externalCashflows,
      securities,
      monthEnds,
      startDateStr,
      endDateStr
    );

    // Step 7: Calculate fees
    const explicitFees = this.calculateExplicitFees(txsInRange);
    const implicitFees = this.estimateImplicitFees(accountHoldings, securities, startValue, endValue, years);

    return {
      accountId,
      startDate: startDateStr,
      endDate: endDateStr,
      startValue,
      endValue,
      totalReturn,
      annualizedReturn,
      irr,
      benchmarkReturn,
      benchmarkIrr,
      benchmarkWeights,
      benchmarkMonthlyData,
      benchmarkEndValue,
      outperformance: annualizedReturn - benchmarkReturn,
      explicitFees,
      implicitFees,
      totalFees: explicitFees + implicitFees,
      monthlySnapshots: snapshots,
      externalCashflows,
    };
  }

  /**
   * Build ending positions from current holdings
   */
  private buildEndPositions(
    holdings: Holding[],
    securities: Map<string, Security>
  ): Map<string, Position> {
    const positions = new Map<string, Position>();

    for (const holding of holdings) {
      const security = securities.get(holding.security_id);
      if (!security || security.is_cash_equivalent) {
        // Skip cash equivalents - they're tracked separately
        continue;
      }

      positions.set(holding.security_id, {
        security_id: holding.security_id,
        quantity: holding.quantity,
        value: holding.institution_value,
        price: holding.institution_price,
      });
    }

    return positions;
  }

  /**
   * Reconstruct starting positions by reversing transactions
   */
  private reconstructStartPositions(
    endPositions: Map<string, Position>,
    transactions: Transaction[],
    securities: Map<string, Security>
  ): { startPositions: Map<string, Position>; startCash: number } {
    const startQty = new Map<string, number>();

    // Start with ending quantities
    for (const [secId, pos] of endPositions) {
      startQty.set(secId, pos.quantity);
    }

    // Reverse all transactions to get starting quantities
    let cashDelta = 0;
    const priceHistory = new Map<string, number[]>();

    for (const tx of transactions) {
      if (tx.security_id && !securities.get(tx.security_id)?.is_cash_equivalent) {
        // Reverse the quantity change
        const currentQty = startQty.get(tx.security_id) || 0;
        startQty.set(tx.security_id, currentQty - tx.quantity);

        // Track prices
        if (tx.price > 0) {
          if (!priceHistory.has(tx.security_id)) {
            priceHistory.set(tx.security_id, []);
          }
          priceHistory.get(tx.security_id)!.push(tx.price);
        }
      }

      // Reverse cash impact (amount is positive when cash goes out)
      cashDelta += tx.amount;
    }

    // Build starting positions
    const startPositions = new Map<string, Position>();
    for (const [secId, qty] of startQty) {
      if (Math.abs(qty) < 0.000001) continue; // Skip zero/near-zero positions

      const endPos = endPositions.get(secId);
      let price = endPos?.price || 0;

      // Try to get a better price estimate from transaction history
      const prices = priceHistory.get(secId);
      if (prices && prices.length > 0) {
        price = prices[0]; // Use first transaction price
      }

      startPositions.set(secId, {
        security_id: secId,
        quantity: qty,
        value: qty * price,
        price: price,
      });
    }

    // Calculate starting cash
    // End cash is assumed to be 0 for simplicity (or could extract from holdings)
    const startCash = cashDelta;

    return { startPositions, startCash: Math.max(0, startCash) };
  }

  /**
   * Build monthly portfolio snapshots
   */
  private async buildMonthlySnapshots(
    startPositions: Map<string, Position>,
    startCash: number,
    transactions: Transaction[],
    securities: Map<string, Security>,
    monthEnds: Date[]
  ): Promise<PortfolioSnapshot[]> {
    const snapshots: PortfolioSnapshot[] = [];

    // Initialize quantities and track base prices from start positions
    const quantities = new Map<string, number>();
    const basePrices = new Map<string, number>();

    for (const [secId, pos] of startPositions) {
      quantities.set(secId, pos.quantity);
      basePrices.set(secId, pos.price);
    }

    // Get all tickers (including those from transactions)
    const tickers = new Set<string>();
    for (const [secId, _] of startPositions) {
      const security = securities.get(secId);
      if (security?.ticker_symbol) {
        tickers.add(security.ticker_symbol);
      }
    }
    for (const tx of transactions) {
      if (tx.security_id) {
        const security = securities.get(tx.security_id);
        if (security?.ticker_symbol) {
          tickers.add(security.ticker_symbol);
        }
      }
    }

    // Fetch monthly returns
    const startDate = formatDate(monthEnds[0]);
    const endDate = formatDate(monthEnds[monthEnds.length - 1]);
    const returns = await this.marketData.getMonthlyReturns(
      Array.from(tickers),
      startDate,
      endDate
    );

    // Build cumulative price indices from month 0
    const priceIndices = new Map<string, Map<string, number>>();
    for (const ticker of tickers) {
      const tickerReturns = returns.get(ticker) || new Map();
      const index = new Map<string, number>();
      let cumulativeIndex = 1.0;

      for (const monthEnd of monthEnds) {
        const monthEndStr = formatDate(monthEnd);
        const monthReturn = tickerReturns.get(monthEndStr) || 0;
        cumulativeIndex *= (1 + monthReturn);
        index.set(monthEndStr, cumulativeIndex);
      }

      priceIndices.set(ticker, index);
    }

    // Track cash
    let cash = startCash;
    let lastMonthEndStr: string | null = null;

    // Build snapshots for each month
    for (const monthEnd of monthEnds) {
      const monthEndStr = formatDate(monthEnd);

      // Apply transactions that occurred before or on this month-end
      for (const tx of transactions) {
        const shouldApply = lastMonthEndStr === null
          ? tx.date <= monthEndStr
          : tx.date > lastMonthEndStr && tx.date <= monthEndStr;

        if (shouldApply) {
          // Update quantities
          if (tx.security_id && !securities.get(tx.security_id)?.is_cash_equivalent) {
            const currentQty = quantities.get(tx.security_id) || 0;
            quantities.set(tx.security_id, currentQty + tx.quantity);

            // Update base price if we see a new price
            if (tx.price > 0 && !basePrices.has(tx.security_id)) {
              basePrices.set(tx.security_id, tx.price);
            }
          }

          // Update cash (amount is positive when cash goes out, negative when cash comes in)
          cash -= tx.amount;
        }
      }

      // Value positions at month-end
      const monthEndPositions = new Map<string, Position>();
      let totalValue = cash;

      for (const [secId, qty] of quantities) {
        if (Math.abs(qty) < 0.000001) continue; // Skip near-zero positions

        const security = securities.get(secId);
        if (!security || security.is_cash_equivalent) continue;

        const ticker = security.ticker_symbol;
        const basePrice = basePrices.get(secId) || 0;

        let currentPrice = basePrice;
        if (ticker && priceIndices.has(ticker)) {
          const index = priceIndices.get(ticker)!.get(monthEndStr) || 1.0;
          currentPrice = basePrice * index;
        }

        const value = qty * currentPrice;
        totalValue += value;

        monthEndPositions.set(secId, {
          security_id: secId,
          quantity: qty,
          value,
          price: currentPrice,
        });
      }

      snapshots.push({
        date: monthEndStr,
        positions: monthEndPositions,
        cash,
        totalValue,
      });

      lastMonthEndStr = monthEndStr;
    }

    return snapshots;
  }

  /**
   * Calculate total value of positions
   */
  private calculateTotalValue(positions: Map<string, Position>, cash: number): number {
    let total = cash;
    for (const pos of positions.values()) {
      total += pos.value;
    }
    return total;
  }

  /**
   * Extract external cashflows (deposits/withdrawals)
   */
  private extractExternalCashflows(
    transactions: Transaction[]
  ): Array<{ date: string; amount: number }> {
    const cashflows: Array<{ date: string; amount: number }> = [];

    for (const tx of transactions) {
      if (isExternalCashflow(tx)) {
        // XIRR convention: Plaid already provides correct signs
        // Contributions come as negative (money out), withdrawals as positive (money in)
        // Don't negate - use as-is for XIRR calculation
        const amount = tx.amount;
        cashflows.push({ date: tx.date, amount });
      }
    }

    return cashflows;
  }

  /**
   * Calculate IRR using XIRR method
   */
  private calculateIRR(
    startValue: number,
    endValue: number,
    cashflows: Array<{ date: string; amount: number }>,
    startDate: string,
    endDate: string
  ): number | null {
    try {
      // Build cashflow array: [start investment, external flows, end value]
      const cfs: Array<[Date, number]> = [];
      cfs.push([parseDate(startDate), -startValue]);

      for (const cf of cashflows) {
        cfs.push([parseDate(cf.date), cf.amount]);
      }

      cfs.push([parseDate(endDate), endValue]);

      // DEBUG: Log cashflows being passed to XIRR
      if (process.env.NODE_ENV === 'development') {
        console.log('\n=== IRR CALCULATION DEBUG ===');
        console.log('Start Value:', startValue);
        console.log('End Value:', endValue);
        console.log('External Cashflows:', cashflows);
        console.log('\nCashflows passed to XIRR:');
        for (const [date, amount] of cfs) {
          console.log(`  ${date.toISOString().split('T')[0]}: ${amount < 0 ? '-' : '+'}$${Math.abs(amount).toFixed(2)}`);
        }
        console.log('=============================\n');
      }

      // Calculate XIRR
      const irr = this.xirr(cfs);
      return irr * 100; // Convert to percentage
    } catch (error) {
      console.error('IRR calculation failed:', error);
      return null;
    }
  }

  /**
   * XIRR calculation (Newton's method)
   */
  private xirr(cashflows: Array<[Date, number]>): number {
    const sorted = cashflows.sort((a, b) => a[0].getTime() - b[0].getTime());
    const t0 = sorted[0][0].getTime();

    const xnpv = (rate: number): number => {
      let sum = 0;
      for (const [date, amount] of sorted) {
        const years = (date.getTime() - t0) / (365.25 * 24 * 60 * 60 * 1000);
        sum += amount / Math.pow(1 + rate, years);
      }
      return sum;
    };

    // Bisection method
    let lo = -0.99;
    let hi = 10.0;
    let mid = 0.1;

    for (let i = 0; i < 100; i++) {
      mid = (lo + hi) / 2;
      const npv = xnpv(mid);

      if (Math.abs(npv) < 0.01) {
        return mid;
      }

      if (xnpv(lo) * npv < 0) {
        hi = mid;
      } else {
        lo = mid;
      }
    }

    return mid;
  }

  /**
   * Calculate benchmark performance
   */
  private async calculateBenchmark(
    startValue: number,
    endValue: number,
    startPositions: Map<string, Position>,
    cashflows: Array<{ date: string; amount: number }>,
    securities: Map<string, Security>,
    monthEnds: Date[],
    startDate: string,
    endDate: string
  ): Promise<{
    benchmarkReturn: number;
    benchmarkIrr: number | null;
    benchmarkWeights: Map<string, number>;
    benchmarkMonthlyData: BenchmarkMonthlyData[];
    benchmarkEndValue: number;
  }> {
    try {
      // Map positions to benchmarks
      const benchmarkWeights = new Map<string, number>();
      let totalValue = 0;

      for (const [secId, pos] of startPositions) {
        const security = securities.get(secId);
        if (!security) continue;

        const benchmark = getBenchmarkForPlaidSecurity({
          ticker_symbol: security.ticker_symbol,
          name: security.name,
          type: security.type,
        });

        benchmarkWeights.set(
          benchmark,
          (benchmarkWeights.get(benchmark) || 0) + Math.abs(pos.value)
        );
        totalValue += Math.abs(pos.value);
      }

      // Normalize weights to percentages
      if (totalValue > 0) {
        for (const [benchmark, weight] of benchmarkWeights) {
          benchmarkWeights.set(benchmark, (weight / totalValue) * 100);
        }
      }

      // Get benchmark returns
      const benchmarkTickers = Array.from(benchmarkWeights.keys());
      const returns = await this.marketData.getMonthlyReturns(
        benchmarkTickers,
        startDate,
        endDate
      );

      // Calculate benchmark portfolio return
      let benchmarkValue = startValue;
      const cashflowsByMonth = new Map<string, number>();

      for (const cf of cashflows) {
        const monthEnd = formatDate(getMonthEnd(parseDate(cf.date)));
        cashflowsByMonth.set(monthEnd, (cashflowsByMonth.get(monthEnd) || 0) + cf.amount);
      }

      // Track benchmark value evolution
      const benchmarkEvolution: BenchmarkMonthlyData[] = [];

      for (const monthEnd of monthEnds) {
        const monthEndStr = formatDate(monthEnd);

        // Apply return
        let portfolioReturn = 0;
        for (const [ticker, weight] of benchmarkWeights) {
          const tickerReturns = returns.get(ticker);
          const monthReturn = tickerReturns?.get(monthEndStr) || 0;
          // Convert weight from percentage (0-100) to decimal (0-1)
          portfolioReturn += (weight / 100) * monthReturn;
        }

        benchmarkValue *= (1 + portfolioReturn);

        // Apply cashflows
        // Cashflows are negative for contributions, positive for withdrawals
        // Negate to apply correctly: contributions ADD to value, withdrawals SUBTRACT
        const cashflow = cashflowsByMonth.get(monthEndStr) || 0;
        benchmarkValue -= cashflow;

        // Record evolution
        benchmarkEvolution.push({
          month: monthEndStr,
          return: portfolioReturn * 100, // Convert to percentage
          value: benchmarkValue,
          cashflow: cashflow
        });
      }

      const benchmarkTotalReturn = ((benchmarkValue - startValue) / startValue) * 100;
      const years = monthEnds.length / 12;
      const benchmarkReturn = (Math.pow(1 + benchmarkTotalReturn / 100, 1 / years) - 1) * 100;

      // Calculate benchmark IRR
      const benchmarkIrr = this.calculateIRR(startValue, benchmarkValue, cashflows, startDate, endDate);

      // DEBUG: Log benchmark details
      if (process.env.NODE_ENV === 'development') {
        console.log('\n=== BENCHMARK IRR CALCULATION DEBUG ===');
        console.log('Benchmark Weights:');
        for (const [ticker, weight] of benchmarkWeights) {
          console.log(`  ${ticker}: ${weight.toFixed(2)}%`);
        }
        console.log(`\nStart Value: $${startValue.toFixed(2)}`);
        console.log(`End Value: $${benchmarkValue.toFixed(2)}`);
        console.log('\nMonthly Evolution:');
        for (const month of benchmarkEvolution) {
          console.log(`  ${month.month}: Return=${(month.return * 100).toFixed(2)}%, Cashflow=${month.cashflow < 0 ? '-' : '+'}$${Math.abs(month.cashflow).toFixed(2)}, Value=$${month.value.toFixed(2)}`);
        }
        console.log(`\nBenchmark IRR: ${benchmarkIrr ? benchmarkIrr.toFixed(2) + '%' : 'N/A'}`);
        console.log('========================================\n');
      }

      return {
        benchmarkReturn,
        benchmarkIrr,
        benchmarkWeights,
        benchmarkMonthlyData: benchmarkEvolution,
        benchmarkEndValue: benchmarkValue
      };
    } catch (error) {
      console.error('Benchmark calculation failed:', error);
      return {
        benchmarkReturn: 0,
        benchmarkIrr: null,
        benchmarkWeights: new Map(),
        benchmarkMonthlyData: [],
        benchmarkEndValue: 0
      };
    }
  }

  /**
   * Calculate explicit fees (from transactions)
   */
  private calculateExplicitFees(transactions: Transaction[]): number {
    let total = 0;

    for (const tx of transactions) {
      if (tx.fees > 0) {
        total += tx.fees;
      }

      if (isFeeTransaction(tx)) {
        total += Math.abs(tx.amount);
      }
    }

    return total;
  }

  /**
   * Estimate implicit fees (expense ratios)
   */
  private estimateImplicitFees(
    holdings: Holding[],
    securities: Map<string, Security>,
    startValue: number,
    endValue: number,
    years: number
  ): number {
    // Default expense ratios for common fund types (annual rates)
    const defaultERs = new Map([
      ['mutual fund', 0.005], // 50 bps annual
      ['etf', 0.001], // 10 bps annual
    ]);

    let totalFundValue = 0;
    let weightedER = 0;

    for (const holding of holdings) {
      const security = securities.get(holding.security_id);
      if (!security) continue;

      const type = security.type?.toLowerCase();
      if (type === 'mutual fund' || type === 'etf') {
        const er = defaultERs.get(type) || 0;
        totalFundValue += holding.institution_value;
        weightedER += holding.institution_value * er;
      }
    }

    if (totalFundValue === 0) return 0;

    const avgER = weightedER / totalFundValue;
    const avgValue = (startValue + endValue) / 2;
    // Multiply by years to get total fees for the period
    return avgValue * avgER * years;
  }
}
