/**
 * Portfolio X-Ray - Benchmark Matcher
 *
 * Maps securities to appropriate benchmark ETFs based on:
 * 1. Direct ticker mapping (known funds)
 * 2. Name-based heuristics (keywords)
 * 3. Type-based classification (fallback)
 */

import { Security } from './types';
import { TICKER_BENCHMARK_MAP, BENCHMARK_TICKERS } from './config';

/**
 * Get the benchmark ETF ticker for a security.
 *
 * Priority:
 * 1. Direct ticker match (if ticker is in our map)
 * 2. Name-based heuristics (keywords in security name)
 * 3. Type-based fallback (equity, bond, cash)
 */
export function getBenchmarkForSecurity(security: Security): string {
  const ticker = security.ticker_symbol?.toUpperCase().trim();
  const name = (security.name || '').toLowerCase();
  const type = (security.type || '').toLowerCase();

  // 1. Check direct ticker mapping
  if (ticker && TICKER_BENCHMARK_MAP[ticker]) {
    return TICKER_BENCHMARK_MAP[ticker];
  }

  // 2. Cash equivalents
  if (security.is_cash_equivalent || type === 'cash') {
    return BENCHMARK_TICKERS.CASH;
  }

  // 3. Name-based heuristics
  // Bonds / Fixed Income
  if (
    name.includes('bond') ||
    name.includes('fixed income') ||
    name.includes('treasury') ||
    name.includes('aggregate') ||
    type.includes('bond') ||
    type.includes('fixed income')
  ) {
    return BENCHMARK_TICKERS.BONDS_AGGREGATE;
  }

  // International - Emerging Markets
  if (
    name.includes('emerging market') ||
    name.includes('emerging mkts') ||
    name.includes('em fund')
  ) {
    return BENCHMARK_TICKERS.INTL_EMERGING;
  }

  // International - Developed
  if (
    name.includes('international') ||
    name.includes('global ex-us') ||
    name.includes('ex-us') ||
    name.includes('eafe') ||
    name.includes('developed market') ||
    name.includes('foreign') ||
    name.includes('world ex')
  ) {
    return BENCHMARK_TICKERS.INTL_DEVELOPED;
  }

  // Small Cap
  if (name.includes('small cap') || name.includes('small-cap') || name.includes('smallcap')) {
    return BENCHMARK_TICKERS.US_SMALL_CAP;
  }

  // Mid Cap
  if (name.includes('mid cap') || name.includes('mid-cap') || name.includes('midcap')) {
    return BENCHMARK_TICKERS.US_MID_CAP;
  }

  // 4. Type-based fallback
  // Default equities to S&P 500
  if (
    type === 'equity' ||
    type === 'etf' ||
    type === 'mutual fund' ||
    type === 'stock'
  ) {
    return BENCHMARK_TICKERS.US_LARGE_CAP;
  }

  // Ultimate fallback: S&P 500
  return BENCHMARK_TICKERS.US_LARGE_CAP;
}

/**
 * Get the benchmark ETF ticker for a Plaid security object.
 * (Compatibility wrapper for existing code)
 */
export function getBenchmarkForPlaidSecurity(security: {
  ticker_symbol?: string | null;
  name?: string | null;
  type?: string | null;
}): string {
  return getBenchmarkForSecurity({
    security_id: '',
    ticker_symbol: security.ticker_symbol || null,
    name: security.name || '',
    type: security.type || '',
    is_cash_equivalent: false,
  });
}

/**
 * Calculate dollar-weighted benchmark allocation from positions.
 *
 * @param positions Map of security_id -> { value, ... }
 * @param securities Map of security_id -> Security
 * @returns Map of benchmark ticker -> weight (percentage 0-100)
 */
export function calculateBenchmarkWeights(
  positions: Map<string, { value: number }>,
  securities: Map<string, Security>
): Map<string, number> {
  const benchmarkValues = new Map<string, number>();
  let totalValue = 0;

  // Accumulate values by benchmark
  for (const [securityId, position] of positions) {
    const security = securities.get(securityId);
    if (!security) continue;

    const benchmark = getBenchmarkForSecurity(security);
    const currentValue = benchmarkValues.get(benchmark) || 0;
    benchmarkValues.set(benchmark, currentValue + position.value);
    totalValue += position.value;
  }

  // Convert to percentages
  const weights = new Map<string, number>();
  if (totalValue > 0) {
    for (const [benchmark, value] of benchmarkValues) {
      weights.set(benchmark, (value / totalValue) * 100);
    }
  }

  return weights;
}

/**
 * Get all unique tickers needed for benchmark calculations.
 */
export function getBenchmarkTickers(weights: Map<string, number>): string[] {
  return Array.from(weights.keys());
}
