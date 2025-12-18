/**
 * Portfolio X-Ray - Type Definitions
 *
 * Central type definitions for the portfolio analysis system.
 */

// ============================================================================
// Plaid Data Types (Input)
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
  type: string; // buy, sell, dividend, fee, cash, transfer, etc.
  subtype: string | null;
  quantity: number;
  amount: number; // Cash impact (positive = cash out, negative = cash in)
  price: number;
  fees: number;
  name: string;
}

// ============================================================================
// Portfolio State Types
// ============================================================================

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

// ============================================================================
// Cashflow Types
// ============================================================================

export interface Cashflow {
  date: string; // YYYY-MM-DD
  amount: number; // Negative = contribution, Positive = withdrawal
}

export type CashflowType = 'START' | 'CONTRIBUTION' | 'WITHDRAWAL' | 'END';

export interface CashflowDetail {
  date: string;
  amount: number;
  type: CashflowType;
}

// ============================================================================
// Benchmark Types
// ============================================================================

export interface BenchmarkMonthlyData {
  month: string; // YYYY-MM-DD
  return: number; // % monthly return
  cashflow: number; // $ cashflow applied this month
  value: number; // $ ending value for this month
}

export interface BenchmarkResult {
  return: number; // Annualized %
  irr: number | null; // %
  weights: Map<string, number>; // Benchmark ticker -> weight %
  monthlyData: BenchmarkMonthlyData[];
  endValue: number; // $ final benchmark value
}

// ============================================================================
// Fee Types
// ============================================================================

export interface FeeResult {
  explicitFees: number; // $ from transactions
  implicitFees: number; // $ estimated from expense ratios
  totalFees: number;
  feesByType: Record<string, number>;
  feeTransactions: FeeTransaction[];
}

export interface FeeTransaction {
  date: string;
  amount: number;
  account_id: string;
  name: string;
  type: string;
}

// ============================================================================
// Calculation Result Types
// ============================================================================

export interface PortfolioResult {
  // Date range
  startDate: string;
  endDate: string;

  // Values
  startValue: number;
  endValue: number;

  // Portfolio returns
  totalReturn: number; // %
  annualizedReturn: number; // %
  irr: number | null; // %

  // Benchmark comparison
  benchmark: BenchmarkResult;
  outperformance: number; // %

  // Fees (PHASE 2: calculations preserved, display hidden)
  fees: FeeResult;

  // Detailed data
  monthlySnapshots: PortfolioSnapshot[];
  externalCashflows: Cashflow[];
}

// ============================================================================
// Security Ledger Types (for debugging/PDF)
// ============================================================================

export interface SecurityLedgerEntry {
  date: string;
  type: string; // 'starting_position', 'buy', 'sell', 'dividend', etc.
  quantity: number; // Change in quantity (+ for buy, - for sell)
  price: number;
  amount: number;
  fees: number;
  runningQty: number; // Running total quantity after this entry
  description: string;
}

export interface SecurityLedger {
  securityId: string;
  ticker: string;
  name: string;
  entries: SecurityLedgerEntry[];
  startingQty: number;
  endingQty: number;
  startingPrice: number;
  endingPrice: number;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface HoldingDetail {
  ticker: string;
  quantity: number;
  price: number;
  value: number;
  percentage: number;
}

export interface MonthlyAnalysis {
  month: string; // MM-DD-YYYY
  portfolioReturn: number;
  portfolioValue: number;
  benchmarkReturn: number;
  benchmarkValue: number;
}

export interface AnalysisSummary {
  portfolioTotalReturn: number;
  portfolioAnnualizedReturn: number;
  benchmarkTotalReturn: number;
  benchmarkAnnualizedReturn: number;
  outperformance: number;
  irr?: number;
  benchmarkIrr?: number;
  benchmarkEndValue?: number;
  periodMonths: number;
  startDate: string;
  endDate: string;
  startValue: number;
  endValue: number;
}

export interface AnalysisResponse {
  monthlyAnalysis: MonthlyAnalysis[];
  summary: AnalysisSummary;
  fees: {
    totalFees: number;
    explicitFees: number;
    implicitFees: number;
    feesByType: Record<string, number>;
    feesByAccount: Record<string, number>;
    feeTransactions: FeeTransaction[];
  };
  portfolioAllocation: Record<string, number>;
  holdingsDetails?: HoldingDetail[];
  holdingsAsOfDate?: string;
  cashHoldings?: { value: number; percentage: number };
  plaidHoldings?: HoldingDetail[];
  plaidCashHoldings?: { value: number; percentage: number };
  plaidTotalValue?: number;
  benchmarkWeights: Record<string, number>;
  cashflowDetails?: CashflowDetail[];
  benchmarkMonthlyDetails?: BenchmarkMonthlyData[];
  holdings: number;
  transactions: number;
  allTransactions?: Transaction[];
  securityLedgers?: SecurityLedger[];
  cashLedger?: SecurityLedger;
  debug?: any;
}
