import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_KEY!;

interface SimulationParams {
  startingBalance: number;
  currentAge: number;
  retirementAge: number;
  annualContribution: number;
  contributionGrowth: number;
  yearsContributing: number;
  annualWithdrawal: number;
  withdrawalInflation: number;
  yearsInRetirement: number;
  simulationCount: number;
  rebalancing: string;
  returnMethod: string;
  allocation: Record<string, number>;
}

interface AssetReturn {
  asset_ticker: string;
  return_date: string;
  monthly_return: number;
}

export async function POST(request: NextRequest) {
  try {
    const params: SimulationParams = await request.json();

    // Validate inputs
    if (!params.allocation || Object.keys(params.allocation).length === 0) {
      return NextResponse.json({ error: 'Asset allocation required' }, { status: 400 });
    }

    const totalAllocation = Object.values(params.allocation).reduce((sum, val) => sum + val, 0);
    if (Math.abs(totalAllocation - 100) > 0.01) {
      return NextResponse.json({ error: 'Allocation must total 100%' }, { status: 400 });
    }

    // Fetch historical return data from Supabase
    const supabase = createClient(supabaseUrl, supabaseKey);
    const tickers = Object.keys(params.allocation);
    
    const { data: assetReturns, error } = await supabase
      .from('asset_returns')
      .select('asset_ticker, return_date, monthly_return')
      .in('asset_ticker', tickers)
      .order('return_date', { ascending: true });

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ error: 'Failed to fetch asset data' }, { status: 500 });
    }

    if (!assetReturns || assetReturns.length === 0) {
      return NextResponse.json({ error: 'No return data found for specified assets' }, { status: 404 });
    }

    // Organize returns by asset
    const returnsByAsset: Record<string, number[]> = {};
    tickers.forEach(ticker => {
      returnsByAsset[ticker] = assetReturns
        .filter((r: AssetReturn) => r.asset_ticker === ticker)
        .map((r: AssetReturn) => r.monthly_return);
    });

    // Validate we have data for all assets
    for (const ticker of tickers) {
      if (!returnsByAsset[ticker] || returnsByAsset[ticker].length === 0) {
        return NextResponse.json({ 
          error: `No return data found for ${ticker}` 
        }, { status: 404 });
      }
    }

    // Run Monte Carlo simulation
    const results = runMonteCarloSimulation(params, returnsByAsset);

    return NextResponse.json(results);
  } catch (error) {
    console.error('Simulation error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Simulation failed' 
    }, { status: 500 });
  }
}

function runMonteCarloSimulation(
  params: SimulationParams,
  returnsByAsset: Record<string, number[]>
): any {
  const {
    startingBalance,
    currentAge,
    retirementAge,
    annualContribution,
    contributionGrowth,
    yearsContributing,
    annualWithdrawal,
    withdrawalInflation,
    yearsInRetirement,
    simulationCount,
    rebalancing,
    returnMethod,
    allocation
  } = params;

  // Calculate time periods
  const yearsToRetirement = retirementAge - currentAge;
  const totalYears = yearsToRetirement + yearsInRetirement;
  const monthsTotal = totalYears * 12;

  // Normalize allocation to decimals
  const normalizedAllocation: Record<string, number> = {};
  Object.entries(allocation).forEach(([ticker, percent]) => {
    normalizedAllocation[ticker] = percent / 100;
  });

  // Run simulations
  const scenarios: number[][] = [];
  const finalBalances: number[] = [];

  for (let sim = 0; sim < simulationCount; sim++) {
    const balances = runSingleScenario(
      startingBalance,
      monthsTotal,
      yearsToRetirement * 12,
      annualContribution,
      contributionGrowth,
      yearsContributing * 12,
      annualWithdrawal,
      withdrawalInflation,
      normalizedAllocation,
      returnsByAsset,
      returnMethod,
      rebalancing === 'annual'
    );

    scenarios.push(balances);
    finalBalances.push(balances[balances.length - 1]);
  }

  // Calculate statistics
  const successCount = finalBalances.filter(b => b > 0).length;
  const successRate = successCount / simulationCount;

  // Sort final balances for percentiles
  const sortedBalances = [...finalBalances].sort((a, b) => a - b);
  const medianBalance = sortedBalances[Math.floor(simulationCount / 2)];
  const percentile10 = sortedBalances[Math.floor(simulationCount * 0.1)];
  const percentile90 = sortedBalances[Math.floor(simulationCount * 0.9)];

  // Calculate percentile paths (sample annually)
  const years: number[] = [];
  const medianPath: number[] = [];
  const percentile10Path: number[] = [];
  const percentile90Path: number[] = [];

  for (let year = 0; year <= totalYears; year++) {
    const monthIndex = Math.min(year * 12, monthsTotal - 1);
    years.push(currentAge + year);

    // Get balances at this time point across all scenarios
    const balancesAtTime = scenarios.map(s => s[monthIndex]).sort((a, b) => a - b);
    
    medianPath.push(balancesAtTime[Math.floor(simulationCount / 2)]);
    percentile10Path.push(balancesAtTime[Math.floor(simulationCount * 0.1)]);
    percentile90Path.push(balancesAtTime[Math.floor(simulationCount * 0.9)]);
  }

  // Create distribution histogram
  const { labels, counts } = createDistribution(sortedBalances);

  return {
    successRate,
    medianBalance,
    percentile10,
    percentile90,
    years,
    medianPath,
    percentile10Path,
    percentile90Path,
    distributionLabels: labels,
    distributionCounts: counts
  };
}

function runSingleScenario(
  startingBalance: number,
  monthsTotal: number,
  monthsToRetirement: number,
  annualContribution: number,
  contributionGrowth: number,
  monthsContributing: number,
  annualWithdrawal: number,
  withdrawalInflation: number,
  allocation: Record<string, number>,
  returnsByAsset: Record<string, number[]>,
  returnMethod: string,
  rebalance: boolean
): number[] {
  const balances: number[] = [startingBalance];
  let balance = startingBalance;

  // Asset balances (for rebalancing)
  const assetBalances: Record<string, number> = {};
  Object.entries(allocation).forEach(([ticker, weight]) => {
    assetBalances[ticker] = balance * weight;
  });

  let currentContribution = annualContribution / 12;
  let currentWithdrawal = annualWithdrawal / 12;

  for (let month = 1; month < monthsTotal; month++) {
    // Apply returns to each asset
    Object.entries(assetBalances).forEach(([ticker, assetBalance]) => {
      const returns = returnsByAsset[ticker];
      let monthlyReturn: number;

      if (returnMethod === 'historical') {
        // Bootstrap: random sample with replacement
        monthlyReturn = returns[Math.floor(Math.random() * returns.length)];
      } else {
        // Average return
        monthlyReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      }

      assetBalances[ticker] = assetBalance * (1 + monthlyReturn);
    });

    // Sum up portfolio
    balance = Object.values(assetBalances).reduce((sum, val) => sum + val, 0);

    // Apply contributions/withdrawals
    if (month <= monthsToRetirement) {
      // Accumulation phase
      if (month <= monthsContributing) {
        balance += currentContribution;
        
        // Add contribution proportionally to assets
        Object.entries(allocation).forEach(([ticker, weight]) => {
          assetBalances[ticker] += currentContribution * weight;
        });

        // Adjust contribution for growth (annually)
        if (month % 12 === 0) {
          currentContribution *= (1 + contributionGrowth);
        }
      }
    } else {
      // Withdrawal phase
      balance -= currentWithdrawal;

      // Withdraw proportionally from assets
      Object.entries(allocation).forEach(([ticker, weight]) => {
        assetBalances[ticker] -= currentWithdrawal * weight;
      });

      // Adjust withdrawal for inflation (annually)
      if (month % 12 === 0) {
        currentWithdrawal *= (1 + withdrawalInflation);
      }
    }

    // Rebalance annually if enabled
    if (rebalance && month % 12 === 0 && balance > 0) {
      Object.entries(allocation).forEach(([ticker, weight]) => {
        assetBalances[ticker] = balance * weight;
      });
    }

    // Prevent negative balances in tracking
    if (balance < 0) {
      balance = 0;
      Object.keys(assetBalances).forEach(ticker => {
        assetBalances[ticker] = 0;
      });
    }

    balances.push(balance);
  }

  return balances;
}

function createDistribution(sortedBalances: number[]): { labels: string[], counts: number[] } {
  // Create histogram bins
  const min = Math.min(...sortedBalances);
  const max = Math.max(...sortedBalances);
  const range = max - min;
  const binCount = 20;
  const binSize = range / binCount;

  const bins: number[] = new Array(binCount).fill(0);
  const labels: string[] = [];

  // Create labels
  for (let i = 0; i < binCount; i++) {
    const binStart = min + i * binSize;
    const binEnd = binStart + binSize;
    
    if (binStart < 0 && binEnd < 0) {
      labels.push(`-$${Math.abs(binEnd / 1000).toFixed(0)}K to -$${Math.abs(binStart / 1000).toFixed(0)}K`);
    } else if (binStart < 0 && binEnd >= 0) {
      labels.push(`-$${Math.abs(binStart / 1000).toFixed(0)}K to $${(binEnd / 1000).toFixed(0)}K`);
    } else if (binStart >= 1000000) {
      labels.push(`$${(binStart / 1000000).toFixed(1)}M to $${(binEnd / 1000000).toFixed(1)}M`);
    } else {
      labels.push(`$${(binStart / 1000).toFixed(0)}K to $${(binEnd / 1000).toFixed(0)}K`);
    }
  }

  // Count balances in each bin
  sortedBalances.forEach(balance => {
    const binIndex = Math.min(Math.floor((balance - min) / binSize), binCount - 1);
    bins[binIndex]++;
  });

  return { labels, counts: bins };
}

