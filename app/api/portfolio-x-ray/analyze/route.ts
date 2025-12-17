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

interface HoldingDetail {
  ticker: string;
  quantity: number;
  price: number;
  value: number;
  percentage: number;
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
  holdingsDetails?: HoldingDetail[];
  holdingsAsOfDate?: string; // Date the holdings are as of (last snapshot date)
  cashHoldings?: { value: number; percentage: number };
  // Actual Plaid holdings for reconciliation
  plaidHoldings?: HoldingDetail[];
  plaidCashHoldings?: { value: number; percentage: number };
  plaidTotalValue?: number;
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

    // Calculate for ALL ACCOUNTS COMBINED as a single portfolio
    // This ensures proper IRR calculation with combined cashflows
    console.log(`\n=== Calculating for ALL ACCOUNTS COMBINED ===`);

    let combinedResult;
    try {
      combinedResult = await calculator.calculate(
        'COMBINED', // Use a special ID for combined calculation
        holdings,   // Pass ALL holdings (calculator will sum across accounts)
        transactions, // Pass ALL transactions
        securities,
        24 // 24 months lookback
      );
      console.log(`Combined results:`, {
        startValue: combinedResult.startValue,
        endValue: combinedResult.endValue,
        totalReturn: combinedResult.totalReturn.toFixed(2) + '%',
        irr: combinedResult.irr ? combinedResult.irr.toFixed(2) + '%' : 'N/A',
        benchmarkIrr: combinedResult.benchmarkIrr ? combinedResult.benchmarkIrr.toFixed(2) + '%' : 'N/A',
        snapshots: combinedResult.monthlySnapshots.length,
      });
    } catch (error: any) {
      console.error(`Error calculating combined portfolio:`, error.message);
      return NextResponse.json(
        { error: 'Portfolio calculation failed', details: error.message },
        { status: 500 }
      );
    }

    // Debug output only in local development
    if (process.env.NODE_ENV === 'development') {
      try {
        const debugOutputBaseDir = 'C:\\code\\portfolio_x_ray\\debug_output';
        const accountDebugDir = path.join(debugOutputBaseDir, 'COMBINED');
        exportSnapshotsToCSV('COMBINED', combinedResult.monthlySnapshots, securities, accountDebugDir);
        exportTransactionsToCSV('COMBINED', transactions, securities, accountDebugDir);
        exportSummaryToText('COMBINED', combinedResult, accountDebugDir);
        exportTransactionLedger('COMBINED', combinedResult.monthlySnapshots, transactions, securities, accountDebugDir);
      } catch (debugError) {
        console.error(`Error exporting debug files:`, debugError);
      }
    }

    // Use combined result as our single result
    const results = [combinedResult];

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
        let monthlyPortfolioValue = 0;
        let totalBenchmarkValue = 0;
        let monthDate = results[0].monthlySnapshots[i].date;

        for (const result of results) {
          if (i < result.monthlySnapshots.length) {
            monthlyPortfolioValue += result.monthlySnapshots[i].totalValue;
            // TODO: Add benchmark value when available
          }
        }

        // Calculate return from previous month
        const prevMonthValue = i > 0 ? monthlyAnalysis[i - 1].portfolioValue : totalStartValue;
        const monthReturn = ((monthlyPortfolioValue - prevMonthValue) / prevMonthValue) * 100;

        // Format date as MM-DD-YYYY (convert from YYYY-MM-DD)
        const dateParts = monthDate.split('-');
        const formattedDate = `${dateParts[1]}-${dateParts[2]}-${dateParts[0]}`;

        monthlyAnalysis.push({
          month: formattedDate,
          portfolioReturn: monthReturn,
          portfolioValue: monthlyPortfolioValue,
          benchmarkReturn: 0, // TODO: calculate from benchmark snapshots
          benchmarkValue: 0,
        });
      }
    }

    // Calculate portfolio allocation from FINAL SNAPSHOT (not current Plaid holdings)
    // This ensures holdings match the final month-end portfolio value shown in monthly analysis
    const holdingsDetailMap: { [ticker: string]: { quantity: number; value: number; price: number } } = {};
    let totalCashValue = 0;

    // Aggregate final positions from all accounts' last snapshots
    for (const result of results) {
      const lastSnapshot = result.monthlySnapshots[result.monthlySnapshots.length - 1];
      if (lastSnapshot) {
        // Add cash from this account's final snapshot
        totalCashValue += lastSnapshot.cash;

        // Add positions from this account's final snapshot
        for (const [securityId, position] of lastSnapshot.positions) {
          const security = securities.get(securityId);
          const ticker = security?.ticker_symbol || security?.name || securityId;

          // Check if this security is cash equivalent
          if (security?.is_cash_equivalent) {
            totalCashValue += position.value;
          } else {
            if (!holdingsDetailMap[ticker]) {
              holdingsDetailMap[ticker] = { quantity: 0, value: 0, price: position.price };
            }
            holdingsDetailMap[ticker].quantity += position.quantity;
            holdingsDetailMap[ticker].value += position.value;
          }
        }
      }
    }

    // Total portfolio value = totalEndValue (already calculated from snapshots)
    const totalPortfolioValue = totalEndValue;

    // Build portfolioAllocation (percentages only - for backward compatibility)
    const portfolioAllocation: { [ticker: string]: number } = {};
    if (totalPortfolioValue > 0) {
      for (const ticker in holdingsDetailMap) {
        portfolioAllocation[ticker] = (holdingsDetailMap[ticker].value / totalPortfolioValue) * 100;
      }
    }

    // Build detailed holdings array for PDF
    const holdingsDetails = Object.entries(holdingsDetailMap)
      .map(([ticker, data]) => ({
        ticker,
        quantity: data.quantity,
        price: data.price,
        value: data.value,
        percentage: totalPortfolioValue > 0 ? (data.value / totalPortfolioValue) * 100 : 0
      }))
      .sort((a, b) => b.value - a.value);

    // Cash percentage of total portfolio
    const cashPercentage = totalPortfolioValue > 0 ? (totalCashValue / totalPortfolioValue) * 100 : 0;

    // Build ACTUAL PLAID holdings for reconciliation (current real-time data)
    const plaidHoldingsMap: { [ticker: string]: { quantity: number; value: number; price: number } } = {};
    let plaidCashValue = 0;
    let plaidTotalValue = 0;

    for (const holding of holdings) {
      plaidTotalValue += holding.institution_value;
      const security = securities.get(holding.security_id);
      if (security?.is_cash_equivalent) {
        plaidCashValue += holding.institution_value;
      } else {
        const ticker = security?.ticker_symbol || security?.name || holding.security_id;
        if (!plaidHoldingsMap[ticker]) {
          plaidHoldingsMap[ticker] = { quantity: 0, value: 0, price: holding.institution_price };
        }
        plaidHoldingsMap[ticker].quantity += holding.quantity;
        plaidHoldingsMap[ticker].value += holding.institution_value;
      }
    }

    const plaidHoldings = Object.entries(plaidHoldingsMap)
      .map(([ticker, data]) => ({
        ticker,
        quantity: data.quantity,
        price: data.price,
        value: data.value,
        percentage: plaidTotalValue > 0 ? (data.value / plaidTotalValue) * 100 : 0
      }))
      .sort((a, b) => b.value - a.value);

    const plaidCashPercentage = plaidTotalValue > 0 ? (plaidCashValue / plaidTotalValue) * 100 : 0;

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
      holdingsDetails,
      holdingsAsOfDate: formatDateToMMDDYYYY(firstResult.endDate),
      cashHoldings: { value: totalCashValue, percentage: cashPercentage },
      // Actual Plaid holdings for reconciliation
      plaidHoldings,
      plaidCashHoldings: { value: plaidCashValue, percentage: plaidCashPercentage },
      plaidTotalValue,
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
