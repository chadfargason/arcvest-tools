/**
 * Test endpoint to fetch SPY data from Supabase
 * GET /api/test-spy
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
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

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Calculate date range (past 24 months)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 24);

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // Query Supabase for SPY monthly returns
    const { data, error } = await supabase
      .from('asset_returns')
      .select('asset_ticker, return_date, monthly_return, price')
      .eq('asset_ticker', 'SPY')
      .gte('return_date', startDateStr)
      .lte('return_date', endDateStr)
      .order('return_date', { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: 'Database query failed', details: error.message },
        { status: 500 }
      );
    }

    if (!data || data.length === 0) {
      // Check if SPY exists at all
      const { data: checkData } = await supabase
        .from('asset_returns')
        .select('asset_ticker, return_date')
        .eq('asset_ticker', 'SPY')
        .limit(5)
        .order('return_date', { ascending: false });

      return NextResponse.json({
        found: false,
        dateRange: { start: startDateStr, end: endDateStr },
        message: 'No SPY data found in date range',
        sampleDates: checkData?.map(d => d.return_date) || [],
      });
    }

    // Calculate statistics
    const returns = data.map(r => r.monthly_return || 0);
    const totalReturn = returns.reduce((acc, r) => acc * (1 + r), 1) - 1;
    const avgReturn = returns.reduce((acc, r) => acc + r, 0) / returns.length;
    const years = data.length / 12;
    const annualizedReturn = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;

    return NextResponse.json({
      found: true,
      count: data.length,
      expected: 24,
      coverage: ((data.length / 24) * 100).toFixed(1) + '%',
      dateRange: {
        start: startDateStr,
        end: endDateStr,
        queryStart: data[0]?.return_date,
        queryEnd: data[data.length - 1]?.return_date,
      },
      statistics: {
        averageMonthlyReturn: (avgReturn * 100).toFixed(2) + '%',
        totalReturn: (totalReturn * 100).toFixed(2) + '%',
        annualizedReturn: (annualizedReturn * 100).toFixed(2) + '%',
      },
      data: data.map(row => ({
        date: row.return_date,
        monthlyReturn: ((row.monthly_return || 0) * 100).toFixed(2) + '%',
        price: row.price || null,
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Request failed', details: error.message },
      { status: 500 }
    );
  }
}

