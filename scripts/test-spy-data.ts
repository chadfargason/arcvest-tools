/**
 * Quick test script to fetch SPY data from Supabase for past 24 months
 * Run with: npx tsx scripts/test-spy-data.ts
 */

import { createClient } from '@supabase/supabase-js';

async function testSPYData() {
  // Get Supabase credentials from environment
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Supabase credentials not found in environment variables');
    console.log('Make sure SUPABASE_URL and SUPABASE_KEY are set');
    console.log('You can set them in .env.local or as environment variables');
    return;
  }

  console.log('✅ Supabase credentials found');
  console.log(`URL: ${supabaseUrl.substring(0, 30)}...\n`);

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Calculate date range (past 24 months)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 24);

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  console.log(`📅 Date Range: ${startDateStr} to ${endDateStr}`);
  console.log(`🔍 Querying for SPY monthly returns...\n`);

  try {
    // Query Supabase for SPY monthly returns
    const { data, error } = await supabase
      .from('asset_returns')
      .select('asset_ticker, return_date, monthly_return, price')
      .eq('asset_ticker', 'SPY')
      .gte('return_date', startDateStr)
      .lte('return_date', endDateStr)
      .order('return_date', { ascending: true });

    if (error) {
      console.error('❌ Supabase query error:', error);
      return;
    }

    if (!data || data.length === 0) {
      console.log('⚠️  No data found for SPY in the specified date range');
      console.log('   Checking if SPY exists in database...');
      
      // Check if SPY exists at all
      const { data: checkData } = await supabase
        .from('asset_returns')
        .select('asset_ticker, return_date')
        .eq('asset_ticker', 'SPY')
        .limit(5)
        .order('return_date', { ascending: false });
      
      if (checkData && checkData.length > 0) {
        console.log(`   Found SPY data, but not in date range ${startDateStr} to ${endDateStr}`);
        console.log(`   Most recent dates found:`, checkData.map(d => d.return_date));
      } else {
        console.log('   SPY not found in database at all');
      }
      return;
    }

    console.log(`✅ Found ${data.length} data points for SPY\n`);

    // Display the data
    console.log('📊 SPY Monthly Returns (Past 24 Months):');
    console.log('─'.repeat(80));
    console.log('Date       | Monthly Return | Price');
    console.log('─'.repeat(80));

    data.forEach((row) => {
      const date = row.return_date;
      const returnPct = ((row.monthly_return || 0) * 100).toFixed(2);
      const price = row.price ? row.price.toFixed(2) : 'N/A';
      console.log(`${date} | ${returnPct.padStart(12)}% | ${price}`);
    });

    console.log('─'.repeat(80));
    console.log(`\n📈 Summary:`);
    console.log(`   Total data points: ${data.length}`);
    console.log(`   Expected: 24 (one per month)`);
    console.log(`   Coverage: ${((data.length / 24) * 100).toFixed(1)}%`);

    // Calculate some stats
    const returns = data.map(r => r.monthly_return || 0);
    const totalReturn = returns.reduce((acc, r) => acc * (1 + r), 1) - 1;
    const avgReturn = returns.reduce((acc, r) => acc + r, 0) / returns.length;
    
    console.log(`\n📊 Statistics:`);
    console.log(`   Average monthly return: ${(avgReturn * 100).toFixed(2)}%`);
    console.log(`   Total return (${data.length} months): ${(totalReturn * 100).toFixed(2)}%`);
    console.log(`   Annualized return: ${((Math.pow(1 + totalReturn, 12 / data.length) - 1) * 100).toFixed(2)}%`);

    // Check for missing months
    if (data.length < 24) {
      console.log(`\n⚠️  Missing months detected:`);
      const dates = data.map(r => r.return_date);
      const expectedMonths = [];
      const current = new Date(startDate);
      while (current <= endDate) {
        const monthStr = current.toISOString().substring(0, 7); // YYYY-MM
        expectedMonths.push(monthStr);
        current.setMonth(current.getMonth() + 1);
      }
      
      const foundMonths = new Set(dates.map(d => d.substring(0, 7)));
      const missingMonths = expectedMonths.filter(m => !foundMonths.has(m));
      
      if (missingMonths.length > 0) {
        console.log(`   Missing: ${missingMonths.join(', ')}`);
      }
    }

    // Export to CSV
    const csvLines = [
      'Date,Monthly Return,Price',
      ...data.map(r => `${r.return_date},${r.monthly_return || 0},${r.price || ''}`)
    ];
    
    const csvPath = path.join(__dirname, '../Portfolio_x_ray/spy_24months.csv');
    fs.writeFileSync(csvPath, csvLines.join('\n'));
    console.log(`\n💾 Exported to: ${csvPath}`);

  } catch (err) {
    console.error('❌ Error:', err);
  }
}

// Import fs and path for CSV export
import * as fs from 'fs';
import * as path from 'path';

testSPYData().catch(console.error);

