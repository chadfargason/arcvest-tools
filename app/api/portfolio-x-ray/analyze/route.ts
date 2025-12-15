import { NextRequest, NextResponse } from 'next/server';
import {
  PlaidPerformanceEngine,
  SupabaseMarketDataProvider,
  DefaultFundDataProvider,
  EngineResult,
  iterMonthEnds,
  parseDate,
} from '@/lib/portfolio-x-ray/performance-engine';
import { exportPortfolioDebugData } from '@/lib/portfolio-x-ray/portfolio-debug';
import * as fs from 'fs';
import * as path from 'path';

interface MonthlyAnalysis {
  month: string; // YYYY-MM
  portfolioReturn: number;
  portfolioValue: number;
  benchmarkReturn: number;
  benchmarkValue: number;
}

interface AnalysisResponse {
  monthlyAnalysis: MonthlyAnalysis[];
  summary: {
    portfolioTotalReturn: number;
    portfolioAnnualizedReturn: number;
    benchmarkTotalReturn: number;
    benchmarkAnnualizedReturn: number;
    outperformance: number;
    irr?: number;
    benchmarkIrr?: number;
    periodMonths: number;
    startDate: string;
    endDate: string;
    note?: string;
  };
  fees: {
    totalFees: number;
    explicitFees: number;
    implicitFees: number;
    feeDrag?: number;
    feesByType: { [type: string]: number };
    feesByAccount: { [accountId: string]: number };
    feeTransactions: any[];
  };
  portfolioAllocation: { [ticker: string]: number };
  holdings: number;
  transactions: number;
}

export async function POST(request: NextRequest) {
  try {
    // TEMPORARY: Load data from Raw Data.txt file instead of Plaid
    // TODO: Re-enable Plaid integration after testing
    // Try multiple possible paths (including data folder in project)
    const possiblePaths = [
      path.join(process.cwd(), 'data', 'Raw Data.txt'),
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
        {
          error:
            'Could not load Raw Data.txt file. Checked paths: ' +
            possiblePaths.join(', '),
        },
        { status: 500 }
      );
    }

    // Extract data from file in same format as Plaid API
    const transactionsResp = {
      investment_transactions: fileData.transactions.all_transactions || [],
      securities: fileData.holdings.all_securities || [],
    };
    const holdingsResp = {
      holdings: fileData.holdings.all_holdings || [],
      securities: fileData.holdings.all_securities || [],
      accounts: fileData.holdings.all_accounts || [],
    };

    console.log('Loaded data from Raw Data.txt:', {
      transactionsCount: transactionsResp.investment_transactions.length,
      holdingsCount: holdingsResp.holdings.length,
      securitiesCount: holdingsResp.securities.length,
      accountsCount: holdingsResp.accounts.length,
    });

    /* ORIGINAL PLAID CODE - COMMENTED OUT FOR TESTING
    const body = await request.json();
    const { transactions: transactionsResp, holdings: holdingsResp } = body;

    if (!transactionsResp || !holdingsResp) {
      return NextResponse.json(
        { error: 'Missing required data: transactions and holdings are required' },
        { status: 400 }
      );
    }
    END OF ORIGINAL PLAID CODE */

    // Validate Supabase config
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
      return NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 500 }
      );
    }

    // Initialize the performance engine with data providers
    const marketProvider = new SupabaseMarketDataProvider(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );
    const fundProvider = new DefaultFundDataProvider();
    const engine = new PlaidPerformanceEngine(marketProvider, fundProvider);

    // Get all unique account IDs
    const accountIds = new Set<string>();
    for (const holding of holdingsResp.holdings || []) {
      if (holding.account_id) {
        accountIds.add(holding.account_id);
      }
    }
    for (const tx of transactionsResp.investment_transactions || []) {
      if (tx.account_id) {
        accountIds.add(tx.account_id);
      }
    }

    if (accountIds.size === 0) {
      return NextResponse.json(
        { error: 'No accounts found in data' },
        { status: 400 }
      );
    }

    // Calculate results for each account and aggregate
    const accountResults: EngineResult[] = [];
    const accountIdsArray = Array.from(accountIds);

    // Export debug data - try to save locally, but also include in response for Vercel
    // Note: Vercel has read-only filesystem, so file writes only work locally
    let debugDataSaved = false;
    const debugCSVs: { [accountId: string]: { transactions: string; positions: string; monthly: string } } = {};

    // Only try to write files if we're in a local environment (not Vercel)
    const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV;
    
    if (!isVercel) {
      // Try to save files locally
      const possiblePortfolioPaths = [
        'C:\\code\\Portfolio_x_ray', // Direct absolute path
        path.join(process.cwd(), '..', 'Portfolio_x_ray'),
        path.join(process.cwd(), 'Portfolio_x_ray'),
        path.join(process.cwd(), '..', '..', 'Portfolio_x_ray'),
      ];
      
      let portfolioXRayPath = null;
      for (const p of possiblePortfolioPaths) {
        try {
          if (fs.existsSync(p)) {
            portfolioXRayPath = p;
            console.log(`[DEBUG] Found Portfolio_x_ray at: ${p}`);
            break;
          }
        } catch (e) {
          // Path might be invalid, continue
        }
      }
      
      if (!portfolioXRayPath) {
        // Fallback: try to create it at the expected location
        const fallbackPath = 'C:\\code\\Portfolio_x_ray';
        try {
          if (!fs.existsSync(fallbackPath)) {
            fs.mkdirSync(fallbackPath, { recursive: true });
          }
          portfolioXRayPath = fallbackPath;
          console.log(`[DEBUG] Using fallback path: ${fallbackPath}`);
        } catch (e) {
          console.error(`[DEBUG] Could not create fallback path: ${fallbackPath}`);
        }
      }
      
      const debugOutputDir = portfolioXRayPath 
        ? path.join(portfolioXRayPath, 'debug_output')
        : path.join(process.cwd(), 'debug_output');
      
      console.log(`[DEBUG] Using debug output directory: ${debugOutputDir}`);
      
      // Ensure debug output directory exists
      try {
        if (!fs.existsSync(debugOutputDir)) {
          fs.mkdirSync(debugOutputDir, { recursive: true });
          console.log(`[DEBUG] Created debug output directory: ${debugOutputDir}`);
        }
      } catch (e: any) {
        console.error(`[DEBUG] Error creating debug output directory: ${e.message}`);
      }

      for (const accountId of accountIdsArray) {
        try {
          // Determine date range
          const txsForAccount = (transactionsResp.investment_transactions || []).filter(
            (tx: any) => tx.account_id === accountId
          );
          
          let endDate: Date;
          if (txsForAccount.length > 0) {
            const maxDate = Math.max(...txsForAccount.map((tx: any) => parseDate(tx.date).getTime()));
            endDate = new Date(maxDate);
          } else {
            endDate = new Date();
          }
          
          const startDate = new Date(endDate);
          startDate.setDate(startDate.getDate() - 730); // 24 months
          
          const monthEnds = iterMonthEnds(startDate, endDate);

          // Export debug data to files (local only)
          try {
            const accountDebugDir = path.join(debugOutputDir, accountId);
            console.log(`Attempting to export debug data to: ${accountDebugDir}`);
            
            await exportPortfolioDebugData(
              accountId,
              holdingsResp,
              transactionsResp,
              startDate,
              endDate,
              monthEnds,
              accountDebugDir
            );
            debugDataSaved = true;
            console.log(`Successfully exported debug data for account ${accountId} to ${accountDebugDir}`);
          } catch (debugError: any) {
            console.error(`Error exporting debug data for account ${accountId}:`, debugError);
            // Continue even if debug export fails
          }
        } catch (e) {
          console.error(`Error processing account ${accountId} for debug export:`, e);
        }
      }
    } else {
      console.log('[DEBUG] Running on Vercel - skipping file writes (read-only filesystem)');
    }

    // Generate debug CSV data for API response (works on both local and Vercel)
    for (const accountId of accountIdsArray) {
      try {
        // Determine date range
        const txsForAccount = (transactionsResp.investment_transactions || []).filter(
          (tx: any) => tx.account_id === accountId
        );
        
        let endDate: Date;
        if (txsForAccount.length > 0) {
          const maxDate = Math.max(...txsForAccount.map((tx: any) => parseDate(tx.date).getTime()));
          endDate = new Date(maxDate);
        } else {
          endDate = new Date();
        }
        
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 730); // 24 months
        
        const monthEnds = iterMonthEnds(startDate, endDate);

        // Generate CSV data in memory
        const { generateDebugCSVs } = await import('@/lib/portfolio-x-ray/portfolio-debug');
        const csvData = await generateDebugCSVs(
          accountId,
          holdingsResp,
          transactionsResp,
          startDate,
          endDate,
          monthEnds
        );
        debugCSVs[accountId] = csvData;
      } catch (e) {
        console.error(`Error generating CSV data for account ${accountId}:`, e);
      }
    }

    for (const accountId of accountIdsArray) {
      try {

        const result = await engine.computeForAccount(
          accountId,
          holdingsResp,
          transactionsResp,
          null, // endOverride
          730 // 24 months lookback
        );
        accountResults.push(result);
        console.log(`Computed result for account ${accountId}:`, {
          irr: result.irr_net,
          benchmarkIrr: result.benchmark_irr,
          explicitFees: result.explicit_fees,
          implicitFees: result.implicit_fees_est,
        });
      } catch (error: any) {
        console.error(`Error computing result for account ${accountId}:`, error);
        // Continue with other accounts
      }
    }

    if (accountResults.length === 0) {
      return NextResponse.json(
        { error: 'No valid results computed for any account' },
        { status: 500 }
      );
    }

    // Aggregate results across accounts (weighted by start_value)
    const totalStartValue = accountResults.reduce(
      (sum, r) => sum + r.start_value,
      0
    );
    const totalEndValue = accountResults.reduce(
      (sum, r) => sum + r.end_value,
      0
    );
    const totalBenchmarkEndValue = accountResults.reduce(
      (sum, r) => sum + (r.benchmark_end_value || 0),
      0
    );
    const totalExplicitFees = accountResults.reduce(
      (sum, r) => sum + r.explicit_fees,
      0
    );
    const totalImplicitFees = accountResults.reduce(
      (sum, r) => sum + r.implicit_fees_est,
      0
    );

    // Use the first account's dates (they should all be similar for 24-month lookback)
    const firstResult = accountResults[0];
    const startDate = firstResult.start_date;
    const endDate = firstResult.end_date;

    // Calculate aggregate IRR (approximate: use weighted average)
    // For exact aggregate IRR, we'd need to combine all cashflows
    let aggregateIrr: number | null = null;
    let aggregateBenchmarkIrr: number | null = null;

    if (accountResults.length === 1) {
      aggregateIrr = accountResults[0].irr_net;
      aggregateBenchmarkIrr = accountResults[0].benchmark_irr;
    } else {
      // Weighted average IRR (approximate)
      let weightedIrr = 0;
      let weightedBenchmarkIrr = 0;
      let totalWeight = 0;

      for (const result of accountResults) {
        const weight = result.start_value;
        if (result.irr_net != null) {
          weightedIrr += result.irr_net * weight;
        }
        if (result.benchmark_irr != null) {
          weightedBenchmarkIrr += result.benchmark_irr * weight;
        }
        totalWeight += weight;
      }

      if (totalWeight > 0) {
        aggregateIrr = weightedIrr / totalWeight;
        aggregateBenchmarkIrr = weightedBenchmarkIrr / totalWeight;
      }
    }

    // Calculate total return and annualized return from aggregate values
    const totalReturn =
      totalStartValue > 0
        ? (totalEndValue - totalStartValue) / totalStartValue
        : 0;
    const benchmarkTotalReturn =
      totalStartValue > 0
        ? (totalBenchmarkEndValue - totalStartValue) / totalStartValue
        : 0;

    const monthsDiff =
      (endDate.getTime() - startDate.getTime()) /
      (1000 * 60 * 60 * 24 * 30.44); // Average days per month
    const years = monthsDiff / 12;

    const annualizedReturn =
      years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;
    const benchmarkAnnualizedReturn =
      years > 0 ? Math.pow(1 + benchmarkTotalReturn, 1 / years) - 1 : 0;

    // Build monthly analysis (simplified - for full monthly detail, would need to aggregate month-by-month)
    const monthlyAnalysis: MonthlyAnalysis[] = [];

    // Calculate portfolio allocation from current holdings
    const portfolioAllocation: { [ticker: string]: number } = {};
    let totalHoldingsValue = 0;

    for (const holding of holdingsResp.holdings || []) {
      const security = (holdingsResp.securities || []).find(
        (s: any) => s.security_id === holding.security_id
      );
      if (security) {
        const ticker = security.ticker_symbol || security.security_id;
        const value = holding.institution_value || 0;
        totalHoldingsValue += value;
        portfolioAllocation[ticker] = (portfolioAllocation[ticker] || 0) + value;
      }
    }

    // Convert to percentages
    if (totalHoldingsValue > 0) {
      for (const ticker in portfolioAllocation) {
        portfolioAllocation[ticker] =
          (portfolioAllocation[ticker] / totalHoldingsValue) * 100;
      }
    }

    // Build fee summary
    const feeTransactions: any[] = [];
    const feesByType: { [type: string]: number } = {};
    const feesByAccount: { [accountId: string]: number } = {};

    for (const tx of transactionsResp.investment_transactions || []) {
      if (tx.type === 'fee' || (tx.fees && tx.fees > 0)) {
        const feeAmount =
          (tx.type === 'fee' ? Math.abs(tx.amount || 0) : 0) +
          (tx.fees || 0);
        if (feeAmount > 0) {
          const accountId = tx.account_id || 'unknown';
          const feeType = tx.subtype || tx.type || 'fee';

          feesByType[feeType] = (feesByType[feeType] || 0) + feeAmount;
          feesByAccount[accountId] =
            (feesByAccount[accountId] || 0) + feeAmount;

          feeTransactions.push({
            date: tx.date,
            amount: feeAmount,
            account_id: accountId,
            name: tx.name || 'Fee',
            type: feeType,
          });
        }
      }
    }

    feeTransactions.sort((a, b) => b.date.localeCompare(a.date));

    const response: AnalysisResponse = {
      monthlyAnalysis, // Empty for now - could be populated with detailed monthly breakdown
      summary: {
        portfolioTotalReturn: totalReturn * 100,
        portfolioAnnualizedReturn: annualizedReturn * 100,
        benchmarkTotalReturn: benchmarkTotalReturn * 100,
        benchmarkAnnualizedReturn: benchmarkAnnualizedReturn * 100,
        outperformance: (annualizedReturn - benchmarkAnnualizedReturn) * 100,
        irr: aggregateIrr != null ? aggregateIrr * 100 : undefined,
        benchmarkIrr:
          aggregateBenchmarkIrr != null
            ? aggregateBenchmarkIrr * 100
            : undefined,
        periodMonths: Math.round(monthsDiff),
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      },
      fees: {
        totalFees: totalExplicitFees + totalImplicitFees,
        explicitFees: totalExplicitFees,
        implicitFees: totalImplicitFees,
        feeDrag:
          accountResults[0]?.fee_drag_approx != null
            ? accountResults[0].fee_drag_approx * 100
            : undefined,
        feesByType,
        feesByAccount,
        feeTransactions,
      },
      portfolioAllocation,
      holdings: holdingsResp.holdings?.length || 0,
      transactions: transactionsResp.investment_transactions?.length || 0,
      debugCSVs: Object.keys(debugCSVs).length > 0 ? debugCSVs : undefined,
      debugDataSavedLocally: debugDataSaved,
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Analysis error:', error);
    return NextResponse.json(
      {
        error: 'Analysis failed',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
