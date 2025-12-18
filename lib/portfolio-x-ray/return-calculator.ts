/**
 * Portfolio X-Ray - Return Calculator
 *
 * Calculates portfolio returns and benchmark comparison.
 */

import { Security, Position, Cashflow, BenchmarkResult, BenchmarkMonthlyData } from './types';
import { CASH_BENCHMARK_TICKER } from './config';
import { formatDate, getMonthEnd } from './date-utils';
import { MarketDataProvider } from './market-data';
import { calculateBenchmarkWeights, getBenchmarkTickers } from './benchmark-matcher';
import { calculateIRR, calculateSimpleReturn, annualizeReturn } from './irr-calculator';
import { aggregateCashflowsByMonth } from './cashflow-analyzer';

/**
 * Calculate benchmark portfolio performance.
 *
 * The benchmark tracks securities and cash separately:
 * - Securities portion grows at weighted benchmark rates (SPY, VEA, AGG, etc.)
 * - Cash portion grows at SGOV rate (short-term treasury ETF)
 * - Negative cash (margin) costs the SGOV rate
 *
 * @param startValue Total starting portfolio value
 * @param startPositions Starting positions (for benchmark weight calculation)
 * @param startCash Starting cash
 * @param cashflows External cashflows during period
 * @param securities Security metadata
 * @param monthEnds Array of month-end dates
 * @param marketData Market data provider
 * @param startDate Start date string
 * @param endDate End date string
 */
export async function calculateBenchmark(
  startValue: number,
  startPositions: Map<string, Position>,
  startCash: number,
  cashflows: Cashflow[],
  securities: Map<string, Security>,
  monthEnds: Date[],
  marketData: MarketDataProvider,
  startDate: string,
  endDate: string
): Promise<BenchmarkResult> {
  try {
    // Calculate dollar-weighted benchmark allocation from securities
    const benchmarkWeights = calculateBenchmarkWeights(startPositions, securities);

    // Calculate total securities value
    let totalSecuritiesValue = 0;
    for (const pos of startPositions.values()) {
      totalSecuritiesValue += pos.value;
    }

    // Get benchmark returns (include cash benchmark)
    const benchmarkTickers = getBenchmarkTickers(benchmarkWeights);
    if (!benchmarkTickers.includes(CASH_BENCHMARK_TICKER)) {
      benchmarkTickers.push(CASH_BENCHMARK_TICKER);
    }

    const returns = await marketData.getMonthlyReturns(benchmarkTickers, startDate, endDate);

    // Aggregate cashflows by month
    const cashflowsByMonth = aggregateCashflowsByMonth(cashflows);

    // Track securities and cash separately
    let securitiesValue = totalSecuritiesValue;
    let cashValue = startCash;

    // Build benchmark evolution
    const monthlyData: BenchmarkMonthlyData[] = [];

    for (let i = 0; i < monthEnds.length; i++) {
      const monthEnd = monthEnds[i];
      const monthEndStr = formatDate(monthEnd);

      // First month: record starting value without applying returns
      if (i === 0) {
        monthlyData.push({
          month: monthEndStr,
          return: 0,
          value: securitiesValue + cashValue,
          cashflow: 0,
        });
        continue;
      }

      // Apply securities return (weighted benchmark)
      let securitiesReturn = 0;
      for (const [ticker, weight] of benchmarkWeights) {
        const tickerReturns = returns.get(ticker);
        const monthReturn = tickerReturns?.get(monthEndStr) || 0;
        // Weight is percentage (0-100), convert to decimal
        securitiesReturn += (weight / 100) * monthReturn;
      }
      securitiesValue *= (1 + securitiesReturn);

      // Apply cash return (SGOV rate)
      const cashReturn = returns.get(CASH_BENCHMARK_TICKER)?.get(monthEndStr) || 0;
      cashValue *= (1 + cashReturn);

      // Apply cashflows to cash portion
      // Cashflows: negative = contribution (adds to cash), positive = withdrawal (reduces cash)
      const cashflow = cashflowsByMonth.get(monthEndStr) || 0;
      cashValue -= cashflow;

      // Calculate combined return for reporting
      const prevTotal = monthlyData[i - 1].value;
      const currentTotal = securitiesValue + cashValue;
      const combinedReturn = prevTotal !== 0
        ? ((currentTotal - prevTotal + cashflow) / prevTotal)
        : 0;

      monthlyData.push({
        month: monthEndStr,
        return: combinedReturn * 100, // Convert to percentage
        value: currentTotal,
        cashflow,
      });
    }

    // Calculate final values
    const benchmarkEndValue = securitiesValue + cashValue;
    const totalReturn = calculateSimpleReturn(startValue, benchmarkEndValue);
    const years = monthEnds.length / 12;
    const benchmarkReturn = annualizeReturn(totalReturn, years);

    // Calculate benchmark IRR
    const benchmarkIrr = calculateIRR(startValue, benchmarkEndValue, cashflows, startDate, endDate);

    return {
      return: benchmarkReturn,
      irr: benchmarkIrr,
      weights: benchmarkWeights,
      monthlyData,
      endValue: benchmarkEndValue,
    };
  } catch (error) {
    console.error('[ReturnCalculator] Benchmark calculation failed:', error);
    return {
      return: 0,
      irr: null,
      weights: new Map(),
      monthlyData: [],
      endValue: 0,
    };
  }
}

/**
 * Calculate portfolio returns.
 *
 * @param startValue Starting portfolio value
 * @param endValue Ending portfolio value
 * @param cashflows External cashflows
 * @param startDate Start date string
 * @param endDate End date string
 * @param months Number of months in period
 */
export function calculatePortfolioReturns(
  startValue: number,
  endValue: number,
  cashflows: Cashflow[],
  startDate: string,
  endDate: string,
  months: number
): {
  totalReturn: number;
  annualizedReturn: number;
  irr: number | null;
} {
  const totalReturn = calculateSimpleReturn(startValue, endValue);
  const years = months / 12;
  const annualizedReturn = annualizeReturn(totalReturn, years);
  const irr = calculateIRR(startValue, endValue, cashflows, startDate, endDate);

  return { totalReturn, annualizedReturn, irr };
}
