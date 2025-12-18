/**
 * Portfolio X-Ray - Configuration
 *
 * Central configuration for constants, defaults, and mappings.
 */

// ============================================================================
// Analysis Configuration
// ============================================================================

export const LOOKBACK_MONTHS = 24;

// Cash benchmark ticker (for cash/margin returns)
export const CASH_BENCHMARK_TICKER = 'SGOV';

// ============================================================================
// Default Expense Ratios (Annual, Decimal)
// ============================================================================

export const DEFAULT_EXPENSE_RATIOS: Record<string, number> = {
  // Security types
  'mutual fund': 0.005, // 50 bps
  'etf': 0.001, // 10 bps

  // Specific tickers (override defaults)
  'VTSAX': 0.0004, // 4 bps
  'VTI': 0.0003, // 3 bps
  'VTIAX': 0.0011, // 11 bps
  'VXUS': 0.0008, // 8 bps
  'VBTLX': 0.0005, // 5 bps
  'BND': 0.0003, // 3 bps
  'VOO': 0.0003, // 3 bps
  'VFIAX': 0.0004, // 4 bps
  'FXAIX': 0.00015, // 1.5 bps
  'FXNAX': 0.00025, // 2.5 bps
  'SWPPX': 0.0002, // 2 bps
  'AGG': 0.0003, // 3 bps
  'SPY': 0.000945, // 9.45 bps
  'IWM': 0.0019, // 19 bps
  'IJH': 0.0006, // 6 bps
  'BIL': 0.00135, // 13.5 bps
  'SGOV': 0.0009, // 9 bps
};

// ============================================================================
// Benchmark Mappings
// ============================================================================

// Default benchmark ETF tickers
export const BENCHMARK_TICKERS = {
  US_LARGE_CAP: 'SPY',
  US_MID_CAP: 'IJH',
  US_SMALL_CAP: 'IWM',
  INTL_DEVELOPED: 'VEA',
  INTL_EMERGING: 'VWO',
  BONDS_AGGREGATE: 'AGG',
  CASH: 'SGOV',
} as const;

// Direct ticker-to-benchmark mappings
export const TICKER_BENCHMARK_MAP: Record<string, string> = {
  // US Total Market / Large Cap → SPY
  'VTSAX': 'SPY',
  'VTI': 'SPY',
  'SPY': 'SPY',
  'VOO': 'SPY',
  'VFIAX': 'SPY',
  'FXAIX': 'SPY',
  'SWPPX': 'SPY',
  'IVV': 'SPY',
  'SPTM': 'SPY',
  'SCHB': 'SPY',
  'ITOT': 'SPY',

  // International Developed → VEA
  'VTIAX': 'VEA',
  'VXUS': 'VEA',
  'VEA': 'VEA',
  'VFWAX': 'VEA',
  'EFA': 'VEA',
  'IEFA': 'VEA',
  'SCHF': 'VEA',
  'IXUS': 'VEA',

  // Emerging Markets → VWO
  'VEMAX': 'VWO',
  'VWO': 'VWO',
  'EEM': 'VWO',
  'IEMG': 'VWO',
  'SCHE': 'VWO',

  // Bonds → AGG
  'VBTLX': 'AGG',
  'BND': 'AGG',
  'AGG': 'AGG',
  'FXNAX': 'AGG',
  'SCHZ': 'AGG',
  'FBND': 'AGG',

  // Small Cap → IWM
  'VSMAX': 'IWM',
  'VB': 'IWM',
  'IWM': 'IWM',
  'SCHA': 'IWM',
  'IJR': 'IWM',

  // Mid Cap → IJH
  'VIMAX': 'IJH',
  'VO': 'IJH',
  'IJH': 'IJH',
  'SCHM': 'IJH',

  // Cash/Money Market → SGOV
  'BIL': 'SGOV',
  'SGOV': 'SGOV',
  'SHV': 'SGOV',
  'VMFXX': 'SGOV',
  'SPAXX': 'SGOV',
  'FDRXX': 'SGOV',
};

// ============================================================================
// Transaction Classification
// ============================================================================

// Transaction subtypes that represent external cashflows
export const EXTERNAL_CASHFLOW_SUBTYPES = new Set([
  'deposit',
  'withdrawal',
  'contribution',
  'distribution',
]);

// Transaction subtypes that represent fees
export const FEE_SUBTYPES = new Set([
  'account fee',
  'management fee',
  'legal fee',
  'margin expense',
  'transfer fee',
  'trust fee',
  'advisory fee',
  'custody fee',
]);

// ============================================================================
// Debug Configuration
// ============================================================================

export const DEBUG_OUTPUT_DIR = 'C:\\code\\portfolio_x_ray\\debug_output';
