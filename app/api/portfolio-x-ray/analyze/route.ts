import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getBenchmarkForPlaidSecurity } from '@/lib/portfolio-x-ray/benchmark-matcher';
import { calculateFees } from '@/lib/portfolio-x-ray/fee-calculator';
import { 
  calculatePortfolioReturns, 
  calculateGeometricReturn, 
  annualizeReturn 
} from '@/lib/portfolio-x-ray/portfolio-returns';
import * as fs from 'fs';
import * as path from 'path';

interface MonthlyAnalysis {
  month: string; // YYYY-MM
  portfolioReturn: number;
  portfolioValue: number;
  benchmarkReturn: number;
  benchmarkValue: number;
}

export async function POST(request: NextRequest) {
  try {
    // TEMPORARY: Load data from Raw Data.txt file instead of Plaid
    // TODO: Re-enable Plaid integration after testing
    // Try multiple possible paths
    const possiblePaths = [
      path.join(process.cwd(), '..', 'Portfolio_x_ray', 'Raw Data.txt'),
      path.join(process.cwd(), 'Portfolio_x_ray', 'Raw Data.txt'),
      path.join(process.cwd(), '..', '..', 'Portfolio_x_ray', 'Raw Data.txt'),
    ];
    
    let rawDataContent = '';
    let fileData = null;
    
    for (const rawDataPath of possiblePaths) {
      try {
        if (fs.existsSync(rawDataPath)) {
          rawDataContent = fs.readFileSync(rawDataPath, 'utf-8');
          const jsonStart = rawDataContent.indexOf('{');
          const jsonContent = rawDataContent.substring(jsonStart);
          fileData = JSON.parse(jsonContent);
          console.log(`Successfully loaded Raw Data.txt from: ${rawDataPath}`);
          break;
        }
      } catch (error) {
        console.log(`Failed to load from ${rawDataPath}:`, error);
        continue;
      }
    }
    
    if (!fileData) {
      return NextResponse.json(
        { error: 'Could not load Raw Data.txt file. Checked paths: ' + possiblePaths.join(', ') },
        { status: 500 }
      );
    }

    // Extract data from file in same format as Plaid API
    const transactions = {
      investment_transactions: fileData.transactions.all_transactions || [],
      securities: fileData.holdings.all_securities || [],
    };
    const holdings = {
      holdings: fileData.holdings.all_holdings || [],
      securities: fileData.holdings.all_securities || [],
    };
    const securitiesList = fileData.holdings.all_securities || [];

    console.log('Loaded data from Raw Data.txt:', {
      transactionsCount: transactions.investment_transactions.length,
      holdingsCount: holdings.holdings.length,
      securitiesCount: securitiesList.length,
    });

    /* ORIGINAL PLAID CODE - COMMENTED OUT FOR TESTING
    const body = await request.json();
    const { transactions, holdings, securities } = body;

    console.log('Analyze request received:', {
      hasTransactions: !!transactions,
      hasHoldings: !!holdings,
      hasSecurities: !!securities,
      securitiesType: typeof securities,
      securitiesIsArray: Array.isArray(securities),
      securitiesKeys: securities ? Object.keys(securities) : [],
    });

    if (!transactions || !holdings) {
      return NextResponse.json(
        { error: 'Missing required data: transactions and holdings are required' },
        { status: 400 }
      );
    }

    // Handle securities in different formats
    let securitiesList: any[] = [];
    if (Array.isArray(securities)) {
      securitiesList = securities;
    } else if (securities?.securities && Array.isArray(securities.securities)) {
      securitiesList = securities.securities;
    } else if (transactions?.securities && Array.isArray(transactions.securities)) {
      securitiesList = transactions.securities;
    } else if (holdings?.securities && Array.isArray(holdings.securities)) {
      securitiesList = holdings.securities;
    }

    if (securitiesList.length === 0) {
      console.warn('No securities found in request');
    }
    END OF ORIGINAL PLAID CODE */

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
      securitiesList
    );

    console.log('Portfolio allocation calculated:', {
      allocationSize: portfolioAllocation.size,
      allocations: Array.from(portfolioAllocation.entries()).slice(0, 5),
    });

    // Match holdings to benchmarks
    const benchmarkMap = new Map<string, string>();
    for (const holding of holdings.holdings || []) {
      const security = securitiesList.find(
        (s: any) => s.security_id === holding.security_id
      );
      if (security) {
        const benchmark = getBenchmarkForPlaidSecurity(security);
        benchmarkMap.set(security.security_id, benchmark);
        console.log(`Matched ${security.ticker_symbol || security.name} to benchmark ${benchmark}`);
      }
    }

    console.log('Benchmark map created:', {
      benchmarkMapSize: benchmarkMap.size,
      uniqueBenchmarks: Array.from(new Set(benchmarkMap.values())),
    });

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

    // Calculate monthly portfolio returns from transactions
    const monthlyReturns = calculatePortfolioReturns(
      transactions.investment_transactions || [],
      holdings.holdings || [],
      securitiesList,
      analysisStartDate,
      analysisEndDate
    );

    // Calculate weighted benchmark returns for comparison
    const monthlyAnalysis = calculateMonthlyBenchmarkComparison(
      monthlyReturns,
      portfolioAllocation,
      benchmarkMap,
      securitiesList,
      benchmarkReturns || [],
      analysisStartDate,
      analysisEndDate
    );

    console.log('Monthly analysis calculated:', {
      months: monthlyAnalysis.length,
      hasBenchmarkData: (benchmarkReturns?.length ?? 0) > 0,
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
 * Calculate weighted benchmark returns to compare against portfolio returns
 */
function calculateMonthlyBenchmarkComparison(
  monthlyReturns: any[],
  portfolioAllocation: Map<string, number>,
  benchmarkMap: Map<string, string>,
  securities: any[],
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

  // Combine portfolio returns with benchmark returns
  const analysis: MonthlyAnalysis[] = [];
  let benchmarkValue = 1000;

  for (const portfolioReturn of monthlyReturns) {
    const month = portfolioReturn.month;
    const monthBenchmarks = benchmarkReturnsByMonth.get(month);
    
    // Calculate weighted benchmark return for this month
    let weightedBenchmarkReturn = 0;
    let totalWeight = 0;

    if (monthBenchmarks) {
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
    }

    // Update benchmark value
    benchmarkValue *= (1 + weightedBenchmarkReturn / 100);

    analysis.push({
      month,
      portfolioReturn: portfolioReturn.portfolioReturn,
      portfolioValue: portfolioReturn.portfolioValue,
      benchmarkReturn: weightedBenchmarkReturn / 100,
      benchmarkValue,
    });
  }

  return analysis;
}

