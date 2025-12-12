import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getBenchmarkForPlaidSecurity } from '@/lib/portfolio-x-ray/benchmark-matcher';
import { calculateFees } from '@/lib/portfolio-x-ray/fee-calculator';
import { calculateGeometricReturn, annualizeReturn } from '@/lib/portfolio-x-ray/returns-calculator';

interface MonthlyAnalysis {
  month: string; // YYYY-MM
  portfolioReturn: number;
  portfolioValue: number;
  benchmarkReturn: number;
  benchmarkValue: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { transactions, holdings, securities } = body;

    if (!transactions || !holdings || !securities) {
      return NextResponse.json(
        { error: 'Missing required data: transactions, holdings, securities' },
        { status: 400 }
      );
    }

    // Validate Supabase config
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
      return NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 500 }
      );
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );

    // Calculate fees
    const feeSummary = calculateFees(transactions.investment_transactions || []);

    // Extract date range from transactions
    const transactionDates = (transactions.investment_transactions || [])
      .map((tx: any) => tx.date)
      .filter(Boolean);
    
    if (transactionDates.length === 0) {
      return NextResponse.json(
        { error: 'No transaction dates found' },
        { status: 400 }
      );
    }

    const sortedDates = transactionDates.sort();
    const startDate = sortedDates[0];
    const endDate = sortedDates[sortedDates.length - 1];
    
    // Calculate date range for 24 months
    const endDateObj = new Date(endDate);
    const startDateObj = new Date(endDateObj);
    startDateObj.setMonth(startDateObj.getMonth() - 24);
    
    const analysisStartDate = startDateObj.toISOString().split('T')[0];
    const analysisEndDate = endDateObj.toISOString().split('T')[0];

    // Get current portfolio allocation from holdings
    const portfolioAllocation = calculatePortfolioAllocation(
      holdings.holdings || [],
      securities.securities || []
    );

    // Match holdings to benchmarks
    const benchmarkMap = new Map<string, string>();
    for (const holding of holdings.holdings || []) {
      const security = (securities.securities || []).find(
        (s: any) => s.security_id === holding.security_id
      );
      if (security) {
        const benchmark = getBenchmarkForPlaidSecurity(security);
        benchmarkMap.set(security.security_id, benchmark);
      }
    }

    // Get unique benchmarks needed
    const uniqueBenchmarks = Array.from(new Set(benchmarkMap.values()));

    // Fetch benchmark returns from Supabase
    const { data: benchmarkReturns, error: benchmarkError } = await supabase
      .from('asset_returns')
      .select('asset_ticker, return_date, monthly_return')
      .in('asset_ticker', uniqueBenchmarks)
      .gte('return_date', analysisStartDate)
      .lte('return_date', analysisEndDate)
      .order('return_date');

    if (benchmarkError) {
      console.error('Supabase benchmark fetch error:', benchmarkError);
      // Continue with analysis even if some benchmarks missing
    }

    // Calculate monthly returns
    const monthlyAnalysis = calculateMonthlyReturns(
      transactions.investment_transactions || [],
      holdings.holdings || [],
      securities.securities || [],
      portfolioAllocation,
      benchmarkMap,
      benchmarkReturns || [],
      analysisStartDate,
      analysisEndDate
    );

    console.log('Monthly analysis calculated:', {
      months: monthlyAnalysis.length,
      hasBenchmarkData: benchmarkReturns?.length > 0,
      uniqueBenchmarks: uniqueBenchmarks,
    });

    // Handle case where no monthly analysis was generated
    if (monthlyAnalysis.length === 0) {
      console.warn('No monthly analysis generated - using default values');
      return NextResponse.json({
        monthlyAnalysis: [],
        summary: {
          portfolioTotalReturn: 0,
          portfolioAnnualizedReturn: 0,
          benchmarkTotalReturn: 0,
          benchmarkAnnualizedReturn: 0,
          outperformance: 0,
          periodMonths: 0,
          startDate: analysisStartDate,
          endDate: analysisEndDate,
          note: 'Insufficient data for performance analysis',
        },
        fees: feeSummary,
        portfolioAllocation: Object.fromEntries(portfolioAllocation),
        holdings: holdings.holdings?.length || 0,
        transactions: transactions.investment_transactions?.length || 0,
      });
    }

    // Calculate summary statistics
    const portfolioMonthlyReturns = monthlyAnalysis.map(m => m.portfolioReturn);
    const benchmarkMonthlyReturns = monthlyAnalysis.map(m => m.benchmarkReturn);

    const portfolioTotalReturn = calculateGeometricReturn(portfolioMonthlyReturns);
    const benchmarkTotalReturn = calculateGeometricReturn(benchmarkMonthlyReturns);

    const portfolioAnnualized = annualizeReturn(portfolioTotalReturn, monthlyAnalysis.length);
    const benchmarkAnnualized = annualizeReturn(benchmarkTotalReturn, monthlyAnalysis.length);

    const outperformance = portfolioAnnualized - benchmarkAnnualized;

    return NextResponse.json({
      monthlyAnalysis,
      summary: {
        portfolioTotalReturn: portfolioTotalReturn * 100, // Convert to percentage
        portfolioAnnualizedReturn: portfolioAnnualized * 100,
        benchmarkTotalReturn: benchmarkTotalReturn * 100,
        benchmarkAnnualizedReturn: benchmarkAnnualized * 100,
        outperformance: outperformance * 100,
        periodMonths: monthlyAnalysis.length,
        startDate: analysisStartDate,
        endDate: analysisEndDate,
      },
      fees: feeSummary,
      portfolioAllocation: Object.fromEntries(portfolioAllocation),
      holdings: holdings.holdings?.length || 0,
      transactions: transactions.investment_transactions?.length || 0,
    });
  } catch (error: any) {
    console.error('Analysis error:', error);
    return NextResponse.json(
      { 
        error: 'Analysis failed',
        details: error.message 
      },
      { status: 500 }
    );
  }
}

/**
 * Calculate current portfolio allocation by security
 */
function calculatePortfolioAllocation(
  holdings: any[],
  securities: any[]
): Map<string, number> {
  const allocation = new Map<string, number>();
  let totalValue = 0;

  // Calculate total portfolio value
  for (const holding of holdings) {
    const value = holding.institution_value || 0;
    totalValue += value;
  }

  if (totalValue === 0) return allocation;

  // Calculate percentage allocation for each holding
  for (const holding of holdings) {
    const security = securities.find((s: any) => s.security_id === holding.security_id);
    if (security) {
      const ticker = security.ticker_symbol || security.security_id;
      const value = holding.institution_value || 0;
      const percentage = (value / totalValue) * 100;
      allocation.set(ticker, percentage);
    }
  }

  return allocation;
}

/**
 * Calculate monthly portfolio and benchmark returns
 * This is a simplified version - in production, you'd reconstruct position history
 */
function calculateMonthlyReturns(
  transactions: any[],
  holdings: any[],
  securities: any[],
  portfolioAllocation: Map<string, number>,
  benchmarkMap: Map<string, string>,
  benchmarkReturns: any[],
  startDate: string,
  endDate: string
): MonthlyAnalysis[] {
  // Group benchmark returns by month and ticker
  const benchmarkReturnsByMonth = new Map<string, Map<string, number>>();
  
  for (const ret of benchmarkReturns) {
    const month = ret.return_date.substring(0, 7); // YYYY-MM
    if (!benchmarkReturnsByMonth.has(month)) {
      benchmarkReturnsByMonth.set(month, new Map());
    }
    benchmarkReturnsByMonth.get(month)!.set(ret.asset_ticker, parseFloat(ret.monthly_return));
  }

  // Generate list of months in range
  const months: string[] = [];
  const start = new Date(startDate + '-01');
  const end = new Date(endDate + '-01');
  const current = new Date(start);
  
  while (current <= end) {
    months.push(current.toISOString().substring(0, 7));
    current.setMonth(current.getMonth() + 1);
  }

  // Simplified approach: Use current allocation to weight benchmarks
  // In production, you'd reconstruct actual portfolio composition each month
  // For now, we'll use a simplified approach that approximates returns
  
  const analysis: MonthlyAnalysis[] = [];
  let portfolioValue = 1000; // Start with normalized value
  let benchmarkValue = 1000;

  for (const month of months) {
    const monthBenchmarks = benchmarkReturnsByMonth.get(month);
    
    if (!monthBenchmarks) {
      // Skip months with no benchmark data
      continue;
    }

    // Calculate weighted benchmark return for this month
    let weightedBenchmarkReturn = 0;
    let totalWeight = 0;

    for (const [ticker, weight] of portfolioAllocation) {
      // Find the security and its benchmark
      const security = securities.find((s: any) => s.ticker_symbol === ticker);
      if (security) {
        const benchmark = benchmarkMap.get(security.security_id);
        if (benchmark && monthBenchmarks.has(benchmark)) {
          const benchmarkReturn = monthBenchmarks.get(benchmark)!;
          weightedBenchmarkReturn += (weight / 100) * benchmarkReturn;
          totalWeight += weight;
        }
      }
    }

    // Normalize if weights don't sum to 100
    if (totalWeight > 0) {
      weightedBenchmarkReturn = (weightedBenchmarkReturn / totalWeight) * 100;
    }

    // For portfolio return, use a simplified approximation
    // In production, you'd calculate actual portfolio returns from transactions
    // For now, use benchmark return as approximation (will be improved)
    const portfolioReturn = weightedBenchmarkReturn / 100; // Simplified

    // Update values
    portfolioValue *= (1 + portfolioReturn);
    benchmarkValue *= (1 + weightedBenchmarkReturn / 100);

    analysis.push({
      month,
      portfolioReturn,
      portfolioValue,
      benchmarkReturn: weightedBenchmarkReturn / 100,
      benchmarkValue,
    });
  }

  return analysis;
}

