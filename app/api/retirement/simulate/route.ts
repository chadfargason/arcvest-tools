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
  const scenarios: { 
    index: number; 
    balances: number[]; 
    returns: { stock: number[]; bond: number[] };
    stockBalances: number[];
    bondBalances: number[];
  }[] = [];
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
      returns: scenarioData.returns,
      stockBalances: scenarioData.stockBalances,
      bondBalances: scenarioData.bondBalances
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
  const percentile20 = sortedBalances[Math.floor(simulationCount * 0.2)].balance;
  const percentile80 = sortedBalances[Math.floor(simulationCount * 0.8)].balance;

  // Calculate percentile paths (sample annually)
  const years: number[] = [];
  const medianPath: number[] = [];
  const percentile20Path: number[] = [];
  const percentile80Path: number[] = [];

  for (let year = 0; year <= totalYears; year++) {
    const monthIndex = Math.min(year * 12, monthsTotal - 1);
    years.push(currentAge + year);

    // Get balances at this time point across all scenarios
    const balancesAtTime = scenarios.map(s => s.balances[monthIndex]).sort((a, b) => a - b);
    
    medianPath.push(balancesAtTime[Math.floor(simulationCount / 2)]);
    percentile20Path.push(balancesAtTime[Math.floor(simulationCount * 0.2)]);
    percentile80Path.push(balancesAtTime[Math.floor(simulationCount * 0.8)]);
  }

  // Create distribution histogram
  const { labels, percentages } = createDistribution(sortedBalances.map(b => b.balance));

  // Get the actual median simulation details
  const medianSimulation = scenarios.find(s => s.index === medianIndex)!;
  const medianSimulationDetails = generateYearlyBreakdown(
    medianSimulation.balances,
    medianSimulation.returns,
    medianSimulation.stockBalances,
    medianSimulation.bondBalances,
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
    percentile20,
    percentile80,
    years,
    medianPath,
    percentile20Path,
    percentile80Path,
    distributionLabels: labels,
    distributionPercentages: percentages,
    medianSimulationIndex: medianIndex,
    medianSimulationDetails
  };
}

function generateYearlyBreakdown(
  monthlyBalances: number[],
  monthlyReturns: { stock: number[]; bond: number[] },
  monthlyStockBalances: number[],
  monthlyBondBalances: number[],
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
      
      // Calculate monthly start balance (balance before this month's changes)
      const monthStartBalance = monthIndex > 0 ? monthlyBalances[monthIndex - 1] : startBalance;
      const monthEndBalance = monthlyBalances[monthIndex];
      
      // Get actual stock and bond balances at this point
      const monthStartStockBalance = monthIndex > 0 ? monthlyStockBalances[monthIndex - 1] : startBalance * (monthlyStockBalances[0] / startBalance);
      const monthStartBondBalance = monthIndex > 0 ? monthlyBondBalances[monthIndex - 1] : startBalance * (monthlyBondBalances[0] / startBalance);
      const monthEndStockBalance = monthlyStockBalances[monthIndex];
      const monthEndBondBalance = monthlyBondBalances[monthIndex];
      
      // Calculate investment returns for this month
      const monthReturns = monthEndBalance - monthStartBalance - monthContribution + monthWithdrawal;
      const monthNetChange = monthEndBalance - monthStartBalance;
      
      // Store monthly details with actual asset balances (both start and end)
      monthlyDetails.push({
        month: month + 1,
        monthName: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month],
        startBalance: monthStartBalance,
        balance: monthEndBalance,
        startStockBalance: monthStartStockBalance,  // ← START balance (for verification)
        startBondBalance: monthStartBondBalance,    // ← START balance (for verification)
        stockBalance: monthEndStockBalance,         // ← END balance (after returns + contributions)
        bondBalance: monthEndBondBalance,           // ← END balance (after returns + contributions)
        stockReturn: (stockRet * 100).toFixed(1) + '%',
        bondReturn: (bondRet * 100).toFixed(1) + '%',
        contribution: monthContribution,
        withdrawal: monthWithdrawal,
        returns: monthReturns,
        netChange: monthNetChange
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
      stockReturn: (yearlyStockReturn * 100).toFixed(1) + '%',
      bondReturn: (yearlyBondReturn * 100).toFixed(1) + '%',
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
): { balances: number[]; returns: { stock: number[]; bond: number[] }; stockBalances: number[]; bondBalances: number[] } {
  const balances: number[] = [startingBalance];
  const stockReturns: number[] = [];
  const bondReturns: number[] = [];
  
  let balance = startingBalance;

  // Asset balances (for rebalancing)
  let stockBalance = balance * stockAllocation;
  let bondBalance = balance * bondAllocation;
  
  // Track individual asset balances over time
  const stockBalances: number[] = [stockBalance];
  const bondBalances: number[] = [bondBalance];

  let currentContribution = annualContribution / 12;
  
  // Inflation-adjust the withdrawal amount from the start
  // At retirement, withdrawal should be: baseAmount × (1 + inflation)^yearsToRetirement
  const yearsUntilRetirement = monthsToRetirement / 12;
  const inflationAdjustedAnnualWithdrawal = annualWithdrawal * Math.pow(1 + withdrawalInflation, yearsUntilRetirement);
  let currentWithdrawal = inflationAdjustedAnnualWithdrawal / 12;

  for (let month = 0; month < monthsTotal; month++) {
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
    stockBalances.push(stockBalance);
    bondBalances.push(bondBalance);
  }

  return {
    balances,
    returns: {
      stock: stockReturns,
      bond: bondReturns
    },
    stockBalances,
    bondBalances
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

function createDistribution(sortedBalances: number[]): { labels: string[], percentages: number[] } {
  // Fixed distribution buckets (easy to modify)
  const BUCKET_EDGES = [
    0,           // $0 (ran out of money)
    200_000,     // $0 to $200k
    1_000_000,   // $200k to $1MM
    3_000_000,   // $1MM to $3MM
    10_000_000,  // $3MM to $10MM
    30_000_000,  // $10MM to $30MM
    Infinity     // $30MM+
  ];

  const labels = [
    '$0',
    '$0-$200K',
    '$200K-$1M',
    '$1M-$3M',
    '$3M-$10M',
    '$10M-$30M',
    '$30M+'
  ];

  const counts = new Array(labels.length).fill(0);
  const totalSimulations = sortedBalances.length;

  // Count balances in each bucket
  sortedBalances.forEach(balance => {
    if (balance <= 0) {
      counts[0]++; // $0 bucket
    } else if (balance <= BUCKET_EDGES[1]) {
      counts[1]++; // $0-$200K
    } else if (balance <= BUCKET_EDGES[2]) {
      counts[2]++; // $200K-$1M
    } else if (balance <= BUCKET_EDGES[3]) {
      counts[3]++; // $1M-$3M
    } else if (balance <= BUCKET_EDGES[4]) {
      counts[4]++; // $3M-$10M
    } else if (balance <= BUCKET_EDGES[5]) {
      counts[5]++; // $10M-$30M
    } else {
      counts[6]++; // $30M+
    }
  });

  // Convert to percentages
  const percentages = counts.map(count => (count / totalSimulations) * 100);

  return { labels, percentages };
}
