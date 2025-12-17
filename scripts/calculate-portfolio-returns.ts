/**
 * Calculate portfolio returns for 98% SPY / 2% VEA
 * From month-end 2023-11-30 to month-end 2025-11-30 (25 months)
 * 
 * Run with: npx tsx scripts/calculate-portfolio-returns.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Load .env.local if it exists
const envPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        process.env[key.trim()] = value;
      }
    }
  }
}

async function calculatePortfolioReturns() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Supabase credentials not found');
    console.log('Make sure SUPABASE_URL and SUPABASE_KEY are set in .env.local');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const allocations = { SPY: 0.98, VEA: 0.02 };
  const startDate = '2023-11-30';
  const endDate = '2025-11-30';
  const tickers = Object.keys(allocations);

  console.log('📊 Portfolio: 98% SPY / 2% VEA');
  console.log(`📅 Period: ${startDate} to ${endDate} (25 months)\n`);

  try {
    // Fetch data for all tickers
    const { data, error } = await supabase
      .from('asset_returns')
      .select('asset_ticker, return_date, monthly_return')
      .in('asset_ticker', tickers)
      .gte('return_date', startDate)
      .lte('return_date', endDate)
      .order('return_date', { ascending: true });

    if (error) {
      console.error('❌ Database query error:', error);
      return;
    }

    if (!data || data.length === 0) {
      console.log('⚠️  No data found for the specified tickers and date range');
      return;
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

    console.log('Month-End Date  | SPY Return | VEA Return | Portfolio Return | Cumulative Value');
    console.log('─'.repeat(85));

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
        const weight = allocations[ticker as keyof typeof allocations];
        portfolioReturn += weight * monthlyReturn;
        assetReturns[ticker] = {
          return: monthlyReturn,
        };
      }

      if (!hasAllData) {
        continue;
      }

      // Update cumulative value
      cumulativeValue *= (1 + portfolioReturn);

      monthlyReturns.push({
        date,
        portfolioReturn,
        cumulativeValue,
        assetReturns,
      });

      const spyReturn = assetReturns.SPY?.return || 0;
      const veaReturn = assetReturns.VEA?.return || 0;
      const spyPct = (spyReturn * 100).toFixed(2).padStart(8);
      const veaPct = (veaReturn * 100).toFixed(2).padStart(8);
      const portPct = (portfolioReturn * 100).toFixed(2).padStart(10);
      const cumVal = cumulativeValue.toFixed(4).padStart(12);
      
      console.log(`${date} | ${spyPct}% | ${veaPct}% | ${portPct}% | $${cumVal}`);
    }

    console.log('─'.repeat(85));

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
    const volatility = Math.sqrt(variance) * Math.sqrt(12);

    console.log(`\n📈 Portfolio Statistics:`);
    console.log(`   Total Months: ${months}`);
    console.log(`   Total Return: ${(totalReturn * 100).toFixed(2)}%`);
    console.log(`   Annualized Return: ${(annualizedReturn * 100).toFixed(2)}%`);
    console.log(`   Average Monthly Return: ${(avgMonthlyReturn * 100).toFixed(2)}%`);
    console.log(`   Annualized Volatility: ${(volatility * 100).toFixed(2)}%`);
    console.log(`   Final Value (from $1): $${cumulativeValue.toFixed(4)}`);

    // Calculate individual asset stats
    console.log(`\n📊 Individual Asset Returns:`);
    for (const ticker of tickers) {
      const tickerData = Array.from(dataByTicker.get(ticker)?.values() || []);
      const tickerTotalReturn = tickerData.reduce((acc, r) => acc * (1 + (r.monthly_return || 0)), 1) - 1;
      const tickerAnnualized = years > 0 ? Math.pow(1 + tickerTotalReturn, 1 / years) - 1 : 0;
      const weight = allocations[ticker as keyof typeof allocations];
      
      console.log(`   ${ticker} (${(weight * 100).toFixed(0)}%):`);
      console.log(`      Total Return: ${(tickerTotalReturn * 100).toFixed(2)}%`);
      console.log(`      Annualized: ${(tickerAnnualized * 100).toFixed(2)}%`);
    }

    // Export to CSV
    const csvLines = [
      'Date,Portfolio_Return,Cumulative_Value,SPY_Return,VEA_Return',
      ...monthlyReturns.map((r) => {
        const spy = r.assetReturns.SPY || {};
        const vea = r.assetReturns.VEA || {};
        return `${r.date},${r.portfolioReturn},${r.cumulativeValue},${spy.return || ''},${vea.return || ''}`;
      })
    ];
    
    const csvPath = path.join(__dirname, '../../Portfolio_x_ray/portfolio_98spy_2vea_returns.csv');
    fs.writeFileSync(csvPath, csvLines.join('\n'));
    console.log(`\n💾 Exported to: ${csvPath}`);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

calculatePortfolioReturns().catch(console.error);

