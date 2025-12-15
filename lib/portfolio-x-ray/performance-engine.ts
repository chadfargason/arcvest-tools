/**
 * Portfolio Performance Calculation Engine
 * 
 * Port of the Python PlaidPerformanceEngine to TypeScript.
 * Calculates IRR, benchmark comparison, and fee analysis from Plaid data.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getBenchmarkForPlaidSecurity } from './benchmark-matcher';

// ============================================================================
// Date Utilities
// ============================================================================

export function parseDate(dateStr: string): Date {
  // Plaid dates are ISO (YYYY-MM-DD)
  return new Date(dateStr + 'T00:00:00');
}

export function monthEnd(d: Date): Date {
  // Last calendar day of month
  const year = d.getFullYear();
  const month = d.getMonth() + 1; // getMonth is 0-indexed
  return new Date(year, month, 0); // Day 0 = last day of previous month
}

export function iterMonthEnds(start: Date, end: Date): Date[] {
  // Inclusive month-ends between start and end
  const out: Date[] = [];
  let current = new Date(start.getFullYear(), start.getMonth(), 1);
  
  while (true) {
    const me = monthEnd(current);
    if (me >= start && me <= end) {
      out.push(me);
    }
    if (me >= end) break;
    
    // Advance to first of next month
    if (current.getMonth() === 11) {
      current = new Date(current.getFullYear() + 1, 0, 1);
    } else {
      current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    }
  }
  
  // Ensure end itself is included if it is after last month-end
  if (out.length > 0 && out[out.length - 1] < end) {
    out.push(end);
  } else if (out.length === 0) {
    out.push(end);
  }
  
  return out;
}

// ============================================================================
// Data Models
// ============================================================================

export interface SecurityMeta {
  security_id: string;
  ticker: string | null;
  name: string | null;
  type: string | null;
  subtype: string | null;
  is_cash_equivalent: boolean | null;
  proxy_security_id: string | null;
}

export interface Holding {
  account_id: string;
  security_id: string;
  quantity: number;
  institution_value: number;
  institution_price: number;
  iso_currency_code: string | null;
}

export interface InvestmentTx {
  investment_transaction_id: string;
  account_id: string;
  security_id: string | null;
  date: Date;
  name: string;
  quantity: number;
  amount: number; // Plaid: + when cash debited, - when cash credited
  price: number;
  fees: number | null; // Combined fees on this tx
  type: string;
  subtype: string | null;
}

// ============================================================================
// Data Providers
// ============================================================================

export interface MarketDataProvider {
  /**
   * Returns monthly total returns (decimal, e.g. 0.02 for +2%)
   * for each ticker at each month_end date.
   */
  getMonthlyTotalReturns(
    tickers: string[],
    monthEnds: Date[]
  ): Promise<Map<string, Map<Date, number>>>;
}

export interface FundDataProvider {
  /**
   * expense_ratio: annual, decimal (e.g. 0.0003 for 3 bps, 0.006 for 60 bps)
   */
  getExpenseRatio(ticker: string): Promise<number | null>;
  
  /**
   * market_cap: optional; used for equity benchmark sizing
   */
  getMarketCap(ticker: string): Promise<number | null>;
}

// ============================================================================
// Supabase Market Data Provider
// ============================================================================

export class SupabaseMarketDataProvider implements MarketDataProvider {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  async getMonthlyTotalReturns(
    tickers: string[],
    monthEnds: Date[]
  ): Promise<Map<string, Map<Date, number>>> {
    if (tickers.length === 0 || monthEnds.length === 0) {
      return new Map();
    }

    const startDate = monthEnds[0].toISOString().split('T')[0];
    const endDate = monthEnds[monthEnds.length - 1].toISOString().split('T')[0];

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

    // Build result map
    const result = new Map<string, Map<Date, number>>();
    
    // Initialize maps for all tickers
    for (const ticker of tickers) {
      result.set(ticker, new Map());
    }

    // Populate with data
    if (data) {
      for (const row of data) {
        const ticker = row.asset_ticker;
        const date = parseDate(row.return_date);
        const returnValue = parseFloat(row.monthly_return);
        
        // Find the month-end date for this date
        const monthEndDate = monthEnd(date);
        
        let tickerMap = result.get(ticker);
        if (!tickerMap) {
          tickerMap = new Map();
          result.set(ticker, tickerMap);
        }
        
        tickerMap.set(monthEndDate, returnValue);
      }
    }

    return result;
  }
}

// ============================================================================
// Fund Data Provider (using benchmark matcher + defaults)
// ============================================================================

export class DefaultFundDataProvider implements FundDataProvider {
  // Default expense ratios for common funds (annual, decimal)
  private defaultExpenseRatios: Map<string, number> = new Map([
    // Vanguard funds (typically very low ER)
    ['VTSAX', 0.0004], // 4 bps
    ['VTI', 0.0003], // 3 bps
    ['VTIAX', 0.0011], // 11 bps
    ['VXUS', 0.0008], // 8 bps
    ['VBTLX', 0.0005], // 5 bps
    ['BND', 0.0003], // 3 bps
    ['VOO', 0.0003], // 3 bps
    ['VFIAX', 0.0004], // 4 bps
    // Fidelity
    ['FXAIX', 0.00015], // 1.5 bps
    ['FXNAX', 0.00025], // 2.5 bps
    // Schwab
    ['SWPPX', 0.0002], // 2 bps
    // iShares
    ['AGG', 0.0003], // 3 bps
    ['SPY', 0.000945], // 9.45 bps
    ['IWM', 0.0019], // 19 bps
    ['IJH', 0.0006], // 6 bps
    // Cash/Bills
    ['BIL', 0.00135], // 13.5 bps
  ]);

  async getExpenseRatio(ticker: string): Promise<number | null> {
    return this.defaultExpenseRatios.get(ticker.toUpperCase()) || null;
  }

  async getMarketCap(ticker: string): Promise<number | null> {
    // Could implement market cap lookup here if needed
    return null;
  }
}

// ============================================================================
// Plaid Data Parsing
// ============================================================================

export function parsePlaidHoldings(
  holdingsResp: any
): { accounts: Map<string, any>; holdings: Holding[]; securities: Map<string, SecurityMeta> } {
  const accounts = new Map<string, any>();
  for (const a of holdingsResp.accounts || []) {
    accounts.set(a.account_id, a);
  }

  const securitiesList = holdingsResp.securities || [];
  const holdingsList = holdingsResp.holdings || [];

  const securities = new Map<string, SecurityMeta>();
  for (const s of securitiesList) {
    securities.set(s.security_id, {
      security_id: s.security_id,
      ticker: s.ticker_symbol || null,
      name: s.name || null,
      type: s.type || null,
      subtype: s.subtype || null,
      is_cash_equivalent: s.is_cash_equivalent || null,
      proxy_security_id: s.proxy_security_id || null,
    });
  }

  const holdings: Holding[] = [];
  for (const h of holdingsList) {
    holdings.push({
      account_id: h.account_id,
      security_id: h.security_id,
      quantity: parseFloat(h.quantity || 0),
      institution_value: parseFloat(h.institution_value || 0),
      institution_price: parseFloat(h.institution_price || 0),
      iso_currency_code: h.iso_currency_code || null,
    });
  }

  return { accounts, holdings, securities };
}

export function parsePlaidInvestmentTransactions(txResp: any): InvestmentTx[] {
  const out: InvestmentTx[] = [];
  for (const t of txResp.investment_transactions || []) {
    out.push({
      investment_transaction_id: t.investment_transaction_id,
      account_id: t.account_id,
      security_id: t.security_id || null,
      date: parseDate(t.date),
      name: t.name || '',
      quantity: parseFloat(t.quantity || 0),
      amount: parseFloat(t.amount || 0),
      price: parseFloat(t.price || 0),
      fees: t.fees != null ? parseFloat(t.fees) : null,
      type: t.type,
      subtype: t.subtype || null,
    });
  }
  return out;
}

// ============================================================================
// Cashflow Classification
// ============================================================================

const EXTERNAL_CASH_SUBTYPES = new Set([
  'deposit',
  'withdrawal',
  'contribution',
  'distribution',
]);

const FEE_SUBTYPES = new Set([
  'account fee',
  'management fee',
  'legal fee',
  'margin expense',
  'transfer fee',
  'trust fee',
]);

function isInKindTransfer(tx: InvestmentTx): boolean {
  return (
    tx.type === 'transfer' &&
    tx.subtype === 'transfer' &&
    tx.security_id !== null &&
    Math.abs(tx.amount) < 1e-9
  );
}

export function isExternalCashFlow(tx: InvestmentTx): boolean {
  if (tx.type === 'cash' && tx.subtype && EXTERNAL_CASH_SUBTYPES.has(tx.subtype)) {
    return true;
  }
  if (
    (tx.type === 'buy' || tx.type === 'sell') &&
    tx.subtype &&
    (tx.subtype === 'contribution' || tx.subtype === 'distribution')
  ) {
    return true;
  }
  if (isInKindTransfer(tx)) {
    return true;
  }
  return false;
}

export function investorCashflowAmount(tx: InvestmentTx): number {
  /**
   * Return the cashflow from the *investor perspective*.
   * Convention:
   *   - contributions/deposits are NEGATIVE (investor pays in)
   *   - withdrawals/distributions are POSITIVE (investor receives)
   *
   * Plaid 'amount' already matches that sign for cash movements.
   */
  if (
    isInKindTransfer(tx) ||
    ((tx.type === 'buy' || tx.type === 'sell') &&
      tx.subtype &&
      (tx.subtype === 'contribution' || tx.subtype === 'distribution') &&
      Math.abs(tx.amount) < 1e-9)
  ) {
    return -tx.quantity * tx.price;
  }
  return tx.amount;
}

// ============================================================================
// IRR: XNPV / XIRR
// ============================================================================

export type Cashflow = [Date, number];

export function xnpv(rate: number, cfs: Cashflow[]): number {
  if (rate <= -0.999999999) {
    return Infinity;
  }
  const t0 = cfs[0][0];
  let total = 0.0;
  for (const [d, cf] of cfs) {
    const dt = (d.getTime() - t0.getTime()) / (365.0 * 24 * 60 * 60 * 1000);
    total += cf / Math.pow(1.0 + rate, dt);
  }
  return total;
}

export function xirr(cfs: Cashflow[]): number {
  /**
   * Robust-ish solver:
   *   1) find bracket [lo, hi] where xnpv crosses zero
   *   2) bisection
   */
  cfs = [...cfs].sort((a, b) => a[0].getTime() - b[0].getTime());
  
  if (!(cfs.some(([, cf]) => cf > 0) && cfs.some(([, cf]) => cf < 0))) {
    throw new Error('XIRR requires at least one positive and one negative cashflow.');
  }

  let lo = -0.9999;
  let hi = 10.0;
  let fLo = xnpv(lo, cfs);
  let fHi = xnpv(hi, cfs);

  // Expand hi if needed
  while (fLo * fHi > 0 && hi < 1e6) {
    hi *= 2.0;
    fHi = xnpv(hi, cfs);
  }

  if (fLo * fHi > 0) {
    throw new Error('Could not bracket IRR root.');
  }

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2.0;
    const fMid = xnpv(mid, cfs);
    if (Math.abs(fMid) < 1e-10) {
      return mid;
    }
    if (fLo * fMid <= 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2.0;
}

export function modifiedDietz(
  startValue: number,
  endValue: number,
  flows: Cashflow[],
  start: Date,
  end: Date
): number {
  /**
   * Fallback when XIRR is numerically unstable.
   */
  const T = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
  if (T <= 0) {
    throw new Error('Invalid period.');
  }
  let weightedFlows = 0.0;
  let totalFlows = 0.0;
  for (const [d, cf] of flows) {
    const t = (d.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
    const w = (T - t) / T;
    weightedFlows += cf * w;
    totalFlows += cf;
  }
  const denom = startValue + weightedFlows;
  if (Math.abs(denom) < 1e-12) {
    throw new Error('Dietz denominator near zero.');
  }
  return (endValue - startValue - totalFlows) / denom;
}

// ============================================================================
// Benchmark Configuration
// ============================================================================

export interface BenchmarkConfig {
  US_LARGE: string;
  US_MID: string;
  US_SMALL: string;
  US_TOTAL: string;
  INTL_DEV: string;
  INTL_EM: string;
  INTL_TOTAL: string;
  BONDS_TOTAL: string;
  CASH: string;
  LARGE_CAP_MIN: number;
  MID_CAP_MIN: number;
}

export const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
  US_LARGE: 'VOO',
  US_MID: 'VO',
  US_SMALL: 'VB',
  US_TOTAL: 'VTI',
  INTL_DEV: 'VEA',
  INTL_EM: 'VWO',
  INTL_TOTAL: 'VXUS',
  BONDS_TOTAL: 'BND',
  CASH: 'BIL',
  LARGE_CAP_MIN: 10e9,
  MID_CAP_MIN: 2e9,
};

function classifyBucket(
  sec: SecurityMeta,
  ticker: string | null,
  fundProvider: FundDataProvider,
  cfg: BenchmarkConfig
): string {
  const st = (sec.type || '').toLowerCase();
  const sb = (sec.subtype || '').toLowerCase();

  if (st === 'cash' || sec.is_cash_equivalent === true) {
    return 'CASH';
  }
  if (st.includes('fixed income') || st === 'bond' || st === 'bill') {
    return 'BONDS';
  }
  
  // Use existing benchmark matcher logic
  // Map benchmark ticker to bucket
  const benchmarkTicker = getBenchmarkForPlaidSecurity({
    ticker_symbol: ticker || null,
    name: sec.name,
    type: sec.type,
  });

  // Map benchmark tickers to buckets
  if (benchmarkTicker === cfg.CASH || benchmarkTicker === 'BIL') {
    return 'CASH';
  }
  if (benchmarkTicker === cfg.BONDS_TOTAL || benchmarkTicker === 'AGG' || benchmarkTicker === 'BND') {
    return 'BONDS';
  }
  if (benchmarkTicker === cfg.US_SMALL || benchmarkTicker === 'VB' || benchmarkTicker === 'IWM') {
    return 'US_SMALL';
  }
  if (benchmarkTicker === cfg.US_MID || benchmarkTicker === 'VO' || benchmarkTicker === 'IJH') {
    return 'US_MID';
  }
  if (benchmarkTicker === cfg.US_LARGE || benchmarkTicker === 'VOO' || benchmarkTicker === 'SPY') {
    return 'US_LARGE';
  }
  
  // Default to US_TOTAL for equity-like assets
  return 'US_TOTAL';
}

// ============================================================================
// Portfolio Reconstruction & Valuation
// ============================================================================

export function resolveTicker(
  securityId: string,
  securities: Map<string, SecurityMeta>
): string | null {
  const s = securities.get(securityId);
  if (!s) return null;
  if (s.ticker) return s.ticker;
  // Check proxy_security_id
  if (s.proxy_security_id) {
    const proxy = securities.get(s.proxy_security_id);
    if (proxy?.ticker) return proxy.ticker;
  }
  return null;
}

function computeEndValues(
  accountObj: any,
  holdings: Holding[],
  securities: Map<string, SecurityMeta>
): [number, number] {
  /**
   * Returns (end_total_value, end_cash_value).
   */
  const bal = accountObj?.balances || {};
  let endTotal = bal.current;
  let endCash = bal.available;

  // Fallback if missing
  if (endTotal == null) {
    endTotal = holdings.reduce((sum, h) => sum + h.institution_value, 0);
  }

  // Cash fallback: infer cash-like holdings
  let cashLike = 0.0;
  for (const h of holdings) {
    const sec = securities.get(h.security_id);
    if (sec && (sec.is_cash_equivalent === true || (sec.type || '').toLowerCase() === 'cash')) {
      cashLike += h.institution_value;
    }
  }

  if (endCash == null) {
    endCash = cashLike;
  }

  return [endTotal, endCash];
}

export function reconstructStartPositions(
  endQty: Map<string, number>,
  txs: InvestmentTx[],
  start: Date,
  end: Date
): Map<string, number> {
  // Reverse the net quantity deltas to infer starting shares
  const qtyDelta = new Map<string, number>();
  for (const tx of txs) {
    if (tx.security_id == null) continue;
    if (tx.type === 'cancel') continue;
    if (tx.date < start || tx.date > end) continue;
    const current = qtyDelta.get(tx.security_id) || 0;
    qtyDelta.set(tx.security_id, current + tx.quantity);
  }

  const startQty = new Map<string, number>();
  for (const [sid, qEnd] of endQty) {
    startQty.set(sid, qEnd - (qtyDelta.get(sid) || 0));
  }

  // Also include securities that were fully sold during window
  for (const [sid, dq] of qtyDelta) {
    if (!startQty.has(sid)) {
      startQty.set(sid, 0 - dq);
    }
  }

  return startQty;
}

function computeCashStart(
  endCash: number,
  txs: InvestmentTx[],
  start: Date,
  end: Date
): number {
  // cash_change in account = -amount (because amount positive means cash debited)
  let s = 0.0;
  for (const tx of txs) {
    if (tx.date >= start && tx.date <= end && tx.type !== 'cancel') {
      s += tx.amount;
    }
  }
  return endCash + s;
}

async function computePortfolioValuesMonthly(
  startQty: Map<string, number>,
  txs: InvestmentTx[],
  securities: Map<string, SecurityMeta>,
  market: MarketDataProvider,
  start: Date,
  end: Date,
  startCash: number,
  monthEnds: Date[]
): Promise<Map<Date, number>> {
  /**
   * Reconstruct month-end portfolio values.
   * Uses monthly total returns for valuation.
   */
  // Build tickers list
  const tickers: string[] = [];
  const tickerMap = new Map<string, string>(); // security_id -> ticker
  for (const sid of startQty.keys()) {
    const ticker = resolveTicker(sid, securities);
    if (ticker && !tickers.includes(ticker)) {
      tickers.push(ticker);
      tickerMap.set(sid, ticker);
    }
  }

  const rets = await market.getMonthlyTotalReturns(tickers, monthEnds);

  // Create per-security "index level" series starting at 1.0 at first month_end
  const idx = new Map<string, Map<Date, number>>();
  for (const t of tickers) {
    const tickerIdx = new Map<Date, number>();
    let level = 1.0;
    const tickerRets = rets.get(t) || new Map();
    for (const me of monthEnds) {
      const r = tickerRets.get(me);
      if (r == null) {
        // Missing return -> assume 0 for robustness (keep level unchanged)
        // level stays the same
      } else {
        level *= 1.0 + r;
      }
      tickerIdx.set(me, level);
    }
    idx.set(t, tickerIdx);
  }

  // Apply transactions forward to get month-end shares
  const shares = new Map<string, number>(startQty);
  let cash = startCash;
  const values = new Map<Date, number>();

  // Pre-bucket txs by month_end
  const byMe = new Map<Date, InvestmentTx[]>();
  for (const tx of txs) {
    if (tx.type === 'cancel') continue;
    if (tx.date < start || tx.date > end) continue;
    const me = monthEnd(tx.date);
    if (!byMe.has(me)) {
      byMe.set(me, []);
    }
    byMe.get(me)!.push(tx);
  }

  // Track starting prices (use first month-end as anchor)
  const firstMe = monthEnds[0];
  const anchorPrices = new Map<string, number>();
  
  // Get initial prices from holdings or transactions
  for (const [sid, q] of startQty) {
    const ticker = tickerMap.get(sid);
    if (ticker) {
      // Try to get a price from transactions
      const txWithPrice = txs.find(t => t.security_id === sid && t.price > 0);
      if (txWithPrice) {
        anchorPrices.set(sid, txWithPrice.price);
      } else {
        // Default to 1.0 if no price available (will use relative returns)
        anchorPrices.set(sid, 1.0);
      }
    }
  }

  for (const me of monthEnds) {
    // Apply transactions that occurred in this month
    for (const tx of byMe.get(me) || []) {
      // Quantity affects shares if security_id present
      if (tx.security_id != null) {
        const current = shares.get(tx.security_id) || 0;
        shares.set(tx.security_id, current + tx.quantity);
        
        // Update anchor price if we see a transaction price
        if (tx.price > 0) {
          anchorPrices.set(tx.security_id, tx.price);
        }
      }
      // Cash changes by -amount (account cash decreases when amount positive)
      cash += -tx.amount;
    }

    // Compute value using index levels
    let total = cash;
    for (const [sid, q] of shares) {
      const ticker = tickerMap.get(sid);
      if (!ticker || !idx.has(ticker)) continue;
      
      const tickerIdx = idx.get(ticker)!;
      const indexLevel = tickerIdx.get(me) || 1.0;
      const anchorPrice = anchorPrices.get(sid) || 1.0;
      
      // Value = quantity * anchor_price * index_level
      total += q * anchorPrice * indexLevel;
    }
    values.set(me, total);
  }

  return values;
}

// ============================================================================
// Benchmark Simulation
// ============================================================================

async function buildBenchmarkWeights(
  startQty: Map<string, number>,
  securities: Map<string, SecurityMeta>,
  fundProvider: FundDataProvider,
  cfg: BenchmarkConfig
): Promise<Map<string, number>> {
  /**
   * Map holdings to a small set of benchmark ETFs/indices.
   * Uses the existing benchmark-matcher to determine the appropriate benchmark.
   */
  const bucketValue = new Map<string, number>();

  // We only have shares here; in production you should value at start_date using prices.
  // For "rough weights", treat each position equally-weighted by abs(shares).
  for (const [sid, q] of startQty) {
    const sec = securities.get(sid);
    if (!sec) continue;
    const tkr = resolveTicker(sid, securities);
    
    // Use existing benchmark matcher to get the benchmark ticker directly
    const bench = getBenchmarkForPlaidSecurity({
      ticker_symbol: tkr || null,
      name: sec.name,
      type: sec.type,
    });

    bucketValue.set(bench, (bucketValue.get(bench) || 0) + Math.abs(q));
  }

  const total = Array.from(bucketValue.values()).reduce((a, b) => a + b, 0);
  if (total <= 0) {
    return new Map([[cfg.US_TOTAL, 1.0]]);
  }
  
  const weights = new Map<string, number>();
  for (const [bench, val] of bucketValue) {
    weights.set(bench, val / total);
  }
  return weights;
}

async function simulateBenchmarkEndValue(
  startValue: number,
  cashFlows: Cashflow[],
  benchWeights: Map<string, number>,
  market: MarketDataProvider,
  start: Date,
  end: Date
): Promise<number> {
  /**
   * Simulate benchmark portfolio value through time with the *same external cashflows*.
   */
  const monthEnds = iterMonthEnds(start, end);
  const tickers = Array.from(benchWeights.keys());
  const rets = await market.getMonthlyTotalReturns(tickers, monthEnds);

  // Shares in benchmark ETFs in "dollarized units": we just track value allocations directly
  let benchValue = startValue;
  const cfByMe = new Map<Date, number>();
  for (const [d, cf] of cashFlows) {
    const me = monthEnd(d);
    cfByMe.set(me, (cfByMe.get(me) || 0) + cf);
  }

  for (const me of monthEnds) {
    // Apply return for month
    // Portfolio return = sum(weights * r)
    let rP = 0.0;
    for (const t of tickers) {
      const weight = benchWeights.get(t) || 0;
      const tickerRets = rets.get(t) || new Map();
      const r = tickerRets.get(me) || 0.0;
      rP += weight * r;
    }
    benchValue *= 1.0 + rP;

    // Apply cashflow at end of month:
    // Investor contribution is negative -> increases invested capital -> value increases by -cf
    // Investor withdrawal is positive -> reduces value by cf
    benchValue -= cfByMe.get(me) || 0;
  }

  return benchValue;
}

// ============================================================================
// Fee Calculation
// ============================================================================

function computeExplicitFees(txs: InvestmentTx[], start: Date, end: Date): number {
  /**
   * Explicit fees from:
   *   - fee transactions (type == 'fee' or fee-like cash subtypes)
   *   - per-transaction `fees` field
   */
  let total = 0.0;
  for (const tx of txs) {
    if (tx.date < start || tx.date > end) continue;
    if (tx.type === 'cancel') continue;
    if (tx.fees != null) {
      total += tx.fees;
    }
    if (tx.type === 'fee') {
      // Amount is cash debited (positive) for fee payments
      total += Math.max(0.0, tx.amount);
    }
    if (tx.type === 'cash' && tx.subtype && FEE_SUBTYPES.has(tx.subtype)) {
      total += Math.max(0.0, tx.amount);
    }
  }
  return total;
}

async function estimateImplicitFundFees(
  avgPortfolioValue: number,
  holdings: Holding[],
  securities: Map<string, SecurityMeta>,
  fundProvider: FundDataProvider
): Promise<number> {
  /**
   * Rough implicit fee estimate:
   *   Sum(value_in_funds * expense_ratio) over the year, prorated for the period.
   */
  let fundValue = 0.0;
  let weightedER = 0.0;

  for (const h of holdings) {
    const sec = securities.get(h.security_id);
    if (!sec) continue;
    const st = (sec.type || '').toLowerCase();
    if (st !== 'etf' && st !== 'mutual fund') continue;
    
    const tkr = resolveTicker(h.security_id, securities);
    if (!tkr) continue;
    
    const er = await fundProvider.getExpenseRatio(tkr);
    if (er == null) continue;
    
    fundValue += h.institution_value;
    weightedER += h.institution_value * er;
  }

  if (fundValue <= 0) return 0.0;
  const erEff = weightedER / fundValue;
  return avgPortfolioValue * erEff;
}

// ============================================================================
// Main Engine Result
// ============================================================================

export interface EngineResult {
  start_date: Date;
  end_date: Date;
  start_value: number;
  end_value: number;
  irr_net: number | null;
  irr_net_dietz: number | null;
  benchmark_irr: number | null;
  benchmark_end_value: number | null;
  explicit_fees: number;
  implicit_fees_est: number;
  fee_drag_approx: number | null;
}

// ============================================================================
// Main Engine Class
// ============================================================================

export class PlaidPerformanceEngine {
  constructor(
    private market: MarketDataProvider,
    private funds: FundDataProvider,
    private cfg: BenchmarkConfig = DEFAULT_BENCHMARK_CONFIG
  ) {}

  async computeForAccount(
    accountId: string,
    holdingsResp: any,
    transactionsResp: any,
    endOverride: Date | null = null,
    lookbackDays: number = 730 // ~24 months
  ): Promise<EngineResult> {
    const { accounts, holdings: holdingsAll, securities } = parsePlaidHoldings(holdingsResp);
    const txsAll = parsePlaidInvestmentTransactions(transactionsResp);

    const holdings = holdingsAll.filter((h) => h.account_id === accountId);
    const txs = txsAll.filter((t) => t.account_id === accountId);

    if (!accounts.has(accountId)) {
      throw new Error(`account_id ${accountId} not found in holdings accounts list`);
    }

    // Determine end_date: prefer override, else max tx date, else today
    let end: Date;
    if (endOverride) {
      end = endOverride;
    } else if (txs.length > 0) {
      end = new Date(Math.max(...txs.map((t) => t.date.getTime())));
    } else {
      end = new Date();
    }

    const start = new Date(end);
    start.setDate(start.getDate() - lookbackDays);

    // Ending values
    const [endTotal, endCash] = computeEndValues(accounts.get(accountId)!, holdings, securities);

    // End quantities from holdings
    const endQty = new Map<string, number>();
    for (const h of holdings) {
      endQty.set(h.security_id, h.quantity);
    }

    // Start positions + cash
    const startQty = reconstructStartPositions(endQty, txs, start, end);
    const startCash = computeCashStart(endCash, txs, start, end);

    // For IRR we need start_value and end_value in same units.
    const monthEnds = iterMonthEnds(start, end);
    const valuesPath = await computePortfolioValuesMonthly(
      startQty,
      txs,
      securities,
      this.market,
      start,
      end,
      startCash,
      monthEnds
    );

    // Anchor start and end on the valuation path for internal consistency
    const startValue = valuesPath.get(monthEnds[0]) || endTotal;
    const endValue = valuesPath.get(monthEnds[monthEnds.length - 1]) || endTotal;

    // External cashflows
    const extFlows: Cashflow[] = [];
    for (const tx of txs) {
      if (isExternalCashFlow(tx) && tx.date >= start && tx.date <= end) {
        const cf = investorCashflowAmount(tx);
        if (Math.abs(cf) > 1e-9) {
          extFlows.push([tx.date, cf]);
        }
      }
    }
    extFlows.sort((a, b) => a[0].getTime() - b[0].getTime());

    // IRR cashflow set: -start_value, external flows, +end_value
    let irrNet: number | null = null;
    let irrDietz: number | null = null;
    try {
      irrNet = xirr([
        [start, -startValue],
        ...extFlows,
        [end, endValue],
      ]);
    } catch (e) {
      try {
        irrDietz = modifiedDietz(startValue, endValue, extFlows, start, end);
      } catch (e2) {
        irrDietz = null;
      }
    }

    // Benchmark
    const benchWeights = await buildBenchmarkWeights(
      startQty,
      securities,
      this.funds,
      this.cfg
    );
    const benchEnd = await simulateBenchmarkEndValue(
      startValue,
      extFlows,
      benchWeights,
      this.market,
      start,
      end
    );

    let benchmarkIrr: number | null = null;
    try {
      benchmarkIrr = xirr([
        [start, -startValue],
        ...extFlows,
        [end, benchEnd],
      ]);
    } catch (e) {
      benchmarkIrr = null;
    }

    // Fees
    const explicit = computeExplicitFees(txs, start, end);

    // Implicit: rough estimate from average value and expense ratios of held funds
    const avgValue = 0.5 * (startValue + endValue);
    const implicit = await estimateImplicitFundFees(avgValue, holdings, securities, this.funds);

    let feeDrag: number | null = null;
    if (irrNet != null) {
      // Compute a rough "gross" IRR by adding fees back as value at the end
      const grossEnd = endValue + explicit + implicit;
      try {
        const grossIrr = xirr([
          [start, -startValue],
          ...extFlows,
          [end, grossEnd],
        ]);
        feeDrag = grossIrr - irrNet;
      } catch (e) {
        feeDrag = null;
      }
    }

    return {
      start_date: start,
      end_date: end,
      start_value: startValue,
      end_value: endValue,
      irr_net: irrNet,
      irr_net_dietz: irrDietz,
      benchmark_irr: benchmarkIrr,
      benchmark_end_value: benchEnd,
      explicit_fees: explicit,
      implicit_fees_est: implicit,
      fee_drag_approx: feeDrag,
    };
  }
}

