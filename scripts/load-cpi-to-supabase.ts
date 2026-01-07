/**
 * Script to load CPI data from Long_Run_Securities_Combined.csv into Supabase
 *
 * Run with: npx tsx scripts/load-cpi-to-supabase.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rhysciwzmjleziieeugv.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_qPjYHTX5b_4w0K-ywVytVw_g61YRjVp';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Convert M/D/YYYY to YYYY-MM-DD
function convertDate(dateStr: string): string {
  const parts = dateStr.split('/');
  const month = parts[0].padStart(2, '0');
  const day = parts[1].padStart(2, '0');
  const year = parts[2];
  return `${year}-${month}-${day}`;
}

async function main() {
  console.log('Loading CPI data into Supabase...\n');

  // Read the CSV file
  const csvPath = 'C:\\code\\portfolio-data\\Long_Run_Securities_Combined.csv';
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n');

  // Parse CPI rows
  const cpiRows: { asset_ticker: string; return_date: string; monthly_return: number; broad_category: string }[] = [];

  for (const line of lines) {
    if (line.startsWith('CPI,')) {
      const parts = line.split(',');
      const dateStr = parts[1];
      const returnVal = parseFloat(parts[2]);
      const category = parts[3]?.trim() || 'INFLATION';

      cpiRows.push({
        asset_ticker: 'CPI',
        return_date: convertDate(dateStr),
        monthly_return: returnVal,
        broad_category: category
      });
    }
  }

  console.log(`Found ${cpiRows.length} CPI rows to load`);
  console.log(`Date range: ${cpiRows[0].return_date} to ${cpiRows[cpiRows.length - 1].return_date}`);

  // Check if CPI data already exists
  const { data: existing, error: checkError } = await supabase
    .from('asset_returns')
    .select('id')
    .eq('asset_ticker', 'CPI')
    .limit(1);

  if (existing && existing.length > 0) {
    console.log('\nCPI data already exists in Supabase. Deleting existing data first...');
    const { error: deleteError } = await supabase
      .from('asset_returns')
      .delete()
      .eq('asset_ticker', 'CPI');

    if (deleteError) {
      console.error('Error deleting existing CPI data:', deleteError);
      return;
    }
    console.log('Existing CPI data deleted.');
  }

  // Insert in batches (Supabase has limits on batch size)
  const batchSize = 500;
  let inserted = 0;

  for (let i = 0; i < cpiRows.length; i += batchSize) {
    const batch = cpiRows.slice(i, i + batchSize);

    const { error } = await supabase
      .from('asset_returns')
      .insert(batch);

    if (error) {
      console.error(`Error inserting batch at index ${i}:`, error);
      return;
    }

    inserted += batch.length;
    console.log(`Inserted ${inserted}/${cpiRows.length} rows...`);
  }

  console.log(`\nSuccessfully loaded ${inserted} CPI rows into Supabase!`);

  // Verify
  const { data: verify, error: verifyError } = await supabase
    .from('asset_returns')
    .select('return_date, monthly_return')
    .eq('asset_ticker', 'CPI')
    .order('return_date')
    .limit(5);

  if (verify) {
    console.log('\nVerification (first 5 rows):');
    verify.forEach(row => console.log(`  ${row.return_date}: ${(row.monthly_return * 100).toFixed(4)}%`));
  }

  const { count } = await supabase
    .from('asset_returns')
    .select('*', { count: 'exact', head: true })
    .eq('asset_ticker', 'CPI');

  console.log(`\nTotal CPI rows in Supabase: ${count}`);
}

main().catch(console.error);
