import { NextRequest, NextResponse } from 'next/server';
import {
  PortfolioCalculator,
  MarketDataProvider,
  Security,
  Holding,
  Transaction,
} from '@/lib/portfolio-x-ray/portfolio-calculator-v2';
import {
  exportSnapshotsToCSV,
  exportTransactionsToCSV,
  exportSummaryToText,
  exportTransactionLedger,
} from '@/lib/portfolio-x-ray/portfolio-debug-v2';
import * as fs from 'fs';
import * as path from 'path';

interface MonthlyAnalysis {
  month: string; // YYYY-MM
  portfolioReturn: number;
  portfolioValue: number;
  benchmarkReturn: number;
  benchmarkValue: number;
}

interface CashflowDetail {
  date: string;
  amount: number;
  type: 'START' | 'CONTRIBUTION' | 'WITHDRAWAL' | 'END';
}

interface BenchmarkMonthlyDetail {
  month: string;
  return: number;
  cashflow: number;
  value: number;
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
    benchmarkEndValue?: number;
    periodMonths: number;
    startDate: string;
    endDate: string;
    startValue: number;
    endValue: number;
  };
  fees: {
    totalFees: number;
    explicitFees: number;
    implicitFees: number;
    feesByType: { [type: string]: number };
    feesByAccount: { [accountId: string]: number };
    feeTransactions: any[];
  };
  portfolioAllocation: { [ticker: string]: number };
  benchmarkWeights: { [ticker: string]: number };
  cashflowDetails?: CashflowDetail[];
  benchmarkMonthlyDetails?: BenchmarkMonthlyDetail[];
  holdings: number;
  transactions: number;
  allTransactions?: any[];
  debug?: any;
}

export async function POST(request: NextRequest) {
  try {
    // Get data from request body (sent from frontend after Plaid fetch)
    const body = await request.json();
    const { transactions: transactionsData, holdings: holdingsData, securities: securitiesData } = body;

    if (!transactionsData || !holdingsData) {
      return NextResponse.json(
        { error: 'Missing required data: transactions and holdings are required' },
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

    // Parse data from Plaid response
    const rawTransactions = transactionsData.investment_transactions || [];
    const rawHoldings = holdingsData.holdings || [];

    // Combine securities from both sources (Plaid sends them separately)
    const transactionSecurities = transactionsData.securities || [];
    const holdingsSecurities = holdingsData.securities || [];
    const allSecuritiesFromPlaid = securitiesData?.securities || [];

    // Deduplicate securities by security_id
    const securitiesMap = new Map();
    [...transactionSecurities, ...holdingsSecurities, ...allSecuritiesFromPlaid].forEach((sec: any) => {
      if (sec.security_id && !securitiesMap.has(sec.security_id)) {
        securitiesMap.set(sec.security_id, sec);
      }
    });
    const rawSecurities = Array.from(securitiesMap.values());

    const rawAccounts = [
      ...(transactionsData.accounts || []),
      ...(holdingsData.accounts || [])
    ];

    console.log('Loaded data:', {
      transactions: rawTransactions.length,
      holdings: rawHoldings.length,
      securities: rawSecurities.length,
      accounts: rawAccounts.length,
    });

    // Convert to our types
    const securities = new Map<string, Security>();
    for (const s of rawSecurities) {
      securities.set(s.security_id, {
        security_id: s.security_id,
        ticker_symbol: s.ticker_symbol || null,
        name: s.name || 'Unknown',
        type: s.type || 'unknown',
        is_cash_equivalent: s.is_cash_equivalent || false,
      });
    }

    const holdings: Holding[] = rawHoldings.map((h: any) => ({
      account_id: h.account_id,
      security_id: h.security_id,
      quantity: parseFloat(h.quantity || 0),
      institution_value: parseFloat(h.institution_value || 0),
      institution_price: parseFloat(h.institution_price || 0),
    }));

    const transactions: Transaction[] = rawTransactions.map((t: any) => ({
      account_id: t.account_id,
      security_id: t.security_id || null,
      date: t.date,
      type: t.type,
      subtype: t.subtype || null,
      quantity: parseFloat(t.quantity || 0),
      amount: parseFloat(t.amount || 0),
      price: parseFloat(t.price || 0),
      fees: parseFloat(t.fees || 0),
      name: t.name || '',
    }));

    // Get unique account IDs
    const accountIds = new Set<string>();
    for (const h of holdings) {
      accountIds.add(h.account_id);
    }
    for (const t of transactions) {
      accountIds.add(t.account_id);
    }

    if (accountIds.size === 0) {
      return NextResponse.json({ error: 'No accounts found' }, { status: 400 });
    }

    console.log(`Found ${accountIds.size} accounts:`, Array.from(accountIds));

    // Initialize calculator
    const marketData = new MarketDataProvider(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );
    const calculator = new PortfolioCalculator(marketData);

    // Calculate for each account
    const results = [];

    for (const accountId of accountIds) {
      try {
        console.log(`\n=== Calculating for account ${accountId} ===`);
        const result = await calculator.calculate(
          accountId,
          holdings,
          transactions,
          securities,
          24 // 24 months lookback
        );
        results.push(result);
        console.log(`Account ${accountId} results:`, {
          startValue: result.startValue,
          endValue: result.endValue,
          totalReturn: result.totalReturn.toFixed(2) + '%',
          irr: result.irr ? result.irr.toFixed(2) + '%' : 'N/A',
          snapshots: result.monthlySnapshots.length,
        });

        // Debug output only in local development
        if (process.env.NODE_ENV === 'development') {
          try {
            const debugOutputBaseDir = 'C:\\code\\portfolio_x_ray\\debug_output';
            const accountDebugDir = path.join(debugOutputBaseDir, accountId);
            exportSnapshotsToCSV(accountId, result.monthlySnapshots, securities, accountDebugDir);
            exportTransactionsToCSV(accountId, transactions, securities, accountDebugDir);
            exportSummaryToText(accountId, result, accountDebugDir);
            exportTransactionLedger(accountId, result.monthlySnapshots, transactions, securities, accountDebugDir);
          } catch (debugError) {
            console.error(`Error exporting debug files for ${accountId}:`, debugError);
          }
        }
      } catch (error: any) {
        console.error(`Error calculating account ${accountId}:`, error.message);
      }
    }

    if (results.length === 0) {
      return NextResponse.json(
        { error: 'No valid calculation results' },
        { status: 500 }
      );
    }

    // Aggregate results
    const totalStartValue = results.reduce((sum, r) => sum + r.startValue, 0);
    const totalEndValue = results.reduce((sum, r) => sum + r.endValue, 0);
    const totalExplicitFees = results.reduce((sum, r) => sum + r.explicitFees, 0);
    const totalImplicitFees = results.reduce((sum, r) => sum + r.implicitFees, 0);

    // Calculate weighted averages
    let weightedIrr = 0;
    let weightedBenchmarkIrr = 0;
    let weightedBenchmarkReturn = 0;
    let totalWeight = 0;

    for (const result of results) {
      const weight = result.startValue;
      if (result.irr !== null) {
        weightedIrr += result.irr * weight;
      }
      if (result.benchmarkIrr !== null) {
        weightedBenchmarkIrr += result.benchmarkIrr * weight;
      }
      weightedBenchmarkReturn += result.benchmarkReturn * weight;
      totalWeight += weight;
    }

    const aggregateIrr = totalWeight > 0 ? weightedIrr / totalWeight : null;
    const aggregateBenchmarkIrr = totalWeight > 0 ? weightedBenchmarkIrr / totalWeight : null;
    const aggregateBenchmarkReturn = totalWeight > 0 ? weightedBenchmarkReturn / totalWeight : 0;

    // Calculate aggregate returns
    const totalReturn = ((totalEndValue - totalStartValue) / totalStartValue) * 100;
    const firstResult = results[0];
    const startDate = new Date(firstResult.startDate);
    const endDate = new Date(firstResult.endDate);
    const months = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    const years = months / 12;
    const annualizedReturn = (Math.pow(1 + totalReturn / 100, 1 / years) - 1) * 100;

    // Build monthly analysis from snapshots (aggregate across all accounts)
    const monthlyAnalysis: MonthlyAnalysis[] = [];

    if (results.length > 0) {
      // Get the number of snapshots (should be same for all accounts)
      const numMonths = results[0].monthlySnapshots.length;

      for (let i = 0; i < numMonths; i++) {
        // Sum up values across all accounts for this month
        let totalPortfolioValue = 0;
        let totalBenchmarkValue = 0;
        let monthDate = results[0].monthlySnapshots[i].date;

        for (const result of results) {
          if (i < result.monthlySnapshots.length) {
            totalPortfolioValue += result.monthlySnapshots[i].totalValue;
            // TODO: Add benchmark value when available
          }
        }

        // Calculate return from previous month
        const prevMonthValue = i > 0 ? monthlyAnalysis[i - 1].portfolioValue : totalStartValue;
        const monthReturn = ((totalPortfolioValue - prevMonthValue) / prevMonthValue) * 100;

        // Format date as MM-DD-YYYY (convert from YYYY-MM-DD)
        const dateParts = monthDate.split('-');
        const formattedDate = `${dateParts[1]}-${dateParts[2]}-${dateParts[0]}`;

        monthlyAnalysis.push({
          month: formattedDate,
          portfolioReturn: monthReturn,
          portfolioValue: totalPortfolioValue,
          benchmarkReturn: 0, // TODO: calculate from benchmark snapshots
          benchmarkValue: 0,
        });
      }
    }

    // Calculate portfolio allocation
    // First, calculate total portfolio value (including cash equivalents)
    let totalPortfolioValue = 0;
    for (const holding of holdings) {
      totalPortfolioValue += holding.institution_value;
    }

    // Then build allocation for non-cash securities as percentage of TOTAL portfolio
    const portfolioAllocation: { [ticker: string]: number } = {};
    for (const holding of holdings) {
      const security = securities.get(holding.security_id);
      if (security && !security.is_cash_equivalent) {
        const ticker = security.ticker_symbol || security.name;
        const value = holding.institution_value;
        portfolioAllocation[ticker] = (portfolioAllocation[ticker] || 0) + value;
      }
    }

    // Convert to percentages using total portfolio value (not just non-cash holdings)
    if (totalPortfolioValue > 0) {
      for (const ticker in portfolioAllocation) {
        portfolioAllocation[ticker] = (portfolioAllocation[ticker] / totalPortfolioValue) * 100;
      }
    }

    // Aggregate benchmark weights from all accounts (weighted by account start value)
    const benchmarkWeights: { [ticker: string]: number } = {};
    let totalBenchmarkWeight = 0;

    for (const result of results) {
      const weight = result.startValue;
      totalBenchmarkWeight += weight;

      // Convert Map to object and accumulate
      for (const [ticker, percentage] of result.benchmarkWeights) {
        benchmarkWeights[ticker] = (benchmarkWeights[ticker] || 0) + (percentage * weight);
      }
    }

    // Normalize to percentages
    if (totalBenchmarkWeight > 0) {
      for (const ticker in benchmarkWeights) {
        benchmarkWeights[ticker] = benchmarkWeights[ticker] / totalBenchmarkWeight;
      }
    }

    // Build fee summary and all transactions list
    const feeTransactions: any[] = [];
    const feesByType: { [type: string]: number } = {};
    const feesByAccount: { [accountId: string]: number } = {};
    const allTransactions: any[] = [];

    for (const tx of transactions) {
      const security = tx.security_id ? securities.get(tx.security_id) : null;
      const ticker = security?.ticker_symbol || security?.name || 'Cash/Other';

      // Add to all transactions list
      allTransactions.push({
        date: tx.date,
        type: tx.type,
        subtype: tx.subtype || '',
        account_id: tx.account_id,
        name: tx.name,
        security: ticker,
        quantity: tx.quantity,
        price: tx.price,
        amount: tx.amount,
        fees: tx.fees,
      });

      // Track fees separately
      if (tx.type === 'fee' || tx.fees > 0) {
        const feeAmount = (tx.type === 'fee' ? Math.abs(tx.amount) : 0) + tx.fees;
        if (feeAmount > 0) {
          const feeType = tx.subtype || tx.type || 'fee';

          feesByType[feeType] = (feesByType[feeType] || 0) + feeAmount;
          feesByAccount[tx.account_id] = (feesByAccount[tx.account_id] || 0) + feeAmount;

          feeTransactions.push({
            date: tx.date,
            amount: feeAmount,
            account_id: tx.account_id,
            name: tx.name,
            type: feeType,
          });
        }
      }
    }

    feeTransactions.sort((a, b) => b.date.localeCompare(a.date));
    allTransactions.sort((a, b) => b.date.localeCompare(a.date));

    // Aggregate cashflows from ALL accounts
    const cashflowDetails: CashflowDetail[] = [];
    if (results.length > 0) {
      // Use first account for dates (all accounts should have same date range)
      const firstAccountResult = results[0];

      // Add START as total of all accounts' start values
      cashflowDetails.push({
        date: firstAccountResult.startDate,
        amount: -totalStartValue,
        type: 'START'
      });

      // Collect all external cashflows from all accounts and aggregate by date
      const cashflowsByDate = new Map<string, number>();
      for (const result of results) {
        for (const cf of result.externalCashflows) {
          const existing = cashflowsByDate.get(cf.date) || 0;
          cashflowsByDate.set(cf.date, existing + cf.amount);
        }
      }

      // Sort dates and add to cashflowDetails
      const sortedDates = Array.from(cashflowsByDate.keys()).sort();
      for (const date of sortedDates) {
        const amount = cashflowsByDate.get(date)!;
        cashflowDetails.push({
          date,
          amount,
          type: amount < 0 ? 'CONTRIBUTION' : 'WITHDRAWAL'
        });
      }

      // Add END as total of all accounts' end values
      cashflowDetails.push({
        date: firstAccountResult.endDate,
        amount: totalEndValue,
        type: 'END'
      });
    }

    // Aggregate benchmark monthly data across all accounts
    const benchmarkMonthlyDetails: BenchmarkMonthlyDetail[] = [];
    if (results.length > 0) {
      // Get all unique months
      const monthsSet = new Set<string>();
      results.forEach(r => {
        r.benchmarkMonthlyData.forEach(d => monthsSet.add(d.month));
      });
      const sortedMonths = Array.from(monthsSet).sort();

      // For each month, sum values and calculate weighted average return
      for (const month of sortedMonths) {
        let totalValue = 0;
        let totalCashflow = 0;
        let weightedReturn = 0;
        let totalPrevValue = 0;

        for (const result of results) {
          const monthData = result.benchmarkMonthlyData.find(d => d.month === month);
          if (monthData) {
            totalValue += monthData.value;
            totalCashflow += monthData.cashflow;
            // To calculate weighted return, we need the previous month's value as weight
            // For simplicity, we'll use current value as approximation
            weightedReturn += monthData.return * monthData.value;
            totalPrevValue += monthData.value;
          }
        }

        const avgReturn = totalPrevValue > 0 ? weightedReturn / totalPrevValue : 0;

        benchmarkMonthlyDetails.push({
          month,
          return: avgReturn,
          cashflow: totalCashflow,
          value: totalValue
        });
      }
    }

    // Calculate total benchmark end value
    const totalBenchmarkEndValue = results.reduce((sum, r) => sum + r.benchmarkEndValue, 0);

    // Format dates as MM-DD-YYYY
    const formatDateToMMDDYYYY = (dateStr: string) => {
      const parts = dateStr.split('-');
      return `${parts[1]}-${parts[2]}-${parts[0]}`;
    };

    const response: AnalysisResponse = {
      monthlyAnalysis,
      summary: {
        portfolioTotalReturn: totalReturn,
        portfolioAnnualizedReturn: annualizedReturn,
        benchmarkTotalReturn: aggregateBenchmarkReturn,
        benchmarkAnnualizedReturn: aggregateBenchmarkReturn,
        outperformance: annualizedReturn - aggregateBenchmarkReturn,
        irr: aggregateIrr !== null ? aggregateIrr : undefined,
        benchmarkIrr: aggregateBenchmarkIrr !== null ? aggregateBenchmarkIrr : undefined,
        benchmarkEndValue: totalBenchmarkEndValue,
        periodMonths: Math.round(months),
        startDate: formatDateToMMDDYYYY(firstResult.startDate),
        endDate: formatDateToMMDDYYYY(firstResult.endDate),
        startValue: totalStartValue,
        endValue: totalEndValue,
      },
      fees: {
        totalFees: totalExplicitFees + totalImplicitFees,
        explicitFees: totalExplicitFees,
        implicitFees: totalImplicitFees,
        feesByType,
        feesByAccount,
        feeTransactions,
      },
      portfolioAllocation,
      benchmarkWeights,
      cashflowDetails,
      benchmarkMonthlyDetails,
      holdings: holdings.length,
      transactions: transactions.length,
      allTransactions, // Include full transaction list for PDF
      debug: {
        accountResults: results.map(r => ({
          accountId: r.accountId,
          startValue: r.startValue,
          endValue: r.endValue,
          totalReturn: r.totalReturn,
          irr: r.irr,
          snapshotCount: r.monthlySnapshots.length,
          externalCashflows: r.externalCashflows.length,
        })),
      },
    };

    console.log('\n=== Final Results ===');
    console.log('Total Return:', totalReturn.toFixed(2) + '%');
    console.log('Annualized Return:', annualizedReturn.toFixed(2) + '%');
    console.log('IRR:', aggregateIrr ? aggregateIrr.toFixed(2) + '%' : 'N/A');
    console.log('Benchmark Return:', aggregateBenchmarkReturn.toFixed(2) + '%');
    console.log('Outperformance:', (annualizedReturn - aggregateBenchmarkReturn).toFixed(2) + '%');
    console.log('Total Fees:', (totalExplicitFees + totalImplicitFees).toFixed(2));

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Analysis error:', error);
    return NextResponse.json(
      {
        error: 'Analysis failed',
        details: error.message,
        stack: error.stack,
      },
      { status: 500 }
    );
  }
}
