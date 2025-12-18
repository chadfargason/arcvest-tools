/**
 * Portfolio X-Ray - IRR Calculator
 *
 * Implements XIRR (Extended Internal Rate of Return) calculation
 * with Modified Dietz as fallback.
 */

import { Cashflow } from './types';
import { parseDate, yearsBetween } from './date-utils';

/**
 * Calculate XNPV (Extended Net Present Value).
 *
 * @param rate Annual discount rate (decimal, e.g., 0.10 for 10%)
 * @param cashflows Array of [date, amount] tuples
 * @returns Net present value
 */
export function xnpv(rate: number, cashflows: Array<[Date, number]>): number {
  if (rate <= -1) {
    return Infinity;
  }

  if (cashflows.length === 0) {
    return 0;
  }

  const t0 = cashflows[0][0].getTime();
  let total = 0;

  for (const [date, amount] of cashflows) {
    const years = (date.getTime() - t0) / (365.25 * 24 * 60 * 60 * 1000);
    total += amount / Math.pow(1 + rate, years);
  }

  return total;
}

/**
 * Calculate XIRR (Extended Internal Rate of Return) using bisection method.
 *
 * @param cashflows Array of [date, amount] tuples (must have at least one positive and one negative)
 * @returns Annual IRR as decimal (0.10 = 10%)
 * @throws Error if IRR cannot be calculated
 */
export function xirr(cashflows: Array<[Date, number]>): number {
  if (cashflows.length < 2) {
    throw new Error('XIRR requires at least 2 cashflows');
  }

  // Sort by date
  const sorted = [...cashflows].sort((a, b) => a[0].getTime() - b[0].getTime());

  // Verify we have both positive and negative cashflows
  const hasPositive = sorted.some(([, cf]) => cf > 0);
  const hasNegative = sorted.some(([, cf]) => cf < 0);

  if (!hasPositive || !hasNegative) {
    throw new Error('XIRR requires at least one positive and one negative cashflow');
  }

  // Bisection method
  let lo = -0.9999;
  let hi = 10.0;
  let fLo = xnpv(lo, sorted);
  let fHi = xnpv(hi, sorted);

  // Expand hi if needed to find bracket
  while (fLo * fHi > 0 && hi < 1e6) {
    hi *= 2;
    fHi = xnpv(hi, sorted);
  }

  if (fLo * fHi > 0) {
    throw new Error('Could not bracket IRR root');
  }

  // Bisection iterations
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = xnpv(mid, sorted);

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

  return (lo + hi) / 2;
}

/**
 * Calculate Modified Dietz return (fallback when XIRR fails).
 *
 * @param startValue Portfolio value at start
 * @param endValue Portfolio value at end
 * @param cashflows External cashflows during period
 * @param startDate Start date
 * @param endDate End date
 * @returns Period return as decimal
 */
export function modifiedDietz(
  startValue: number,
  endValue: number,
  cashflows: Cashflow[],
  startDate: Date,
  endDate: Date
): number {
  const totalDays = (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000);

  if (totalDays <= 0) {
    throw new Error('Invalid period for Modified Dietz');
  }

  let weightedFlows = 0;
  let totalFlows = 0;

  for (const cf of cashflows) {
    const cfDate = parseDate(cf.date);
    const daysFromStart = (cfDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000);
    const weight = (totalDays - daysFromStart) / totalDays;

    weightedFlows += cf.amount * weight;
    totalFlows += cf.amount;
  }

  const denominator = startValue + weightedFlows;

  if (Math.abs(denominator) < 1e-12) {
    throw new Error('Modified Dietz denominator near zero');
  }

  return (endValue - startValue - totalFlows) / denominator;
}

/**
 * Calculate IRR for a portfolio.
 *
 * @param startValue Starting portfolio value
 * @param endValue Ending portfolio value
 * @param cashflows External cashflows during period
 * @param startDate Start date string (YYYY-MM-DD)
 * @param endDate End date string (YYYY-MM-DD)
 * @returns IRR as percentage (10.5 = 10.5%), or null if calculation fails
 */
export function calculateIRR(
  startValue: number,
  endValue: number,
  cashflows: Cashflow[],
  startDate: string,
  endDate: string
): number | null {
  try {
    // Build cashflow array for XIRR
    // Start: negative (investment into portfolio)
    // External flows: as-is (negative = contribution, positive = withdrawal)
    // End: positive (value received)
    const cfs: Array<[Date, number]> = [];

    cfs.push([parseDate(startDate), -startValue]);

    for (const cf of cashflows) {
      cfs.push([parseDate(cf.date), cf.amount]);
    }

    cfs.push([parseDate(endDate), endValue]);

    const irr = xirr(cfs);
    return irr * 100; // Convert to percentage
  } catch (error) {
    // Try Modified Dietz as fallback
    try {
      const dietz = modifiedDietz(
        startValue,
        endValue,
        cashflows,
        parseDate(startDate),
        parseDate(endDate)
      );

      // Annualize the Dietz return
      const years = yearsBetween(parseDate(startDate), parseDate(endDate));
      const annualized = Math.pow(1 + dietz, 1 / years) - 1;

      return annualized * 100;
    } catch {
      return null;
    }
  }
}

/**
 * Calculate simple return (no cashflows).
 */
export function calculateSimpleReturn(startValue: number, endValue: number): number {
  if (startValue === 0) return 0;
  return ((endValue - startValue) / startValue) * 100;
}

/**
 * Annualize a return.
 *
 * @param totalReturn Total return as percentage (10.5 = 10.5%)
 * @param years Number of years
 * @returns Annualized return as percentage
 */
export function annualizeReturn(totalReturn: number, years: number): number {
  if (years <= 0) return 0;
  return (Math.pow(1 + totalReturn / 100, 1 / years) - 1) * 100;
}
