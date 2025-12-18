/**
 * Portfolio X-Ray - Cashflow Analyzer
 *
 * Extracts and classifies external cashflows from transactions.
 * External cashflows are contributions/withdrawals that affect IRR.
 */

import { Transaction, Cashflow, CashflowDetail } from './types';
import { EXTERNAL_CASHFLOW_SUBTYPES } from './config';
import { getMonthEndStr } from './date-utils';

/**
 * Check if a transaction represents an external cashflow.
 *
 * External cashflows include:
 * - Cash deposits/withdrawals
 * - Contributions/distributions
 * - In-kind transfers (securities transferred in/out)
 *
 * NOT external:
 * - Buys/sells (internal portfolio activity)
 * - Dividends (reinvested = internal, paid out = we treat as internal per spec)
 * - Fees (embedded in performance)
 */
export function isExternalCashflow(tx: Transaction): boolean {
  // Cash type with external subtype
  if (tx.type === 'cash' && tx.subtype && EXTERNAL_CASHFLOW_SUBTYPES.has(tx.subtype)) {
    return true;
  }

  // Buy/sell with contribution/distribution subtype (retirement plan contributions)
  if (
    (tx.type === 'buy' || tx.type === 'sell') &&
    tx.subtype &&
    (tx.subtype === 'contribution' || tx.subtype === 'distribution')
  ) {
    return true;
  }

  // In-kind transfer (securities transferred with $0 cash amount)
  if (isInKindTransfer(tx)) {
    return true;
  }

  return false;
}

/**
 * Check if a transaction is an in-kind transfer.
 */
function isInKindTransfer(tx: Transaction): boolean {
  return (
    tx.type === 'transfer' &&
    tx.subtype === 'transfer' &&
    tx.security_id !== null &&
    Math.abs(tx.amount) < 1e-9
  );
}

/**
 * Get the cashflow amount for XIRR calculation.
 *
 * Convention (from investor perspective):
 * - Contributions are NEGATIVE (investor pays in)
 * - Withdrawals are POSITIVE (investor receives)
 *
 * Plaid's 'amount' field already uses this convention for cash movements.
 */
export function getCashflowAmount(tx: Transaction): number {
  // For in-kind transfers, use quantity * price since amount is $0
  if (isInKindTransfer(tx)) {
    return -tx.quantity * tx.price;
  }

  // For buy/sell with contribution/distribution, if amount is ~0, use quantity * price
  if (
    (tx.type === 'buy' || tx.type === 'sell') &&
    tx.subtype &&
    (tx.subtype === 'contribution' || tx.subtype === 'distribution') &&
    Math.abs(tx.amount) < 1e-9
  ) {
    return -tx.quantity * tx.price;
  }

  // Standard case: use Plaid's amount directly
  return tx.amount;
}

/**
 * Extract external cashflows from transactions.
 *
 * @param transactions All transactions
 * @param startDate Filter: only include cashflows on or after this date
 * @param endDate Filter: only include cashflows on or before this date
 * @returns Array of cashflows sorted by date
 */
export function extractExternalCashflows(
  transactions: Transaction[],
  startDate?: string,
  endDate?: string
): Cashflow[] {
  const cashflows: Cashflow[] = [];

  for (const tx of transactions) {
    // Check date range if specified
    if (startDate && tx.date < startDate) continue;
    if (endDate && tx.date > endDate) continue;

    if (isExternalCashflow(tx)) {
      const amount = getCashflowAmount(tx);

      // Skip near-zero cashflows
      if (Math.abs(amount) < 1e-9) continue;

      cashflows.push({
        date: tx.date,
        amount,
      });
    }
  }

  // Sort by date
  cashflows.sort((a, b) => a.date.localeCompare(b.date));

  return cashflows;
}

/**
 * Aggregate cashflows by month-end for benchmark simulation.
 */
export function aggregateCashflowsByMonth(
  cashflows: Cashflow[]
): Map<string, number> {
  const byMonth = new Map<string, number>();

  for (const cf of cashflows) {
    const monthEnd = getMonthEndStr(cf.date);
    const current = byMonth.get(monthEnd) || 0;
    byMonth.set(monthEnd, current + cf.amount);
  }

  return byMonth;
}

/**
 * Build detailed cashflow list for API response.
 *
 * @param cashflows External cashflows
 * @param startDate Start date of analysis period
 * @param startValue Starting portfolio value
 * @param endDate End date of analysis period
 * @param endValue Ending portfolio value
 */
export function buildCashflowDetails(
  cashflows: Cashflow[],
  startDate: string,
  startValue: number,
  endDate: string,
  endValue: number
): CashflowDetail[] {
  const details: CashflowDetail[] = [];

  // Start value (investment into portfolio = negative)
  details.push({
    date: startDate,
    amount: -startValue,
    type: 'START',
  });

  // External cashflows
  for (const cf of cashflows) {
    details.push({
      date: cf.date,
      amount: cf.amount,
      type: cf.amount < 0 ? 'CONTRIBUTION' : 'WITHDRAWAL',
    });
  }

  // End value (value received = positive)
  details.push({
    date: endDate,
    amount: endValue,
    type: 'END',
  });

  return details;
}
