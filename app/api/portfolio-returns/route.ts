/**
 * Calculate portfolio returns for a given allocation
 * POST /api/portfolio-returns
 * 
 * Body: {
 *   allocations: { ticker: weight, ... } e.g., { "SPY": 0.98, "VEA": 0.02 }
 *   startDate: "2023-11-30"
 *   endDate: "2025-11-30"
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    // Get Supabase credentials
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Supabase credentials not configured' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { allocations, startDate, endDate } = body;

    if (!allocations || typeof allocations !== 'object') {
      return NextResponse.json(
        { error: 'allocations object is required' },
        { status: 400 }
      );
    }

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'startDate and endDate are required (YYYY-MM-DD format)' },
        { status: 400 }
      );
    }

    // Validate allocations sum to 1.0 (or close)
    const totalWeight = Object.values(allocations).reduce((sum: number, w: any) => sum + Number(w), 0);
    if (Math.abs(totalWeight - 1.0) > 0.01) {
      return NextResponse.json(
        { error: `Allocations must sum to 1.0 (got ${totalWeight})` },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const tickers = Object.keys(allocations);

    // Fetch data for all tickers
    const { data, error } = await supabase
      .from('asset_returns')
      .select('asset_ticker, return_date, monthly_return, price')
      .in('asset_ticker', tickers)
      .gte('return_date', startDate)
      .lte('return_date', endDate)
      .order('return_date', { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: 'Database query failed', details: error.message },
        { status: 500 }
      );
    }

    if (!data || data.length === 0) {
      return NextResponse.json({
        found: false,
        message: 'No data found for the specified tickers and date range',
        tickers,
        dateRange: { start: startDate, end: endDate },
      });
    }

    // Organize data by ticker and date
    const dataByTicker = new Map<string, Map<string, any>>();
    for (const ticker of tickers) {
      dataByTicker.set(ticker, new Map());
    }

    for (const row of data) {
      const ticker = row.asset_ticker;
      const date = row.return_date;
      if (dataByTicker.has(ticker)) {
        dataByTicker.get(ticker)!.set(date, row);
      }
    }

    // Get all unique dates
    const allDates = new Set<string>();
    for (const tickerMap of dataByTicker.values()) {
      for (const date of tickerMap.keys()) {
        allDates.add(date);
      }
    }
    const sortedDates = Array.from(allDates).sort();

    // Calculate portfolio returns for each month
    const monthlyReturns: any[] = [];
    let cumulativeValue = 1.0;
    const cumulativeValues = [1.0];

    for (const date of sortedDates) {
      if (date < startDate || date > endDate) continue;

      let portfolioReturn = 0;
      let hasAllData = true;
      const assetReturns: any = {};

      // Calculate weighted return
      for (const ticker of tickers) {
        const tickerData = dataByTicker.get(ticker);
        const row = tickerData?.get(date);
        
        if (!row) {
          hasAllData = false;
          break;
        }

        const monthlyReturn = row.monthly_return || 0;
        const weight = allocations[ticker];
        portfolioReturn += weight * monthlyReturn;
        assetReturns[ticker] = {
          return: monthlyReturn,
          price: row.price,
        };
      }

      if (!hasAllData) {
        continue; // Skip months where we don't have all asset data
      }

      // Update cumulative value
      cumulativeValue *= (1 + portfolioReturn);
      cumulativeValues.push(cumulativeValue);

      monthlyReturns.push({
        date,
        portfolioReturn,
        cumulativeValue,
        assetReturns,
      });
    }

    // Calculate statistics
    const totalReturn = cumulativeValue - 1;
    const months = monthlyReturns.length;
    const years = months / 12;
    const annualizedReturn = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;
    
    const avgMonthlyReturn = monthlyReturns.reduce((sum, r) => sum + r.portfolioReturn, 0) / months;
    
    // Calculate volatility
    const variance = monthlyReturns.reduce((sum, r) => {
      const diff = r.portfolioReturn - avgMonthlyReturn;
      return sum + (diff * diff);
    }, 0) / months;
    const volatility = Math.sqrt(variance) * Math.sqrt(12); // Annualized

    // Calculate individual asset stats
    const individualStats: any = {};
    for (const ticker of tickers) {
      const tickerData = Array.from(dataByTicker.get(ticker)?.values() || []);
      const tickerTotalReturn = tickerData.reduce((acc, r) => acc * (1 + (r.monthly_return || 0)), 1) - 1;
      const tickerAnnualized = years > 0 ? Math.pow(1 + tickerTotalReturn, 1 / years) - 1 : 0;
      
      individualStats[ticker] = {
        totalReturn: tickerTotalReturn,
        annualizedReturn: tickerAnnualized,
        weight: allocations[ticker],
      };
    }

    return NextResponse.json({
      success: true,
      portfolio: {
        allocations,
        period: {
          start: startDate,
          end: endDate,
          months,
        },
        returns: {
          total: totalReturn,
          annualized: annualizedReturn,
          averageMonthly: avgMonthlyReturn,
          volatility: volatility,
        },
        cumulativeValue,
        monthlyReturns: monthlyReturns.map(r => ({
          date: r.date,
          portfolioReturn: r.portfolioReturn,
          cumulativeValue: r.cumulativeValue,
          assetReturns: r.assetReturns,
        })),
      },
      individualAssets: individualStats,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Request failed', details: error.message },
      { status: 500 }
    );
  }
}

