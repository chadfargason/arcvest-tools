/**
 * Portfolio X-Ray - Analysis API Route
 *
 * Receives Plaid data and returns portfolio analysis results.
 */

import { NextRequest, NextResponse } from 'next/server';
import { parsePlaidData } from '@/lib/portfolio-x-ray/plaid-parser';
import { PortfolioAnalyzer } from '@/lib/portfolio-x-ray/portfolio-analyzer';
import { formatDateDisplay } from '@/lib/portfolio-x-ray/date-utils';
import { calculateFeesByAccount } from '@/lib/portfolio-x-ray/fee-calculator';
import {
  AnalysisResponse,
  MonthlyAnalysis,
  HoldingDetail,
  Security,
  Holding,
  Transaction,
  PortfolioResult,
  SecurityLedger,
} from '@/lib/portfolio-x-ray/types';
import { buildSecurityLedgers, buildCashLedger } from '@/lib/portfolio-x-ray/security-ledger';
import {
  exportSnapshotsToCSV,
  exportTransactionsToCSV,
  exportSummaryToText,
  exportTransactionLedger,
} from '@/lib/portfolio-x-ray/debug-export';
import { DEBUG_OUTPUT_DIR } from '@/lib/portfolio-x-ray/config';
import * as path from 'path';

export async function POST(request: NextRequest) {
  try {
    // Parse request body
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

    // Parse Plaid data using the new parser
    const { securities, holdings, transactions, accountIds } = parsePlaidData(
      holdingsData,
      transactionsData,
      securitiesData
    );

    console.log('Parsed data:', {
      transactions: transactions.length,
      holdings: holdings.length,
      securities: securities.size,
      accounts: accountIds.size,
    });

    if (accountIds.size === 0) {
      return NextResponse.json({ error: 'No accounts found' }, { status: 400 });
    }

    // Create analyzer and run analysis
    const analyzer = new PortfolioAnalyzer(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY,
      { debug: process.env.NODE_ENV === 'development' }
    );

    const result = await analyzer.analyze(holdings, transactions, securities);

    // Export debug files in development
    if (process.env.NODE_ENV === 'development') {
      try {
        const debugDir = path.join(DEBUG_OUTPUT_DIR, 'COMBINED');
        exportSnapshotsToCSV('COMBINED', result.monthlySnapshots, securities, debugDir);
        exportTransactionsToCSV('COMBINED', transactions, securities, debugDir);
        exportSummaryToText('COMBINED', result, debugDir);
        exportTransactionLedger('COMBINED', result.monthlySnapshots, transactions, securities, debugDir);
      } catch (debugError) {
        console.error('Error exporting debug files:', debugError);
      }
    }

    // Build API response
    const response = buildResponse(result, holdings, transactions, securities);

    console.log('\n=== Final Results ===');
    console.log('Total Return:', result.totalReturn.toFixed(2) + '%');
    console.log('Annualized Return:', result.annualizedReturn.toFixed(2) + '%');
    console.log('IRR:', result.irr ? result.irr.toFixed(2) + '%' : 'N/A');
    console.log('Benchmark Return:', result.benchmark.return.toFixed(2) + '%');
    console.log('Outperformance:', result.outperformance.toFixed(2) + '%');

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

/**
 * Build the API response from analysis results.
 */
function buildResponse(
  result: PortfolioResult,
  holdings: Holding[],
  transactions: Transaction[],
  securities: Map<string, Security>
): AnalysisResponse {
  // Build monthly analysis from snapshots
  const monthlyAnalysis: MonthlyAnalysis[] = [];
  const snapshots = result.monthlySnapshots;

  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i];
    const prevValue = i > 0 ? snapshots[i - 1].totalValue : result.startValue;
    const monthReturn = prevValue !== 0
      ? ((snapshot.totalValue - prevValue) / prevValue) * 100
      : 0;

    // Find matching benchmark data
    const benchmarkData = result.benchmark.monthlyData.find(b => b.month === snapshot.date);

    monthlyAnalysis.push({
      month: formatDateDisplay(snapshot.date),
      portfolioReturn: monthReturn,
      portfolioValue: snapshot.totalValue,
      benchmarkReturn: benchmarkData?.return || 0,
      benchmarkValue: benchmarkData?.value || 0,
    });
  }

  // Build holdings details from final snapshot
  const lastSnapshot = snapshots[snapshots.length - 1];
  const holdingsDetailMap: Record<string, { quantity: number; value: number; price: number }> = {};
  let totalCashValue = lastSnapshot?.cash || 0;

  if (lastSnapshot) {
    for (const [securityId, position] of lastSnapshot.positions) {
      const security = securities.get(securityId);
      const ticker = security?.ticker_symbol || security?.name || securityId;

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

  const totalPortfolioValue = result.endValue;

  // Portfolio allocation (percentages)
  const portfolioAllocation: Record<string, number> = {};
  if (totalPortfolioValue > 0) {
    for (const ticker in holdingsDetailMap) {
      portfolioAllocation[ticker] = (holdingsDetailMap[ticker].value / totalPortfolioValue) * 100;
    }
  }

  // Holdings details array
  const holdingsDetails: HoldingDetail[] = Object.entries(holdingsDetailMap)
    .map(([ticker, data]) => ({
      ticker,
      quantity: data.quantity,
      price: data.price,
      value: data.value,
      percentage: totalPortfolioValue > 0 ? (data.value / totalPortfolioValue) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  const cashPercentage = totalPortfolioValue > 0
    ? (totalCashValue / totalPortfolioValue) * 100
    : 0;

  // Build Plaid holdings (current real-time data for reconciliation)
  const plaidHoldingsMap: Record<string, { quantity: number; value: number; price: number }> = {};
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

  const plaidHoldings: HoldingDetail[] = Object.entries(plaidHoldingsMap)
    .map(([ticker, data]) => ({
      ticker,
      quantity: data.quantity,
      price: data.price,
      value: data.value,
      percentage: plaidTotalValue > 0 ? (data.value / plaidTotalValue) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  const plaidCashPercentage = plaidTotalValue > 0
    ? (plaidCashValue / plaidTotalValue) * 100
    : 0;

  // Benchmark weights (convert Map to object)
  const benchmarkWeights: Record<string, number> = {};
  for (const [ticker, weight] of result.benchmark.weights) {
    benchmarkWeights[ticker] = weight;
  }

  // Cashflow details
  const cashflowDetails: Array<{ date: string; amount: number; type: 'START' | 'CONTRIBUTION' | 'WITHDRAWAL' | 'END' }> = [
    { date: result.startDate, amount: -result.startValue, type: 'START' },
    ...result.externalCashflows.map(cf => ({
      date: cf.date,
      amount: cf.amount,
      type: cf.amount < 0 ? 'CONTRIBUTION' as const : 'WITHDRAWAL' as const,
    })),
    { date: result.endDate, amount: result.endValue, type: 'END' },
  ];

  // Fees by account
  const feesByAccount = calculateFeesByAccount(transactions);

  // All transactions for PDF
  const allTransactions = transactions.map(tx => {
    const security = tx.security_id ? securities.get(tx.security_id) : null;
    return {
      ...tx,
      security: security?.ticker_symbol || security?.name || 'Cash/Other',
    };
  }).sort((a, b) => b.date.localeCompare(a.date));

  // Calculate period months
  const startDate = new Date(result.startDate);
  const endDate = new Date(result.endDate);
  const months = (endDate.getFullYear() - startDate.getFullYear()) * 12 +
    (endDate.getMonth() - startDate.getMonth());

  // Build security ledgers for debugging
  const securityLedgers = buildSecurityLedgers(snapshots, transactions, securities);
  const cashLedger = buildCashLedger(snapshots, transactions, securities);

  return {
    monthlyAnalysis,
    summary: {
      portfolioTotalReturn: result.totalReturn,
      portfolioAnnualizedReturn: result.annualizedReturn,
      benchmarkTotalReturn: result.benchmark.return,
      benchmarkAnnualizedReturn: result.benchmark.return,
      outperformance: result.outperformance,
      irr: result.irr ?? undefined,
      benchmarkIrr: result.benchmark.irr ?? undefined,
      benchmarkEndValue: result.benchmark.endValue,
      periodMonths: months,
      startDate: formatDateDisplay(result.startDate),
      endDate: formatDateDisplay(result.endDate),
      startValue: result.startValue,
      endValue: result.endValue,
    },
    fees: {
      totalFees: result.fees.totalFees,
      explicitFees: result.fees.explicitFees,
      implicitFees: result.fees.implicitFees,
      feesByType: result.fees.feesByType,
      feesByAccount,
      feeTransactions: result.fees.feeTransactions,
    },
    portfolioAllocation,
    holdingsDetails,
    holdingsAsOfDate: formatDateDisplay(result.endDate),
    cashHoldings: { value: totalCashValue, percentage: cashPercentage },
    plaidHoldings,
    plaidCashHoldings: { value: plaidCashValue, percentage: plaidCashPercentage },
    plaidTotalValue,
    benchmarkWeights,
    cashflowDetails,
    benchmarkMonthlyDetails: result.benchmark.monthlyData,
    holdings: holdings.length,
    transactions: transactions.length,
    allTransactions,
    securityLedgers,
    cashLedger,
    debug: {
      startValue: result.startValue,
      endValue: result.endValue,
      snapshotCount: snapshots.length,
      externalCashflows: result.externalCashflows.length,
    },
  };
}
