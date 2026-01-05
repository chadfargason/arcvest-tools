/**
 * Portfolio X-Ray - Cashflow Analyzer
 *
 * Extracts and classifies external cashflows from transactions.
 * External cashflows are contributions/withdrawals that affect IRR.
 *
 * IMPORTANT: Different institutions report cashflows differently through Plaid.
 * JPMorgan, for example, reports deposits as "buy" into sweep accounts rather
 * than "type=cash, subtype=deposit". This module uses the accounting identity
 * approach to reliably detect external cashflows regardless of institution.
 */

import { Transaction, Cashflow, CashflowDetail, Security } from './types';
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

// ============================================================================
// JPMorgan-Specific Pattern Detection (Hybrid Approach)
// ============================================================================

/**
 * Detect external cashflows using JPMorgan-specific patterns.
 *
 * JPMorgan reports:
 * - Withdrawals: BANKLINK ACH PUSH (type=cash, subtype=withdrawal)
 * - Deposits: Sweep INTRA-DAY DEPOSIT (type=buy into cash equivalent)
 *
 * The accounting identity approach can over/under-count when internal movements
 * (sweep <-> money market) don't fully net out within a month due to settlement timing.
 *
 * This hybrid approach:
 * 1. Uses BANKLINK transactions as ground truth for withdrawals
 * 2. Detects external deposits via net positive sweep activity
 * 3. Uses accounting identity for months without clear BANKLINK signals
 */
export function extractExternalCashflowsHybrid(
  transactions: Transaction[],
  securities: Map<string, Security>,
  startDate?: string,
  endDate?: string
): Cashflow[] {
  // Filter transactions by date range
  const txsInRange = transactions.filter(tx => {
    if (startDate && tx.date < startDate) return false;
    if (endDate && tx.date > endDate) return false;
    return true;
  });

  // Group transactions by month
  const byMonth = new Map<string, Transaction[]>();
  for (const tx of txsInRange) {
    const month = tx.date.substring(0, 7);
    const existing = byMonth.get(month) || [];
    existing.push(tx);
    byMonth.set(month, existing);
  }

  const cashflows: Cashflow[] = [];

  for (const [month, monthTxns] of byMonth) {
    const monthResult = detectMonthlyExternalFlows(monthTxns, securities);

    if (Math.abs(monthResult.netExternal) > 1) {
      const monthEndDate = getMonthEndStr(month + '-15');
      cashflows.push({
        date: monthEndDate,
        amount: monthResult.netExternal,
      });
    }
  }

  cashflows.sort((a, b) => a.date.localeCompare(b.date));
  return cashflows;
}

/**
 * Detect external flows for a single month using hybrid approach.
 */
function detectMonthlyExternalFlows(
  transactions: Transaction[],
  securities: Map<string, Security>
): { netExternal: number; method: 'banklink' | 'accounting' } {
  // Step 1: Extract BANKLINK transactions (explicit external flows)
  let banklinkWithdrawals = 0;
  let banklinkDeposits = 0;

  for (const tx of transactions) {
    if (tx.type === 'cash' && tx.name?.includes('BANKLINK')) {
      if (tx.name.includes('PUSH')) {
        // ACH PUSH = money going to external bank = withdrawal
        banklinkWithdrawals += Math.abs(tx.amount);
      } else if (tx.name.includes('PULL')) {
        // ACH PULL = money coming from external bank = deposit
        banklinkDeposits += Math.abs(tx.amount);
      }
    }
  }

  // Note: We originally tried to detect external deposits via sweep INTRA-DAY DEPOSIT patterns,
  // but this is unreliable because the same pattern is used for internal movements.
  // The accounting identity handles deposits better when there's no BANKLINK signal.

  // Step 3: Calculate using accounting identity for comparison
  const aiResult = calculateMonthlyNetExternalInternal(transactions, securities);

  // Step 4: Decide which method to use
  // XIRR convention: positive = withdrawal (investor receives), negative = contribution (investor pays)
  //
  // For JPMorgan:
  // - BANKLINK ACH PUSH = withdrawal (use as ground truth)
  // - No BANKLINK for deposits; deposits come through sweep
  // - When there's no BANKLINK, fall back to accounting identity
  const hasBanklinkWithdrawal = banklinkWithdrawals > 0;
  const hasBanklinkDeposit = banklinkDeposits > 0;

  // XIRR convention: aiResult > 0 means WITHDRAWAL, aiResult < 0 means CONTRIBUTION
  const aiIsContribution = aiResult < 0;
  const aiIsWithdrawal = aiResult > 0;

  if (hasBanklinkWithdrawal) {
    // We have explicit BANKLINK withdrawal
    if (aiIsContribution) {
      // AI says contribution, BANKLINK says withdrawal
      // Month has BOTH deposits and withdrawals - AI NET is correct because it
      // captures both activities. Don't override with just the withdrawal.
      // Example: $380k deposit + $50k withdrawal = $330k net contribution
      return { netExternal: aiResult, method: 'accounting' };
    } else {
      // Both say withdrawal - use BANKLINK amount (more accurate than AI)
      // AI over-counts withdrawals due to settlement timing issues
      return { netExternal: banklinkWithdrawals, method: 'banklink' };
    }
  }

  if (hasBanklinkDeposit) {
    // BANKLINK deposit (ACH PULL) - use as ground truth
    return { netExternal: -banklinkDeposits, method: 'banklink' };
  }

  // No BANKLINK transactions - fall back to accounting identity
  // This handles deposits (sweep INTRA-DAY DEPOSIT) and internal movements
  return { netExternal: aiResult, method: 'accounting' };
}

/**
 * Internal version of calculateMonthlyNetExternal that returns the raw value
 * (positive = contribution/deposit, negative = withdrawal)
 */
function calculateMonthlyNetExternalInternal(
  transactions: Transaction[],
  securities: Map<string, Security>
): number {
  let cashEquivChange = 0;
  let stockBuys = 0;
  let stockSells = 0;
  let dividends = 0;
  let interest = 0;
  let fees = 0;

  for (const tx of transactions) {
    const security = tx.security_id ? securities.get(tx.security_id) : null;
    const isCashEquiv = security?.is_cash_equivalent ?? false;

    if (tx.type === 'buy') {
      if (isCashEquiv) {
        cashEquivChange += tx.amount;
      } else {
        stockBuys += tx.amount;
      }
    } else if (tx.type === 'sell') {
      if (isCashEquiv) {
        cashEquivChange += tx.amount;
      } else {
        stockSells += Math.abs(tx.amount);
      }
    } else if (tx.type === 'dividend' || tx.subtype === 'dividend') {
      dividends += Math.abs(tx.amount);
    } else if (tx.subtype === 'interest') {
      interest += Math.abs(tx.amount);
    } else if (tx.type === 'fee') {
      fees += tx.amount;
    } else if (tx.type === 'transfer') {
      if (tx.security_id && !isCashEquiv && Math.abs(tx.amount) < 0.01) {
        const value = tx.quantity * tx.price;
        if (tx.quantity > 0) {
          stockBuys += value;
        } else {
          stockSells += Math.abs(value);
        }
      }
    }
  }

  const netExternal = cashEquivChange + stockBuys - stockSells - dividends - interest + fees;

  // For XIRR: positive netExternal = deposit → NEGATIVE, negative = withdrawal → POSITIVE
  return -netExternal;
}

// ============================================================================
// Accounting Identity Based Detection (Institution-Agnostic)
// ============================================================================

/**
 * Detect external cashflows using monthly net approach with accounting identity.
 *
 * This approach aggregates transactions by month to ensure internal movements
 * (e.g., sweep → money market transfers) cancel out within the same month.
 *
 * The accounting identity for each month is:
 *   Net External = Cash Equiv Change + Stock Buys - Stock Sells - Dividends - Interest + Fees
 *
 * Why monthly aggregation works:
 * - JPMorgan (and other institutions) may record internal cash movements
 *   across multiple transactions/days (e.g., deposit → sweep → money market)
 * - Daily detection would double-count these internal movements
 * - Monthly aggregation naturally cancels out internal movements
 * - Net result matches actual bank data very closely
 *
 * For XIRR calculation, monthly cashflows are placed at month-end dates.
 *
 * @param transactions All transactions for the period
 * @param securities Security metadata (to identify cash equivalents)
 * @param startDate Filter: only include cashflows on or after this date
 * @param endDate Filter: only include cashflows on or before this date
 */
export function extractExternalCashflowsViaAccountingIdentity(
  transactions: Transaction[],
  securities: Map<string, Security>,
  startDate?: string,
  endDate?: string
): Cashflow[] {
  // Filter transactions by date range
  const txsInRange = transactions.filter(tx => {
    if (startDate && tx.date < startDate) return false;
    if (endDate && tx.date > endDate) return false;
    return true;
  });

  // Group transactions by month (YYYY-MM)
  const byMonth = new Map<string, Transaction[]>();
  for (const tx of txsInRange) {
    const month = tx.date.substring(0, 7); // YYYY-MM
    const existing = byMonth.get(month) || [];
    existing.push(tx);
    byMonth.set(month, existing);
  }

  const cashflows: Cashflow[] = [];

  // Process each month
  for (const [month, monthTxns] of byMonth) {
    const netExternal = calculateMonthlyNetExternal(monthTxns, securities);

    // Only include if material (> $1)
    if (Math.abs(netExternal) > 1) {
      // Place cashflow at month-end for XIRR calculation
      const monthEndDate = getMonthEndStr(month + '-15'); // Use mid-month to get correct month-end

      cashflows.push({
        date: monthEndDate,
        amount: netExternal,
      });
    }
  }

  // Sort by date
  cashflows.sort((a, b) => a.date.localeCompare(b.date));

  return cashflows;
}

/**
 * Calculate net external cashflow for a month using accounting identity.
 *
 * Net External = Cash Equiv Change + Stock Buys - Stock Sells - Dividends - Interest + Fees
 *
 * This formula calculates the portion of cash equivalent change that cannot
 * be explained by internal portfolio activity (stock trades, dividends, etc.).
 *
 * Plaid amount conventions:
 * - buy: positive amount = cash paid out
 * - sell: negative amount = cash received
 * - dividend: negative amount = cash received
 * - fee: positive amount = cash paid out
 *
 * For XIRR, we want:
 * - Contributions (deposits): NEGATIVE (investor pays in)
 * - Withdrawals: POSITIVE (investor receives)
 */
function calculateMonthlyNetExternal(
  transactions: Transaction[],
  securities: Map<string, Security>
): number {
  let cashEquivChange = 0; // Net change in cash equivalents (sweep + MM)
  let stockBuys = 0; // Cash used for non-cash-equiv buys
  let stockSells = 0; // Cash received from non-cash-equiv sells
  let dividends = 0; // Dividends received
  let interest = 0; // Interest received
  let fees = 0; // Fees paid

  for (const tx of transactions) {
    const security = tx.security_id ? securities.get(tx.security_id) : null;
    const isCashEquiv = security?.is_cash_equivalent ?? false;

    if (tx.type === 'buy') {
      if (isCashEquiv) {
        // Buying into cash equivalent (sweep, MM, etc.)
        // Positive amount = increase in cash equiv balance
        cashEquivChange += tx.amount;
      } else {
        // Buying stock = using cash
        stockBuys += tx.amount;
      }
    } else if (tx.type === 'sell') {
      if (isCashEquiv) {
        // Selling from cash equivalent
        // Negative amount = decrease in cash equiv balance
        cashEquivChange += tx.amount;
      } else {
        // Selling stock = receiving cash
        stockSells += Math.abs(tx.amount);
      }
    } else if (tx.type === 'dividend' || tx.subtype === 'dividend') {
      // Dividend income (typically negative amount = cash received)
      dividends += Math.abs(tx.amount);
    } else if (tx.subtype === 'interest') {
      // Interest income
      interest += Math.abs(tx.amount);
    } else if (tx.type === 'fee') {
      // Fees paid
      fees += tx.amount;
    }
    // NOTE: We intentionally do NOT handle type='cash' transactions here.
    // JPMorgan (and similar institutions) report withdrawals/deposits TWICE:
    // 1. As a cash equivalent sell/buy (MJLXX/sweep)
    // 2. As a CASH withdrawal/deposit transaction
    // The cash equivalent changes already capture the external flow,
    // so counting CASH transactions would double-count.
    else if (tx.type === 'transfer') {
      // In-kind transfers (securities transferred with $0 cash)
      if (tx.security_id && !isCashEquiv && Math.abs(tx.amount) < 0.01) {
        const value = tx.quantity * tx.price;
        if (tx.quantity > 0) {
          stockBuys += value; // Transfer in
        } else {
          stockSells += Math.abs(value); // Transfer out
        }
      }
    }
  }

  // Accounting identity:
  // External flow = Cash change that's not explained by internal activity
  //
  // cashEquivChange = stockSells - stockBuys + dividends + interest - fees + externalFlow
  // Rearranging:
  // externalFlow = cashEquivChange - stockSells + stockBuys - dividends - interest + fees
  //
  // Which simplifies to:
  // netExternal = cashEquivChange + stockBuys - stockSells - dividends - interest + fees

  const netExternal = cashEquivChange + stockBuys - stockSells - dividends - interest + fees;

  // For XIRR convention:
  // - Positive netExternal = deposit (contribution) → should be NEGATIVE for XIRR
  // - Negative netExternal = withdrawal → should be POSITIVE for XIRR
  return -netExternal;
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
