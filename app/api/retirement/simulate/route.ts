import { NextRequest, NextResponse } from 'next/server';

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
  allocation: Record<string, number>;
  stockReturn: number;
  stockVolatility: number;
  bondReturn: number;
  bondVolatility: number;
  correlation: number;
  degreesOfFreedom: number;
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

    // Run Monte Carlo simulation
    const results = runMonteCarloSimulation(params);

    return NextResponse.json(results);
  } catch (error) {
    console.error('Simulation error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Simulation failed' 
    }, { status: 500 });
  }
}

function runMonteCarloSimulation(params: SimulationParams): any {
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
    allocation,
    stockReturn,
    stockVolatility,
    bondReturn,
    bondVolatility,
    correlation,
    degreesOfFreedom
  } = params;

  // Calculate time periods
  const yearsToRetirement = retirementAge - currentAge;
  const totalYears = yearsToRetirement + yearsInRetirement;
  const monthsTotal = totalYears * 12;

  // Normalize allocation to decimals
  const stockAllocation = allocation['STOCKS'] / 100;
  const bondAllocation = allocation['BONDS'] / 100;

  // Convert annual parameters to monthly
  const monthlyStockReturn = stockReturn / 12;
  const monthlyBondReturn = bondReturn / 12;
  const monthlyStockVol = stockVolatility / Math.sqrt(12);
  const monthlyBondVol = bondVolatility / Math.sqrt(12);

  // Run simulations - keep track of simulation index
  const scenarios: { index: number; balances: number[]; returns: { stock: number[]; bond: number[] } }[] = [];
  const finalBalances: { index: number; balance: number }[] = [];

  for (let sim = 0; sim < simulationCount; sim++) {
    const scenarioData = runSingleScenario(
      startingBalance,
      monthsTotal,
      yearsToRetirement * 12,
      annualContribution,
      contributionGrowth,
      yearsContributing * 12,
      annualWithdrawal,
      withdrawalInflation,
      stockAllocation,
      bondAllocation,
      monthlyStockReturn,
      monthlyStockVol,
      monthlyBondReturn,
      monthlyBondVol,
      correlation,
      rebalancing === 'annual',
      degreesOfFreedom
    );

    scenarios.push({
      index: sim,
      balances: scenarioData.balances,
      returns: scenarioData.returns
    });
    
    finalBalances.push({
      index: sim,
      balance: scenarioData.balances[scenarioData.balances.length - 1]
    });
  }

  // Calculate statistics
  const successCount = finalBalances.filter(b => b.balance > 0).length;
  const successRate = successCount / simulationCount;

  // Sort final balances for percentiles
  const sortedBalances = [...finalBalances].sort((a, b) => a.balance - b.balance);
  const medianIndex = sortedBalances[Math.floor(simulationCount / 2)].index;
  const medianBalance = sortedBalances[Math.floor(simulationCount / 2)].balance;
  const percentile10 = sortedBalances[Math.floor(simulationCount * 0.1)].balance;
  const percentile90 = sortedBalances[Math.floor(simulationCount * 0.9)].balance;

  // Calculate percentile paths (sample annually)
  const years: number[] = [];
  const medianPath: number[] = [];
  const percentile10Path: number[] = [];
  const percentile90Path: number[] = [];

  for (let year = 0; year <= totalYears; year++) {
    const monthIndex = Math.min(year * 12, monthsTotal - 1);
    years.push(currentAge + year);

    // Get balances at this time point across all scenarios
    const balancesAtTime = scenarios.map(s => s.balances[monthIndex]).sort((a, b) => a - b);
    
    medianPath.push(balancesAtTime[Math.floor(simulationCount / 2)]);
    percentile10Path.push(balancesAtTime[Math.floor(simulationCount * 0.1)]);
    percentile90Path.push(balancesAtTime[Math.floor(simulationCount * 0.9)]);
  }

  // Create distribution histogram
  const { labels, counts } = createDistribution(sortedBalances.map(b => b.balance));

  // Get the actual median simulation details
  const medianSimulation = scenarios.find(s => s.index === medianIndex)!;
  const medianSimulationDetails = generateYearlyBreakdown(
    medianSimulation.balances,
    medianSimulation.returns,
    currentAge,
    yearsToRetirement,
    annualContribution,
    contributionGrowth,
    annualWithdrawal,
    withdrawalInflation,
    yearsContributing * 12 // Convert to months
  );

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
    distributionCounts: counts,
    medianSimulationIndex: medianIndex,
    medianSimulationDetails
  };
}

function generateYearlyBreakdown(
  monthlyBalances: number[],
  monthlyReturns: { stock: number[]; bond: number[] },
  startAge: number,
  yearsToRetirement: number,
  annualContribution: number,
  contributionGrowth: number,
  annualWithdrawal: number,
  withdrawalInflation: number,
  monthsContributing: number
): any[] {
  const totalYears = Math.floor(monthlyBalances.length / 12);
  const yearData = [];
  
  let currentContribution = annualContribution / 12;
  
  // Inflation-adjust the withdrawal amount from the start (same as simulation)
  const inflationAdjustedAnnualWithdrawal = annualWithdrawal * Math.pow(1 + withdrawalInflation, yearsToRetirement);
  let currentWithdrawal = inflationAdjustedAnnualWithdrawal / 12;
  const monthsToRetirement = yearsToRetirement * 12;
  
  for (let year = 0; year <= totalYears; year++) {
    const age = startAge + year;
    const isRetired = year > yearsToRetirement;
    const startMonthIndex = year * 12;
    const endMonthIndex = Math.min((year + 1) * 12 - 1, monthlyBalances.length - 1);
    
    const startBalance = monthlyBalances[startMonthIndex];
    const endBalance = monthlyBalances[endMonthIndex];
    
    // Sum up returns for the year and track monthly details
    let yearlyStockReturn = 0;
    let yearlyBondReturn = 0;
    let annualContributionTotal = 0;
    let annualWithdrawalTotal = 0;
    const monthlyDetails = [];
    
    for (let month = 0; month < 12 && startMonthIndex + month < monthlyReturns.stock.length; month++) {
      const monthIndex = startMonthIndex + month;
      const monthNum = monthIndex;
      
      const stockRet = monthlyReturns.stock[monthIndex];
      const bondRet = monthlyReturns.bond[monthIndex];
      yearlyStockReturn += stockRet;
      yearlyBondReturn += bondRet;
      
      let monthContribution = 0;
      let monthWithdrawal = 0;
      
      if (monthNum <= monthsToRetirement) {
        if (monthNum <= monthsContributing) {
          monthContribution = currentContribution;
          annualContributionTotal += currentContribution;
        }
      } else if (isRetired) {
        monthWithdrawal = currentWithdrawal;
        annualWithdrawalTotal += currentWithdrawal;
      }
      
      // Store monthly details
      monthlyDetails.push({
        month: month + 1,
        monthName: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month],
        balance: monthlyBalances[monthIndex],
        stockReturn: (stockRet * 100).toFixed(2) + '%',
        bondReturn: (bondRet * 100).toFixed(2) + '%',
        contribution: monthContribution,
        withdrawal: monthWithdrawal
      });
    }
    
    // Calculate investment returns (approximate)
    const investmentReturns = endBalance - startBalance - annualContributionTotal + annualWithdrawalTotal;
    
    yearData.push({
      year,
      age,
      phase: isRetired ? 'Retirement' : 'Accumulation',
      startBalance,
      contributions: annualContributionTotal,
      withdrawals: annualWithdrawalTotal,
      returns: investmentReturns,
      stockReturn: (yearlyStockReturn * 100).toFixed(2) + '%',
      bondReturn: (yearlyBondReturn * 100).toFixed(2) + '%',
      endBalance,
      netChange: endBalance - startBalance,
      monthlyDetails  // ← Include monthly data
    });
    
    // Update contribution/withdrawal for next year
    if (!isRetired) {
      currentContribution *= (1 + contributionGrowth);
    }
    if (isRetired && year > yearsToRetirement) {
      currentWithdrawal *= (1 + withdrawalInflation);
    }
  }
  
  return yearData;
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
  stockAllocation: number,
  bondAllocation: number,
  monthlyStockReturn: number,
  monthlyStockVol: number,
  monthlyBondReturn: number,
  monthlyBondVol: number,
  correlation: number,
  rebalance: boolean,
  degreesOfFreedom: number
): { balances: number[]; returns: { stock: number[]; bond: number[] } } {
  const balances: number[] = [startingBalance];
  const stockReturns: number[] = [0]; // First month has no return
  const bondReturns: number[] = [0];
  
  let balance = startingBalance;

  // Asset balances (for rebalancing)
  let stockBalance = balance * stockAllocation;
  let bondBalance = balance * bondAllocation;

  let currentContribution = annualContribution / 12;
  
  // Inflation-adjust the withdrawal amount from the start
  // At retirement, withdrawal should be: baseAmount × (1 + inflation)^yearsToRetirement
  const yearsUntilRetirement = monthsToRetirement / 12;
  const inflationAdjustedAnnualWithdrawal = annualWithdrawal * Math.pow(1 + withdrawalInflation, yearsUntilRetirement);
  let currentWithdrawal = inflationAdjustedAnnualWithdrawal / 12;

  for (let month = 1; month < monthsTotal; month++) {
    // Generate correlated returns using Cholesky decomposition
    // Now with Student's t-distribution for fat tails
    const [stockReturn, bondReturn] = generateCorrelatedReturns(
      monthlyStockReturn,
      monthlyStockVol,
      monthlyBondReturn,
      monthlyBondVol,
      correlation,
      degreesOfFreedom
    );

    // Track returns
    stockReturns.push(stockReturn);
    bondReturns.push(bondReturn);

    // Apply returns to each asset
    stockBalance *= (1 + stockReturn);
    bondBalance *= (1 + bondReturn);

    // Sum up portfolio
    balance = stockBalance + bondBalance;

    // Apply contributions/withdrawals
    if (month <= monthsToRetirement) {
      // Accumulation phase
      if (month <= monthsContributing) {
        balance += currentContribution;
        
        // Add contribution proportionally to assets
        stockBalance += currentContribution * stockAllocation;
        bondBalance += currentContribution * bondAllocation;

        // Adjust contribution for growth (annually)
        if (month % 12 === 0) {
          currentContribution *= (1 + contributionGrowth);
        }
      }
    } else {
      // Withdrawal phase
      balance -= currentWithdrawal;

      // Withdraw proportionally from assets
      stockBalance -= currentWithdrawal * stockAllocation;
      bondBalance -= currentWithdrawal * bondAllocation;

      // Adjust withdrawal for inflation (annually)
      if (month % 12 === 0) {
        currentWithdrawal *= (1 + withdrawalInflation);
      }
    }

    // Rebalance annually if enabled
    if (rebalance && month % 12 === 0 && balance > 0) {
      stockBalance = balance * stockAllocation;
      bondBalance = balance * bondAllocation;
    }

    // Prevent negative balances in tracking
    if (balance < 0) {
      balance = 0;
      stockBalance = 0;
      bondBalance = 0;
    }

    balances.push(balance);
  }

  return {
    balances,
    returns: {
      stock: stockReturns,
      bond: bondReturns
    }
  };
}

// Generate correlated random variables using Cholesky decomposition
// Now supports Student's t-distribution for fat tails
function generateCorrelatedReturns(
  mean1: number,
  std1: number,
  mean2: number,
  std2: number,
  correlation: number,
  degreesOfFreedom: number
): [number, number] {
  // Generate two independent random variables
  // Use t-distribution if df < 30, otherwise use normal (converges to normal at high df)
  const z1 = degreesOfFreedom < 30 ? randomT(degreesOfFreedom) : randomNormal();
  const z2 = degreesOfFreedom < 30 ? randomT(degreesOfFreedom) : randomNormal();

  // Apply Cholesky decomposition for correlation
  // For 2x2 correlation matrix:
  // [1    ρ  ]     [1      0    ]
  // [ρ    1  ]  =  [ρ   √(1-ρ²)]
  
  const return1 = mean1 + std1 * z1;
  const return2 = mean2 + std2 * (correlation * z1 + Math.sqrt(1 - correlation * correlation) * z2);

  return [return1, return2];
}

// Generate Student's t-distributed random variable
// Lower df = fatter tails (more realistic for finance)
function randomT(df: number): number {
  // Generate standard normal
  const z = randomNormal();
  
  // Generate chi-squared with df degrees of freedom
  // Chi-squared is sum of df squared standard normals
  let chiSq = 0;
  for (let i = 0; i < df; i++) {
    const n = randomNormal();
    chiSq += n * n;
  }
  
  // t-distribution = Z / sqrt(χ²/df)
  // Scale to have unit variance: multiply by sqrt((df-2)/df)
  if (df > 2) {
    return z / Math.sqrt(chiSq / df) * Math.sqrt((df - 2) / df);
  } else {
    // For df <= 2, variance is undefined, so just return unscaled
    return z / Math.sqrt(chiSq / df);
  }
}

// Box-Muller transform for generating standard normal random variables
function randomNormal(): number {
  let u1 = 0, u2 = 0;
  // Ensure u1 is not 0 to avoid log(0)
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z;
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
