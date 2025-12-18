/**
 * Portfolio X-Ray - Market Data Provider
 *
 * Fetches market data (monthly returns) from Supabase.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export class MarketDataProvider {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Fetch monthly returns for tickers between dates.
   *
   * @param tickers Array of ticker symbols to fetch
   * @param startDate Start date (YYYY-MM-DD)
   * @param endDate End date (YYYY-MM-DD)
   * @returns Map<ticker, Map<date, return>> where return is decimal (0.02 = 2%)
   */
  async getMonthlyReturns(
    tickers: string[],
    startDate: string,
    endDate: string
  ): Promise<Map<string, Map<string, number>>> {
    if (tickers.length === 0) {
      return new Map();
    }

    const { data, error } = await this.supabase
      .from('asset_returns')
      .select('asset_ticker, return_date, monthly_return')
      .in('asset_ticker', tickers)
      .gte('return_date', startDate)
      .lte('return_date', endDate)
      .order('return_date');

    if (error) {
      console.error('[MarketData] Error fetching returns:', error);
      return new Map();
    }

    const result = new Map<string, Map<string, number>>();

    if (data) {
      for (const row of data) {
        const ticker = row.asset_ticker;
        const date = row.return_date;
        const returnValue = parseFloat(row.monthly_return);

        if (!result.has(ticker)) {
          result.set(ticker, new Map());
        }
        result.get(ticker)!.set(date, returnValue);
      }
    }

    return result;
  }

  /**
   * Build cumulative price indices from monthly returns.
   *
   * @param returns Map from getMonthlyReturns
   * @param monthEnds Array of month-end date strings
   * @returns Map<ticker, Map<date, cumulativeIndex>> starting at 1.0
   */
  buildPriceIndices(
    returns: Map<string, Map<string, number>>,
    monthEnds: string[]
  ): Map<string, Map<string, number>> {
    const indices = new Map<string, Map<string, number>>();

    for (const [ticker, tickerReturns] of returns) {
      const index = new Map<string, number>();
      let cumulativeIndex = 1.0;

      for (const monthEnd of monthEnds) {
        const monthReturn = tickerReturns.get(monthEnd) || 0;
        cumulativeIndex *= (1 + monthReturn);
        index.set(monthEnd, cumulativeIndex);
      }

      indices.set(ticker, index);
    }

    return indices;
  }

  /**
   * Get a single month's return for a ticker.
   */
  getReturn(
    returns: Map<string, Map<string, number>>,
    ticker: string,
    date: string
  ): number {
    return returns.get(ticker)?.get(date) || 0;
  }

  /**
   * Calculate weighted portfolio return for a month.
   *
   * @param weights Map<ticker, weight> where weights are percentages (0-100)
   * @param returns Map from getMonthlyReturns
   * @param date Month-end date string
   * @returns Weighted return as decimal
   */
  calculateWeightedReturn(
    weights: Map<string, number>,
    returns: Map<string, Map<string, number>>,
    date: string
  ): number {
    let weightedReturn = 0;

    for (const [ticker, weight] of weights) {
      const monthReturn = this.getReturn(returns, ticker, date);
      // Convert weight from percentage (0-100) to decimal (0-1)
      weightedReturn += (weight / 100) * monthReturn;
    }

    return weightedReturn;
  }
}
