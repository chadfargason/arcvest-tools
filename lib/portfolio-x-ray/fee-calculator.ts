/**
 * Portfolio X-Ray - Fee Calculator
 *
 * Calculates explicit and implicit fees.
 *
 * PHASE 2: Fee calculations are preserved but output display is disabled.
 * The calculations remain for internal use and will be exposed in Phase 2.
 */

import { Transaction, Holding, Security, FeeResult, FeeTransaction } from './types';
import { FEE_SUBTYPES, DEFAULT_EXPENSE_RATIOS } from './config';

/**
 * Check if a transaction represents a fee.
 */
export function isFeeTransaction(tx: Transaction): boolean {
  if (tx.type === 'fee') return true;

  if (tx.type === 'cash' && tx.subtype && FEE_SUBTYPES.has(tx.subtype)) {
    return true;
  }

  return false;
}

/**
 * Calculate explicit fees from transactions.
 *
 * Sources:
 * - Per-transaction fees field
 * - Fee-type transactions
 * - Cash transactions with fee-related subtypes
 */
export function calculateExplicitFees(
  transactions: Transaction[],
  startDate?: string,
  endDate?: string
): { total: number; feesByType: Record<string, number>; feeTransactions: FeeTransaction[] } {
  let total = 0;
  const feesByType: Record<string, number> = {};
  const feeTransactions: FeeTransaction[] = [];

  for (const tx of transactions) {
    // Filter by date range if specified
    if (startDate && tx.date < startDate) continue;
    if (endDate && tx.date > endDate) continue;

    let feeAmount = 0;
    let feeType = '';

    // Per-transaction fees
    if (tx.fees > 0) {
      feeAmount += tx.fees;
      feeType = 'transaction fee';
    }

    // Fee-type transactions
    if (tx.type === 'fee') {
      feeAmount += Math.abs(tx.amount);
      feeType = tx.subtype || 'fee';
    }

    // Cash transactions with fee subtypes
    if (tx.type === 'cash' && tx.subtype && FEE_SUBTYPES.has(tx.subtype)) {
      feeAmount += Math.abs(tx.amount);
      feeType = tx.subtype;
    }

    if (feeAmount > 0) {
      total += feeAmount;
      feesByType[feeType] = (feesByType[feeType] || 0) + feeAmount;

      feeTransactions.push({
        date: tx.date,
        amount: feeAmount,
        account_id: tx.account_id,
        name: tx.name,
        type: feeType,
      });
    }
  }

  // Sort by date descending
  feeTransactions.sort((a, b) => b.date.localeCompare(a.date));

  return { total, feesByType, feeTransactions };
}

/**
 * Estimate implicit fees from fund expense ratios.
 *
 * Uses default expense ratios:
 * - Mutual funds: 50 bps (0.50%) annually
 * - ETFs: 10 bps (0.10%) annually
 * - Specific ticker overrides from config
 */
export function estimateImplicitFees(
  holdings: Holding[],
  securities: Map<string, Security>,
  startValue: number,
  endValue: number,
  years: number
): number {
  let totalFundValue = 0;
  let weightedER = 0;

  for (const holding of holdings) {
    const security = securities.get(holding.security_id);
    if (!security) continue;

    const type = security.type?.toLowerCase();

    // Only calculate for funds (ETFs and mutual funds)
    if (type !== 'mutual fund' && type !== 'etf') continue;

    // Get expense ratio: specific ticker > type default
    let expenseRatio: number;
    const ticker = security.ticker_symbol?.toUpperCase();

    if (ticker && DEFAULT_EXPENSE_RATIOS[ticker]) {
      expenseRatio = DEFAULT_EXPENSE_RATIOS[ticker];
    } else if (type && DEFAULT_EXPENSE_RATIOS[type]) {
      expenseRatio = DEFAULT_EXPENSE_RATIOS[type];
    } else {
      continue;
    }

    totalFundValue += holding.institution_value;
    weightedER += holding.institution_value * expenseRatio;
  }

  if (totalFundValue === 0) return 0;

  // Calculate weighted average expense ratio
  const avgER = weightedER / totalFundValue;

  // Apply to average portfolio value over the period
  const avgValue = (startValue + endValue) / 2;

  // Multiply by years to get total fees for the period
  return avgValue * avgER * years;
}

/**
 * Calculate all fees.
 *
 * PHASE 2: Calculations preserved, display hidden in API response.
 */
export function calculateFees(
  transactions: Transaction[],
  holdings: Holding[],
  securities: Map<string, Security>,
  startValue: number,
  endValue: number,
  years: number,
  startDate?: string,
  endDate?: string
): FeeResult {
  const explicit = calculateExplicitFees(transactions, startDate, endDate);
  const implicitFees = estimateImplicitFees(holdings, securities, startValue, endValue, years);

  return {
    explicitFees: explicit.total,
    implicitFees,
    totalFees: explicit.total + implicitFees,
    feesByType: explicit.feesByType,
    feeTransactions: explicit.feeTransactions,
  };
}

/**
 * Calculate fees by account.
 */
export function calculateFeesByAccount(transactions: Transaction[]): Record<string, number> {
  const feesByAccount: Record<string, number> = {};

  for (const tx of transactions) {
    if (tx.type === 'fee' || tx.fees > 0) {
      const feeAmount = (tx.type === 'fee' ? Math.abs(tx.amount) : 0) + tx.fees;
      if (feeAmount > 0) {
        feesByAccount[tx.account_id] = (feesByAccount[tx.account_id] || 0) + feeAmount;
      }
    }
  }

  return feesByAccount;
}
