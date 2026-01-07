/**
 * Script to fetch historical returns from Supabase and generate the
 * HISTORICAL_RETURNS data for the retirement simulator.
 *
 * Run with: npx tsx scripts/generate-historical-returns.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rhysciwzmjleziieeugv.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_qPjYHTX5b_4w0K-ywVytVw_g61YRjVp';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fetchReturns(ticker: string, startDate: string, endDate: string): Promise<Map<string, number>> {
  console.log(`Fetching ${ticker} from ${startDate} to ${endDate}...`);

  // Supabase returns max 1000 rows by default, so we need to paginate
  let allData: any[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('asset_returns')
      .select('return_date, monthly_return')
      .eq('asset_ticker', ticker)
      .gte('return_date', startDate)
      .lte('return_date', endDate)
      .order('return_date')
      .range(offset, offset + limit - 1);

    if (error) {
      console.error(`Error fetching ${ticker}:`, error);
      break;
    }

    if (!data || data.length === 0) {
      break;
    }

    allData = allData.concat(data);
    console.log(`  Fetched ${data.length} rows (total: ${allData.length})`);

    if (data.length < limit) {
      break;
    }

    offset += limit;
  }

  const returns = new Map<string, number>();
  for (const row of allData) {
    // Convert date from YYYY-MM-DD to YYYY-MM
    const dateKey = row.return_date.substring(0, 7);
    returns.set(dateKey, parseFloat(row.monthly_return));
  }

  // Show first and last date
  const dates = Array.from(returns.keys()).sort();
  if (dates.length > 0) {
    console.log(`  Date range: ${dates[0]} to ${dates[dates.length - 1]}`);
  }
  console.log(`  Found ${returns.size} months of data`);
  return returns;
}

async function main() {
  console.log('Fetching historical returns from Supabase...\n');

  // Fetch S&P 500 Total Return (1927-01 to 2025-12)
  const stockReturns = await fetchReturns('^SP500TR', '1927-01-01', '2025-12-31');

  // Fetch LONG_BOND (1928-01 to 2004-12)
  const longBondReturns = await fetchReturns('LONG_BOND', '1928-01-01', '2004-12-31');

  // Fetch AGG (2005-01 to 2025-12) for bond data after 2004
  const aggReturns = await fetchReturns('AGG', '2005-01-01', '2025-12-31');

  // Fetch CPI inflation data (1913-01 to 2025-09)
  const cpiReturns = await fetchReturns('CPI', '1913-01-01', '2025-12-31');

  // Combine bond data: use LONG_BOND through 2004, AGG from 2005+
  const bondReturns = new Map<string, number>();
  for (const [date, ret] of longBondReturns) {
    bondReturns.set(date, ret);
  }
  for (const [date, ret] of aggReturns) {
    bondReturns.set(date, ret);
  }

  console.log(`\nTotal stock months: ${stockReturns.size}`);
  console.log(`Total bond months: ${bondReturns.size}`);
  console.log(`Total CPI months: ${cpiReturns.size}`);

  // Generate the historical returns object
  // Include stock, bond, and CPI (inflation) data
  const historicalReturns: Record<string, { stock: number; bond: number; cpi?: number }> = {};

  // Get all dates from stock returns, sorted
  const allDates = Array.from(stockReturns.keys()).sort();

  let matched = 0;
  let withCpi = 0;
  for (const date of allDates) {
    const stockRet = stockReturns.get(date);
    const bondRet = bondReturns.get(date);
    const cpiRet = cpiReturns.get(date);

    if (stockRet !== undefined && bondRet !== undefined) {
      historicalReturns[date] = {
        stock: stockRet,
        bond: bondRet
      };
      // Add CPI if available
      if (cpiRet !== undefined) {
        historicalReturns[date].cpi = cpiRet;
        withCpi++;
      }
      matched++;
    }
  }

  console.log(`\nMatched months (both stock and bond): ${matched}`);
  console.log(`Months with CPI data: ${withCpi}`);

  // Get date range
  const dates = Object.keys(historicalReturns).sort();
  console.log(`Date range: ${dates[0]} to ${dates[dates.length - 1]}`);

  // Generate TypeScript code
  const tsCode = `// Historical Returns Data
// Generated from Supabase on ${new Date().toISOString().split('T')[0]}
// Stock: ^SP500TR (S&P 500 Total Return)
// Bond: LONG_BOND (through 2004) + AGG (2005+)
// CPI: Monthly inflation rate

export const HISTORICAL_RETURNS: Record<string, { stock: number; bond: number; cpi?: number }> = ${JSON.stringify(historicalReturns, null, 2)};
`;

  // Write to file (use absolute path based on script location)
  const scriptDir = __dirname || '.';
  const outputPath = `${scriptDir}/../app/api/retirement/historical-returns-data.ts`;
  fs.writeFileSync(outputPath, tsCode);
  console.log(`\nWritten to ${outputPath}`);

  // Also output some stats for the 6 scenarios
  const scenarios = ['1929-10', '1966-01', '1973-01', '2000-03', '2007-10', '2022-01'];
  console.log('\nScenario data availability:');
  for (const scenario of scenarios) {
    const hasData = historicalReturns[scenario];
    console.log(`  ${scenario}: ${hasData ? 'Available' : 'MISSING'}`);
  }
}

main().catch(console.error);
