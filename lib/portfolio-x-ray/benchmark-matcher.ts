/**
 * Map holdings to appropriate benchmarks
 */

export interface BenchmarkMapping {
  [ticker: string]: string;
}

/**
 * Default benchmark mappings
 * Maps common fund tickers to benchmark ETFs
 */
export const DEFAULT_BENCHMARK_MAP: BenchmarkMapping = {
  // US Stock Funds → S&P 500
  'VTSAX': 'SPY',  // Vanguard Total Stock Market
  'VTI': 'SPY',    // Vanguard Total Stock Market ETF
  'SPY': 'SPY',    // S&P 500 ETF
  'VOO': 'SPY',    // Vanguard S&P 500
  'VFIAX': 'SPY',  // Vanguard 500 Index
  'FXAIX': 'SPY',  // Fidelity 500 Index
  'SWPPX': 'SPY',  // Schwab S&P 500
  
  // International Stock Funds → MSCI EAFE / VEA
  'VTIAX': 'VEA',  // Vanguard Total International Stock
  'VXUS': 'VEA',   // Vanguard Total International Stock ETF
  'VEA': 'VEA',    // Vanguard FTSE Developed Markets
  'VFWAX': 'VEA',  // Vanguard FTSE All-World ex-US
  
  // Emerging Markets → VWO
  'VEMAX': 'VWO',  // Vanguard Emerging Markets
  'VWO': 'VWO',    // Vanguard Emerging Markets ETF
  
  // Bonds → AGG
  'VBTLX': 'AGG',  // Vanguard Total Bond Market
  'BND': 'AGG',    // Vanguard Total Bond Market ETF
  'AGG': 'AGG',    // iShares Core US Aggregate Bond
  'FXNAX': 'AGG',  // Fidelity US Bond Index
  
  // Small Cap → IWM
  'VSMAX': 'IWM',  // Vanguard Small-Cap Index
  'VB': 'IWM',     // Vanguard Small-Cap ETF
  'IWM': 'IWM',    // iShares Russell 2000
  
  // Mid Cap → IJH
  'VIMAX': 'IJH',  // Vanguard Mid-Cap Index
  'VO': 'IJH',     // Vanguard Mid-Cap ETF
  'IJH': 'IJH',    // iShares Core S&P Mid-Cap
};

/**
 * Match a security to its benchmark
 */
export function matchSecurityToBenchmark(
  ticker: string | null | undefined,
  securityName: string | null | undefined,
  securityType: string | null | undefined
): string {
  if (!ticker) {
    return 'SPY'; // Default to S&P 500
  }

  const upperTicker = ticker.toUpperCase().trim();
  
  // Check exact match first
  if (DEFAULT_BENCHMARK_MAP[upperTicker]) {
    return DEFAULT_BENCHMARK_MAP[upperTicker];
  }

  // Heuristic matching based on name/type
  const name = (securityName || '').toLowerCase();
  const type = (securityType || '').toLowerCase();

  // Bonds
  if (name.includes('bond') || name.includes('fixed income') || 
      type.includes('bond') || type.includes('fixed income')) {
    return 'AGG';
  }

  // International
  if (name.includes('international') || name.includes('global ex-us') || 
      name.includes('eafe') || name.includes('developed markets')) {
    return 'VEA';
  }

  // Emerging markets
  if (name.includes('emerging markets') || name.includes('emerging')) {
    return 'VWO';
  }

  // Small cap
  if (name.includes('small cap') || name.includes('small-cap')) {
    return 'IWM';
  }

  // Mid cap
  if (name.includes('mid cap') || name.includes('mid-cap')) {
    return 'IJH';
  }

  // Default to S&P 500 for stocks
  return 'SPY';
}

/**
 * Get benchmark ticker for a Plaid security
 */
export function getBenchmarkForPlaidSecurity(security: {
  ticker_symbol?: string | null;
  name?: string | null;
  type?: string | null;
}): string {
  return matchSecurityToBenchmark(
    security.ticker_symbol,
    security.name,
    security.type
  );
}

