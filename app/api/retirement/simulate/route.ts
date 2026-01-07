import { NextRequest, NextResponse } from 'next/server';
import { HISTORICAL_RETURNS } from '../historical-returns-data';

interface SimulationParams {
  startingBalance: number;
  currentAge: number;
  retirementAge: number;
  annualContribution: number;
  contributionGrowth: number;
  yearsContributing: number;
  annualWithdrawal: number;
  withdrawalType?: 'fixed' | 'percentage'; // 'fixed' = dollar amount, 'percentage' = % of assets at retirement
  withdrawalPercentage?: number; // Used when withdrawalType is 'percentage' (e.g., 0.04 for 4%)
  guardrailBand?: number; // Guyton-Klinger guardrail band (e.g., 0.20 for ±20%)
  guardrailAdjustment?: number; // Adjustment when guardrail triggered (e.g., 0.10 for 10%)
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
  taxablePortion: number;
  taxRate: number;
  investmentFee: number;
  comparisonFee?: number; // Optional: if provided, run both fee scenarios in parallel
  simulationMode?: 'simple' | 'regime-switching'; // 'simple' = current skewed-t, 'regime-switching' = 3-state Markov
  historicalScenario?: string | null; // e.g., '1929-10', '2007-10', etc. If set, uses historical returns during retirement
}

// ============================================================================
// HISTORICAL RETURNS DATA
// ============================================================================
// Monthly total returns for S&P 500 (stocks) and aggregate bonds
// Data is imported from historical-returns-data.ts (generated from Supabase)
// Stock: ^SP500TR (S&P 500 Total Return) - 1927-01 to 2025-12
// Bond: LONG_BOND (through 2004) + AGG (2005+) - 1928-01 to 2025-12

interface HistoricalReturn {
  stock: number;
  bond: number;
  cpi?: number;  // Monthly inflation rate (for historical scenarios)
}

// Helper to get historical return for a given month
function getHistoricalReturn(year: number, month: number): HistoricalReturn | null {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  return HISTORICAL_RETURNS[key] || null;
}

// Get all available months for a scenario (sorted chronologically)
function getHistoricalMonthsForScenario(scenarioStartKey: string): string[] {
  const [startYear, startMonth] = scenarioStartKey.split('-').map(Number);
  const availableKeys = Object.keys(HISTORICAL_RETURNS).sort();

  // Filter to only include months from the start date onwards
  return availableKeys.filter(key => {
    const [year, month] = key.split('-').map(Number);
    return year > startYear || (year === startYear && month >= startMonth);
  });
}

// ============================================================================
// REGIME-SWITCHING MODEL DEFINITIONS
// ============================================================================
// Three-state Markov regime model for more realistic market dynamics:
// - Calm: Normal markets with negative stock/bond correlation (diversification works)
// - Crash: Flight-to-quality with stocks down, bonds up (2008-style)
// - Inflation: Both assets struggle, positive correlation (2022-style)

type RegimeState = 0 | 1 | 2; // 0=Calm, 1=Crash, 2=Inflation

interface RegimeParams {
  stockMean: number;      // Annual expected return
  stockVol: number;       // Annual volatility
  bondMean: number;       // Annual expected return
  bondVol: number;        // Annual volatility
  correlation: number;    // Stock/bond correlation
  df: number;             // Degrees of freedom for t-distribution
  stockSkew: number;      // Skewness for stocks
}

// Regime parameters (annualized) - calibrated to historical behavior
const REGIME_PARAMS: Record<RegimeState, RegimeParams> = {
  0: { // Calm / Low Inflation
    stockMean: 0.11,      // 11% annual return
    stockVol: 0.15,       // 15% volatility
    bondMean: 0.045,      // 4.5% annual return
    bondVol: 0.06,        // 6% volatility
    correlation: -0.25,   // Negative correlation (diversification works)
    df: 10,               // Moderate fat tails
    stockSkew: -0.20      // Mild negative skew
  },
  1: { // Crash / Flight-to-Quality
    stockMean: -0.20,     // -20% annual return (crisis)
    stockVol: 0.30,       // 30% volatility (high fear)
    bondMean: 0.10,       // 10% annual return (flight to safety)
    bondVol: 0.10,        // 10% volatility
    correlation: -0.60,   // Strong negative correlation (bonds hedge)
    df: 5,                // Very fat tails
    stockSkew: -0.50      // Strong negative skew (crashes)
  },
  2: { // Inflation Shock
    stockMean: 0.02,      // 2% annual return (struggling)
    stockVol: 0.22,       // 22% volatility (elevated)
    bondMean: -0.05,      // -5% annual return (duration losses)
    bondVol: 0.12,        // 12% volatility (rate volatility)
    correlation: 0.50,    // Positive correlation (both down together)
    df: 7,                // Fat tails
    stockSkew: -0.30      // Moderate negative skew
  }
};

// Markov transition matrix (monthly probabilities)
// Rows: current state, Columns: next state [Calm, Crash, Inflation]
// Calibrated for realistic regime persistence
const TRANSITION_MATRIX: number[][] = [
  [0.960, 0.035, 0.005],  // From Calm: mostly stays calm, small crash risk, rare inflation
  [0.300, 0.650, 0.050],  // From Crash: often recovers, can persist, rarely to inflation
  [0.200, 0.000, 0.800]   // From Inflation: can normalize, never direct to crash, often persists
];

// Starting regime probabilities (unconditional/stationary distribution approximation)
const INITIAL_REGIME_PROBS = [0.85, 0.10, 0.05]; // Mostly start in Calm

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
    withdrawalType = 'fixed',
    withdrawalPercentage = 0.04,
    guardrailBand = 0,
    guardrailAdjustment = 0,
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
    degreesOfFreedom,
    taxablePortion,
    taxRate,
    investmentFee,
    comparisonFee,
    simulationMode = 'simple',
    historicalScenario = null
  } = params;

  // Calculate time periods
  const yearsToRetirement = retirementAge - currentAge;
  const totalYears = yearsToRetirement + yearsInRetirement;
  const monthsTotal = totalYears * 12;

  // Normalize allocation to decimals (handle missing keys)
  const stockAllocation = (allocation['STOCKS'] ?? 0) / 100;
  const bondAllocation = (allocation['BONDS'] ?? 0) / 100;

  // Default investment fee to 0 if not provided (backwards compatibility)
  const finalInvestmentFee = investmentFee ?? 0;

  // Convert annual parameters to monthly
  const monthlyStockReturn = stockReturn / 12;
  const monthlyBondReturn = bondReturn / 12;
  const monthlyStockVol = stockVolatility / Math.sqrt(12);
  const monthlyBondVol = bondVolatility / Math.sqrt(12);
  
  // Debug logging
  console.log('Simulation params:', { 
    stockAllocation, 
    bondAllocation, 
    monthlyStockReturn: (monthlyStockReturn * 100).toFixed(3) + '%', 
    monthlyBondReturn: (monthlyBondReturn * 100).toFixed(3) + '%',
    annualStockReturn: (stockReturn * 100).toFixed(2) + '%',
    annualBondReturn: (bondReturn * 100).toFixed(2) + '%',
    degreesOfFreedom
  });

  // Run simulations - keep track of simulation index
  const scenarios: { 
    index: number; 
    balances: number[]; 
    returns: { stock: number[]; bond: number[] };
    stockBalances: number[];
    bondBalances: number[];
    annualizedStockReturn: number;
    annualizedBondReturn: number;
    cashFlows: number[];
    comparisonBalances?: number[];
    comparisonStockBalances?: number[];
    comparisonBondBalances?: number[];
  }[] = [];
  const finalBalances: { index: number; balance: number }[] = [];
  const comparisonFinalBalances: { index: number; balance: number }[] = [];

  for (let sim = 0; sim < simulationCount; sim++) {
    const scenarioData = runSingleScenario(
      startingBalance,
      monthsTotal,
      yearsToRetirement * 12,
      annualContribution,
      contributionGrowth,
      yearsContributing * 12,
      annualWithdrawal,
      withdrawalType,
      withdrawalPercentage,
      guardrailBand,
      guardrailAdjustment,
      withdrawalInflation,
      stockAllocation,
      bondAllocation,
      monthlyStockReturn,
      monthlyStockVol,
      monthlyBondReturn,
      monthlyBondVol,
      correlation,
      rebalancing === 'annual',
      degreesOfFreedom,
      taxablePortion,
      taxRate,
      finalInvestmentFee,
      comparisonFee,
      simulationMode,
      historicalScenario
    );

    scenarios.push({
      index: sim,
      balances: scenarioData.balances,
      returns: scenarioData.returns,
      stockBalances: scenarioData.stockBalances,
      bondBalances: scenarioData.bondBalances,
      annualizedStockReturn: scenarioData.annualizedStockReturn,
      annualizedBondReturn: scenarioData.annualizedBondReturn,
      cashFlows: scenarioData.cashFlows,
      comparisonBalances: scenarioData.comparisonBalances,
      comparisonStockBalances: scenarioData.comparisonStockBalances,
      comparisonBondBalances: scenarioData.comparisonBondBalances
    });
    
    finalBalances.push({
      index: sim,
      balance: scenarioData.balances[scenarioData.balances.length - 1]
    });

    // Track comparison final balances if comparison fee is provided
    if (comparisonFee !== undefined && scenarioData.comparisonBalances) {
      comparisonFinalBalances.push({
        index: sim,
        balance: scenarioData.comparisonBalances[scenarioData.comparisonBalances.length - 1]
      });
    }
  }

  // Collect annualized returns for distribution analysis
  const stockReturnDistribution = scenarios.map(s => s.annualizedStockReturn * 100); // Convert to percentage
  const bondReturnDistribution = scenarios.map(s => s.annualizedBondReturn * 100);
  
  // Calculate IRR and volatility for each scenario
  const irrValues: number[] = [];
  const volatilityValues: number[] = [];
  
  for (const scenario of scenarios) {
    // Calculate IRR for this scenario
    const irr = calculateIRR(
      startingBalance,
      scenario.balances,
      scenario.cashFlows || [],
      monthsTotal,
      yearsToRetirement * 12,
      annualContribution,
      contributionGrowth,
      yearsContributing * 12,
      annualWithdrawal,
      withdrawalInflation,
      taxablePortion,
      taxRate
    );
    if (!isNaN(irr) && isFinite(irr)) {
      irrValues.push(irr);
    }
    
    // Calculate portfolio volatility (std dev of monthly portfolio returns)
    const portfolioReturns = calculatePortfolioReturns(scenario.balances, scenario.cashFlows || []);
    if (portfolioReturns.length > 1) {
      const volatility = calculateVolatility(portfolioReturns);
      if (!isNaN(volatility) && isFinite(volatility)) {
        volatilityValues.push(volatility);
      }
    }
  }
  
  // Calculate median IRR and volatility
  const medianIRR = irrValues.length > 0 ? calculateMedian(irrValues) : 0;
  const medianVolatility = volatilityValues.length > 0 ? calculateMedian(volatilityValues) : 0;
  
  // Debug: Log return statistics
  const avgStockReturn = stockReturnDistribution.reduce((sum, r) => sum + r, 0) / stockReturnDistribution.length;
  const avgBondReturn = bondReturnDistribution.reduce((sum, r) => sum + r, 0) / bondReturnDistribution.length;
  console.log('Return distribution stats:', {
    expectedStockReturn: (stockReturn * 100).toFixed(2) + '%',
    actualAvgStockReturn: avgStockReturn.toFixed(2) + '%',
    expectedBondReturn: (bondReturn * 100).toFixed(2) + '%',
    actualAvgBondReturn: avgBondReturn.toFixed(2) + '%',
    stockMin: Math.min(...stockReturnDistribution).toFixed(2) + '%',
    stockMax: Math.max(...stockReturnDistribution).toFixed(2) + '%',
    medianIRR: (medianIRR * 100).toFixed(2) + '%',
    medianVolatility: (medianVolatility * 100).toFixed(2) + '%'
  });

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
    withdrawalType,
    withdrawalPercentage,
    guardrailBand,
    guardrailAdjustment,
    withdrawalInflation,
    yearsContributing * 12, // Convert to months
    taxablePortion,
    taxRate
  );

  // Find failed scenarios and identify the median failure
  let medianFailureDetails: any[] | null = null;
  let medianFailureIndex: number | null = null;
  let medianFailureMonth: number | null = null;
  let medianFailureAge: number | null = null;

  const failedScenarios = finalBalances.filter(b => b.balance === 0);

  if (failedScenarios.length > 0) {
    // For each failed scenario, find the month when balance first hit 0
    const failuresWithMonth = failedScenarios.map(f => {
      const scenario = scenarios.find(s => s.index === f.index)!;
      // Find first month where balance is 0 (after retirement starts)
      const failureMonth = scenario.balances.findIndex((bal, idx) => idx > 0 && bal === 0);
      return {
        index: f.index,
        failureMonth: failureMonth === -1 ? scenario.balances.length : failureMonth
      };
    });

    // Sort by failure month (ascending - earlier failures first)
    failuresWithMonth.sort((a, b) => a.failureMonth - b.failureMonth);

    // Find median failure - pick the "better" one (fails later) for even counts
    // For n failures: pick index ceil(n/2) - 1 to get the one that fails later
    const medianFailureIdx = Math.ceil(failuresWithMonth.length / 2) - 1;
    const medianFailure = failuresWithMonth[Math.min(medianFailureIdx, failuresWithMonth.length - 1)];

    medianFailureIndex = medianFailure.index;
    medianFailureMonth = medianFailure.failureMonth;
    medianFailureAge = currentAge + Math.floor(medianFailure.failureMonth / 12);

    // Generate yearly breakdown for the median failure
    const failureSimulation = scenarios.find(s => s.index === medianFailureIndex)!;
    medianFailureDetails = generateYearlyBreakdown(
      failureSimulation.balances,
      failureSimulation.returns,
      failureSimulation.stockBalances,
      failureSimulation.bondBalances,
      currentAge,
      yearsToRetirement,
      annualContribution,
      contributionGrowth,
      annualWithdrawal,
      withdrawalType,
      withdrawalPercentage,
      guardrailBand,
      guardrailAdjustment,
      withdrawalInflation,
      yearsContributing * 12,
      taxablePortion,
      taxRate
    );
  }

  const result: any = {
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
    medianSimulationDetails,
    // Failure scenario data (null if no failures)
    medianFailureIndex,
    medianFailureMonth,
    medianFailureAge,
    medianFailureDetails,
    failureCount: failedScenarios.length,
    stockReturnDistribution,
    bondReturnDistribution,
    medianIRR: medianIRR * 100, // Convert to percentage
    medianVolatility: medianVolatility * 100 // Convert to percentage
  };

  // Add comparison data if comparison fee was provided
  if (comparisonFee !== undefined && medianSimulation.comparisonBalances) {
    // Calculate comparison median path
    const comparisonMedianPath: number[] = [];
    const comparisonPercentile20Path: number[] = [];
    const comparisonPercentile80Path: number[] = [];

    for (let year = 0; year <= totalYears; year++) {
      const monthIndex = Math.min(year * 12, monthsTotal - 1);
      const comparisonBalancesAtTime = scenarios
        .map(s => s.comparisonBalances?.[monthIndex] ?? 0)
        .sort((a, b) => a - b);
      
      comparisonMedianPath.push(comparisonBalancesAtTime[Math.floor(simulationCount / 2)]);
      comparisonPercentile20Path.push(comparisonBalancesAtTime[Math.floor(simulationCount * 0.2)]);
      comparisonPercentile80Path.push(comparisonBalancesAtTime[Math.floor(simulationCount * 0.8)]);
    }

    // Generate comparison simulation details for the same median scenario
    const comparisonMedianSimulationDetails = generateYearlyBreakdown(
      medianSimulation.comparisonBalances!,
      medianSimulation.returns, // Same returns!
      medianSimulation.comparisonStockBalances!,
      medianSimulation.comparisonBondBalances!,
      currentAge,
      yearsToRetirement,
      annualContribution,
      contributionGrowth,
      annualWithdrawal,
      withdrawalType,
      withdrawalPercentage,
      guardrailBand,
      guardrailAdjustment,
      withdrawalInflation,
      yearsContributing * 12,
      taxablePortion,
      taxRate
    );

    // Calculate comparison median balance
    const sortedComparisonBalances = [...comparisonFinalBalances].sort((a, b) => a.balance - b.balance);
    const comparisonMedianBalance = sortedComparisonBalances[Math.floor(simulationCount / 2)].balance;

    result.comparisonMedianBalance = comparisonMedianBalance;
    result.comparisonMedianPath = comparisonMedianPath;
    result.comparisonPercentile20Path = comparisonPercentile20Path;
    result.comparisonPercentile80Path = comparisonPercentile80Path;
    result.comparisonMedianSimulationDetails = comparisonMedianSimulationDetails;
  }

  return result;
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
  withdrawalType: 'fixed' | 'percentage',
  withdrawalPercentage: number,
  guardrailBand: number,
  guardrailAdjustment: number,
  withdrawalInflation: number,
  monthsContributing: number,
  taxablePortion: number,
  taxRate: number
): any[] {
  const totalYears = Math.floor(monthlyBalances.length / 12);
  const yearData = [];

  let currentContribution = annualContribution / 12;

  // Calculate tax parameters
  const effectiveTaxRate = taxablePortion * taxRate;
  const monthsToRetirement = yearsToRetirement * 12;

  // For fixed withdrawals, pre-calculate; for percentage, we'll calculate when retirement begins
  let currentWithdrawal = 0;
  let withdrawalInitialized = false;

  // Track initial withdrawal rate for guardrails
  let initialWithdrawalRate = 0;
  const useGuardrails = withdrawalType === 'percentage' && guardrailBand > 0 && guardrailAdjustment > 0;

  if (withdrawalType === 'fixed') {
    // Inflation-adjust the withdrawal amount from the start (same as simulation)
    const inflationAdjustedAnnualWithdrawal = annualWithdrawal * Math.pow(1 + withdrawalInflation, yearsToRetirement);
    const grossWithdrawal = inflationAdjustedAnnualWithdrawal / (1 - effectiveTaxRate);
    currentWithdrawal = grossWithdrawal / 12;
    withdrawalInitialized = true;
  }
  
  for (let year = 0; year <= totalYears; year++) {
    const age = startAge + year;
    const isRetired = year > yearsToRetirement;
    const startMonthIndex = year * 12;
    
    // Year's end balance is after ALL 12 months
    // Year 0: months 0-11, end balance is balances[12]
    // Year 1: months 12-23, end balance is balances[24]
    const endMonthIndex = Math.min((year + 1) * 12, monthlyBalances.length - 1);
    
    const startBalance = monthlyBalances[startMonthIndex];
    const endBalance = monthlyBalances[endMonthIndex];
    
    // Sum up returns for the year and track monthly details
    let yearlyStockReturn = 0;
    let yearlyBondReturn = 0;
    let annualContributionTotal = 0;
    let annualWithdrawalGross = 0;
    let annualWithdrawalNet = 0;
    let annualTax = 0;
    const monthlyDetails = [];
    
    for (let month = 0; month < 12 && startMonthIndex + month < monthlyReturns.stock.length; month++) {
      const monthIndex = startMonthIndex + month;
      const monthNum = monthIndex;
      
      const stockRet = monthlyReturns.stock[monthIndex];
      const bondRet = monthlyReturns.bond[monthIndex];
      yearlyStockReturn += stockRet;
      yearlyBondReturn += bondRet;
      
      let monthContribution = 0;
      let monthWithdrawalGross = 0;
      let monthWithdrawalNet = 0;
      let monthTax = 0;
      
      if (monthNum < monthsToRetirement) {
        if (monthNum < monthsContributing) {
          monthContribution = currentContribution;
          annualContributionTotal += currentContribution;
        }
      } else {
        // Retirement phase (monthNum >= monthsToRetirement)
        // Get balance at start of this month
        const monthStartBal = monthlyBalances[monthIndex] ?? 0;

        // Only withdraw if there's money in the account
        if (monthStartBal > 0) {
          // Initialize percentage-based withdrawal on first month of retirement
          if (!withdrawalInitialized && withdrawalType === 'percentage') {
            // Get balance at start of retirement from the monthly balances
            // The percentage applies to the GROSS (pre-tax) withdrawal amount
            const retirementStartBalance = monthlyBalances[monthsToRetirement] ?? 0;
            const grossAnnualWithdrawal = retirementStartBalance * withdrawalPercentage;
            currentWithdrawal = grossAnnualWithdrawal / 12;
            withdrawalInitialized = true;

            // Store initial withdrawal rate for guardrails
            initialWithdrawalRate = withdrawalPercentage;
          }

          // Apply Guyton-Klinger guardrails at the start of each year (except first year)
          const monthsIntoRetirement = monthNum - monthsToRetirement;
          if (useGuardrails && monthsIntoRetirement > 0 && monthsIntoRetirement % 12 === 0) {
            const annualWithdrawalPlanned = currentWithdrawal * 12;
            const currentWithdrawalRate = annualWithdrawalPlanned / monthStartBal;

            const upperGuardrail = initialWithdrawalRate * (1 + guardrailBand);
            const lowerGuardrail = initialWithdrawalRate * (1 - guardrailBand);

            if (currentWithdrawalRate > upperGuardrail) {
              // Capital preservation: cut spending
              currentWithdrawal *= (1 - guardrailAdjustment);
            } else if (currentWithdrawalRate < lowerGuardrail) {
              // Prosperity: raise spending
              currentWithdrawal *= (1 + guardrailAdjustment);
            }
          }

          monthWithdrawalGross = currentWithdrawal;
          monthTax = monthWithdrawalGross * effectiveTaxRate;
          monthWithdrawalNet = monthWithdrawalGross - monthTax;
          annualWithdrawalGross += monthWithdrawalGross;
          annualWithdrawalNet += monthWithdrawalNet;
          annualTax += monthTax;
        }
        // If balance is 0, withdrawals remain 0 (initialized above)
      }
      
      // Calculate monthly balances - align with returns array indexing
      // balances[monthIndex] = balance at START of month
      // balances[monthIndex + 1] = balance at END of month (after this month's returns/contributions)
      const monthStartBalance = monthlyBalances[monthIndex] ?? 0;
      const monthEndBalance = monthlyBalances[monthIndex + 1] ?? monthlyBalances[monthIndex] ?? 0;
      
      // Get actual stock and bond balances at start and end of month
      const monthStartStockBalance = monthlyStockBalances[monthIndex] ?? 0;
      const monthStartBondBalance = monthlyBondBalances[monthIndex] ?? 0;
      const monthEndStockBalance = monthlyStockBalances[monthIndex + 1] ?? monthlyStockBalances[monthIndex] ?? 0;
      const monthEndBondBalance = monthlyBondBalances[monthIndex + 1] ?? monthlyBondBalances[monthIndex] ?? 0;
      
      // Calculate investment returns for this month
      const monthReturns = monthEndBalance - monthStartBalance - monthContribution + monthWithdrawalGross;
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
        withdrawalGross: monthWithdrawalGross,      // ← Gross withdrawal (from portfolio)
        withdrawalNet: monthWithdrawalNet,          // ← Net withdrawal (after taxes)
        tax: monthTax,                               // ← Tax amount
        returns: monthReturns,
        netChange: monthNetChange
      });
    }
    
    // Calculate investment returns (approximate)
    const investmentReturns = endBalance - startBalance - annualContributionTotal + annualWithdrawalGross;
    
    // Determine phase based on whether any withdrawals occurred this year
    const hasWithdrawals = annualWithdrawalGross > 0;
    const phase = hasWithdrawals ? 'Retirement' : 'Accumulation';

    yearData.push({
      year,
      age,
      phase,
      startBalance,
      contributions: annualContributionTotal,
      withdrawalGross: annualWithdrawalGross,
      withdrawalNet: annualWithdrawalNet,
      tax: annualTax,
      returns: investmentReturns,
      stockReturn: (yearlyStockReturn * 100).toFixed(1) + '%',
      bondReturn: (yearlyBondReturn * 100).toFixed(1) + '%',
      endBalance,
      netChange: endBalance - startBalance,
      monthlyDetails  // ← Include monthly data
    });

    // Update contribution/withdrawal for next year
    if (annualContributionTotal > 0) {
      currentContribution *= (1 + contributionGrowth);
    }
    if (hasWithdrawals) {
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
  withdrawalType: 'fixed' | 'percentage',
  withdrawalPercentage: number,
  guardrailBand: number,
  guardrailAdjustment: number,
  withdrawalInflation: number,
  stockAllocation: number,
  bondAllocation: number,
  monthlyStockReturn: number,
  monthlyStockVol: number,
  monthlyBondReturn: number,
  monthlyBondVol: number,
  correlation: number,
  rebalance: boolean,
  degreesOfFreedom: number,
  taxablePortion: number,
  taxRate: number,
  investmentFee: number,
  comparisonFee?: number,
  simulationMode: 'simple' | 'regime-switching' = 'simple',
  historicalScenario: string | null = null
): { 
  balances: number[]; 
  returns: { stock: number[]; bond: number[] }; 
  stockBalances: number[]; 
  bondBalances: number[];
  annualizedStockReturn: number;
  annualizedBondReturn: number;
  cashFlows: number[]; // Track cash flows for IRR calculation
  comparisonBalances?: number[];
  comparisonStockBalances?: number[];
  comparisonBondBalances?: number[];
} {
  const balances: number[] = [startingBalance];
  const stockReturns: number[] = [];
  const bondReturns: number[] = [];
  const cashFlows: number[] = [-startingBalance]; // Initial investment is negative cash flow
  
  let balance = startingBalance;

  // Asset balances (for rebalancing)
  let stockBalance = balance * stockAllocation;
  let bondBalance = balance * bondAllocation;
  
  // Track individual asset balances over time
  const stockBalances: number[] = [stockBalance];
  const bondBalances: number[] = [bondBalance];

  // Comparison fee scenario (if provided) - tracks parallel portfolio with different fee
  let comparisonBalance = comparisonFee !== undefined ? startingBalance : 0;
  let comparisonStockBalance = comparisonFee !== undefined ? balance * stockAllocation : 0;
  let comparisonBondBalance = comparisonFee !== undefined ? balance * bondAllocation : 0;
  const comparisonBalances: number[] = comparisonFee !== undefined ? [startingBalance] : [];
  const comparisonStockBalances: number[] = comparisonFee !== undefined ? [comparisonStockBalance] : [];
  const comparisonBondBalances: number[] = comparisonFee !== undefined ? [comparisonBondBalance] : [];

  let currentContribution = annualContribution / 12;

  // Calculate effective tax rate for withdrawals
  const effectiveTaxRate = taxablePortion * taxRate;

  // For fixed withdrawals, pre-calculate the inflation-adjusted amount
  // For percentage-based, we'll calculate when retirement begins
  const yearsUntilRetirement = monthsToRetirement / 12;
  let currentWithdrawal = 0;
  let withdrawalInitialized = false;

  // Track initial withdrawal rate for guardrails (only used with percentage-based)
  let initialWithdrawalRate = 0;
  let useGuardrails = withdrawalType === 'percentage' && guardrailBand > 0 && guardrailAdjustment > 0;

  if (withdrawalType === 'fixed') {
    // Inflation-adjust the withdrawal amount from the start
    // At retirement, withdrawal should be: baseAmount × (1 + inflation)^yearsToRetirement
    const inflationAdjustedAnnualWithdrawal = annualWithdrawal * Math.pow(1 + withdrawalInflation, yearsUntilRetirement);

    // Calculate gross withdrawal needed (to cover taxes)
    // The annualWithdrawal is the desired after-tax spending
    const grossWithdrawal = inflationAdjustedAnnualWithdrawal / (1 - effectiveTaxRate);
    currentWithdrawal = grossWithdrawal / 12;
    withdrawalInitialized = true;
  }
  // For percentage-based, currentWithdrawal will be set when retirement begins

  // Initialize regime state for regime-switching mode
  let currentRegime: RegimeState = simulationMode === 'regime-switching' ? drawInitialRegime() : 0;

  // Historical scenario tracking
  const historicalMonths = historicalScenario ? getHistoricalMonthsForScenario(historicalScenario) : [];
  let historicalMonthIndex = 0; // Tracks which historical month we're on (relative to retirement start)
  let usedHistoricalMonths = 0; // For tracking when history runs out

  // Track historical CPI for inflation adjustments
  let cumulativeHistoricalCPI = 0; // Accumulated monthly CPI within the year
  let usingHistoricalCPI = false; // Whether current year used historical CPI

  for (let month = 0; month < monthsTotal; month++) {
    // Generate correlated returns based on simulation mode
    let stockReturn: number;
    let bondReturn: number;
    let monthlyCPI: number | undefined = undefined;

    // Check if we should use historical returns (during retirement with a historical scenario)
    const isInRetirement = month >= monthsToRetirement;
    const useHistorical = isInRetirement && historicalScenario && historicalMonthIndex < historicalMonths.length;

    if (useHistorical) {
      // Use actual historical returns
      const histKey = historicalMonths[historicalMonthIndex];
      const histReturn = HISTORICAL_RETURNS[histKey];
      if (histReturn) {
        stockReturn = histReturn.stock;
        bondReturn = histReturn.bond;
        monthlyCPI = histReturn.cpi; // Track historical CPI
        usedHistoricalMonths++;
      } else {
        // Fallback to Monte Carlo if historical data is missing
        if (simulationMode === 'regime-switching') {
          const regimeResult = generateRegimeSwitchingReturns(currentRegime);
          stockReturn = regimeResult.stockReturn;
          bondReturn = regimeResult.bondReturn;
          currentRegime = regimeResult.newRegime;
        } else {
          [stockReturn, bondReturn] = generateCorrelatedReturns(
            monthlyStockReturn, monthlyStockVol, monthlyBondReturn, monthlyBondVol, correlation, degreesOfFreedom
          );
        }
      }
      historicalMonthIndex++;
    } else if (simulationMode === 'regime-switching') {
      // Use regime-switching model with Markov transitions
      const regimeResult = generateRegimeSwitchingReturns(currentRegime);
      stockReturn = regimeResult.stockReturn;
      bondReturn = regimeResult.bondReturn;
      currentRegime = regimeResult.newRegime;
    } else {
      // Use simple skewed-t model with user-provided parameters
      [stockReturn, bondReturn] = generateCorrelatedReturns(
        monthlyStockReturn,
        monthlyStockVol,
        monthlyBondReturn,
        monthlyBondVol,
        correlation,
        degreesOfFreedom
      );
    }

    // Check for NaN in generated returns
    if (isNaN(stockReturn) || isNaN(bondReturn)) {
      console.error('NaN return generated at month', month, { stockReturn, bondReturn, stockAllocation, bondAllocation });
    }
    
    // Track returns
    stockReturns.push(stockReturn);
    bondReturns.push(bondReturn);

    // Apply returns to each asset
    const prevStockBalance = stockBalance;
    const prevBondBalance = bondBalance;
    
    stockBalance *= (1 + stockReturn);
    bondBalance *= (1 + bondReturn);
    
    // Check for NaN only (negative balances are OK temporarily)
    if (isNaN(stockBalance) || isNaN(bondBalance)) {
      console.error('NaN balance detected at month', month, { 
        prevStockBalance, 
        prevBondBalance, 
        stockReturn, 
        bondReturn, 
        newStockBalance: stockBalance,
        newBondBalance: bondBalance
      });
      stockBalance = isNaN(stockBalance) ? prevStockBalance : stockBalance;
      bondBalance = isNaN(bondBalance) ? prevBondBalance : bondBalance;
    }

    // Sum up portfolio
    balance = stockBalance + bondBalance;

    // Apply investment fees (convert annual fee to monthly and deduct from portfolio)
    if (investmentFee > 0 && balance > 0) {
      const monthlyFee = investmentFee / 12;
      const feeAmount = balance * monthlyFee;
      
      // Deduct fee proportionally from each asset
      stockBalance -= feeAmount * stockAllocation;
      bondBalance -= feeAmount * bondAllocation;
      balance -= feeAmount;
    }

    // Apply contributions/withdrawals
    if (month < monthsToRetirement) {
      // Accumulation phase
      if (month < monthsContributing) {
        balance += currentContribution;
        cashFlows.push(-currentContribution); // Contribution is negative cash flow (money going out)
        
        // Add contribution proportionally to assets
        stockBalance += currentContribution * stockAllocation;
        bondBalance += currentContribution * bondAllocation;

        // Adjust contribution for growth (annually) - at end of each year
        if ((month + 1) % 12 === 0) {
          currentContribution *= (1 + contributionGrowth);
        }
      } else {
        cashFlows.push(0); // No cash flow during accumulation after contributions stop
      }
    } else {
      // Withdrawal phase

      // Only withdraw if there's money in the account
      if (balance > 0) {
        // Initialize percentage-based withdrawal on first month of retirement
        if (!withdrawalInitialized && withdrawalType === 'percentage') {
          // Calculate withdrawal based on current balance (at retirement start)
          // The percentage applies to the GROSS (pre-tax) withdrawal amount
          const grossAnnualWithdrawal = balance * withdrawalPercentage;
          currentWithdrawal = grossAnnualWithdrawal / 12;
          withdrawalInitialized = true;

          // Store initial withdrawal rate for guardrails
          initialWithdrawalRate = withdrawalPercentage;
        }

        // Apply Guyton-Klinger guardrails at the start of each year (except first year)
        // Check at month 12, 24, 36, etc. of retirement (i.e., start of years 2, 3, 4...)
        const monthsIntoRetirement = month - monthsToRetirement;
        if (useGuardrails && monthsIntoRetirement > 0 && monthsIntoRetirement % 12 === 0) {
          const annualWithdrawalPlanned = currentWithdrawal * 12;
          const currentWithdrawalRate = annualWithdrawalPlanned / balance;

          const upperGuardrail = initialWithdrawalRate * (1 + guardrailBand);
          const lowerGuardrail = initialWithdrawalRate * (1 - guardrailBand);

          if (currentWithdrawalRate > upperGuardrail) {
            // Capital preservation: cut spending
            currentWithdrawal *= (1 - guardrailAdjustment);
          } else if (currentWithdrawalRate < lowerGuardrail) {
            // Prosperity: raise spending
            currentWithdrawal *= (1 + guardrailAdjustment);
          }
        }

        balance -= currentWithdrawal;
        cashFlows.push(currentWithdrawal); // Withdrawal is positive cash flow (money coming in)

        // Withdraw proportionally from assets
        stockBalance -= currentWithdrawal * stockAllocation;
        bondBalance -= currentWithdrawal * bondAllocation;

        // Accumulate historical CPI for this month (if using historical data)
        if (monthlyCPI !== undefined) {
          cumulativeHistoricalCPI += monthlyCPI;
          usingHistoricalCPI = true;
        }

        // Adjust withdrawal for inflation (annually) - at end of each year
        if ((month + 1) % 12 === 0) {
          if (usingHistoricalCPI && cumulativeHistoricalCPI !== 0) {
            // Use accumulated historical CPI for this year
            currentWithdrawal *= (1 + cumulativeHistoricalCPI);
          } else {
            // Use user-specified inflation rate
            currentWithdrawal *= (1 + withdrawalInflation);
          }
          // Reset for next year
          cumulativeHistoricalCPI = 0;
          usingHistoricalCPI = false;
        }
      } else {
        // No money left - no withdrawal
        cashFlows.push(0);
      }
    }

    // Rebalance annually if enabled - at end of each year (months 11, 23, 35, etc.)
    if (rebalance && (month + 1) % 12 === 0 && balance > 0) {
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

    // Track comparison fee scenario (if enabled) - apply same returns but different fee
    if (comparisonFee !== undefined) {
      // Apply same returns to comparison portfolio
      comparisonStockBalance *= (1 + stockReturn);
      comparisonBondBalance *= (1 + bondReturn);
      comparisonBalance = comparisonStockBalance + comparisonBondBalance;

      // Apply comparison fee
      if (comparisonFee > 0 && comparisonBalance > 0) {
        const monthlyComparisonFee = comparisonFee / 12;
        const feeAmount = comparisonBalance * monthlyComparisonFee;
        
        comparisonStockBalance -= feeAmount * stockAllocation;
        comparisonBondBalance -= feeAmount * bondAllocation;
        comparisonBalance -= feeAmount;
      }

      // Apply same contributions/withdrawals
      if (month < monthsToRetirement) {
        if (month < monthsContributing) {
          comparisonBalance += currentContribution;
          comparisonStockBalance += currentContribution * stockAllocation;
          comparisonBondBalance += currentContribution * bondAllocation;
        }
      } else {
        comparisonBalance -= currentWithdrawal;
        comparisonStockBalance -= currentWithdrawal * stockAllocation;
        comparisonBondBalance -= currentWithdrawal * bondAllocation;
      }

      // Rebalance if enabled
      if (rebalance && (month + 1) % 12 === 0 && comparisonBalance > 0) {
        comparisonStockBalance = comparisonBalance * stockAllocation;
        comparisonBondBalance = comparisonBalance * bondAllocation;
      }

      // Prevent negative balances
      if (comparisonBalance < 0) {
        comparisonBalance = 0;
        comparisonStockBalance = 0;
        comparisonBondBalance = 0;
      }

      comparisonBalances.push(comparisonBalance);
      comparisonStockBalances.push(comparisonStockBalance);
      comparisonBondBalances.push(comparisonBondBalance);
    }
  }

  // Calculate cumulative geometric returns for the entire period
  let cumulativeStockReturn = 1.0;
  let cumulativeBondReturn = 1.0;
  
  stockReturns.forEach(r => {
    cumulativeStockReturn *= (1 + r);
  });
  
  bondReturns.forEach(r => {
    cumulativeBondReturn *= (1 + r);
  });
  
  // Convert to annualized returns
  const totalMonths = stockReturns.length;
  const totalYears = totalMonths / 12;
  const annualizedStockReturn = Math.pow(cumulativeStockReturn, 1 / totalYears) - 1;
  const annualizedBondReturn = Math.pow(cumulativeBondReturn, 1 / totalYears) - 1;

  // Note: Final balance is not a cash flow, it's the terminal value
  // The cashFlows array now has: [-startingBalance, ...monthly cash flows...]
  // We'll add the final balance as the terminal value in the IRR calculation
  
  const result: any = {
    balances,
    returns: {
      stock: stockReturns,
      bond: bondReturns
    },
    stockBalances,
    bondBalances,
    annualizedStockReturn,
    annualizedBondReturn,
    cashFlows
  };

  // Include comparison data if it was calculated
  if (comparisonFee !== undefined) {
    result.comparisonBalances = comparisonBalances;
    result.comparisonStockBalances = comparisonStockBalances;
    result.comparisonBondBalances = comparisonBondBalances;
  }

  return result;
}

// Generate correlated random variables using Cholesky decomposition
// Now supports Skewed Student's t-distribution for fat tails and asymmetry
function generateCorrelatedReturns(
  mean1: number,
  std1: number,
  mean2: number,
  std2: number,
  correlation: number,
  degreesOfFreedom: number
): [number, number] {
  const skewness = -0.3; // Negative skew = more downside risk (crash-heavy)
  
  // Generate two independent skewed t-distributed random variables
  // Use t-distribution if df < 30, otherwise use normal (converges to normal at high df)
  const z1 = degreesOfFreedom < 30 ? randomSkewedT(degreesOfFreedom, skewness) : randomNormal();
  const z2 = degreesOfFreedom < 30 ? randomSkewedT(degreesOfFreedom, skewness) : randomNormal();

  // Apply Cholesky decomposition for correlation
  // For 2x2 correlation matrix:
  // [1    ρ  ]     [1      0    ]
  // [ρ    1  ]  =  [ρ   √(1-ρ²)]
  
  // Handle edge case: 100% allocation to one asset (correlation doesn't apply)
  const correlationFactor = Math.abs(correlation) < 0.999 ? Math.sqrt(1 - correlation * correlation) : 0;
  
  const return1 = mean1 + std1 * z1;
  const return2 = mean2 + std2 * (correlation * z1 + correlationFactor * z2);

  return [return1, return2];
}

// ============================================================================
// REGIME-SWITCHING RETURN GENERATION
// ============================================================================

// Draw initial regime based on starting probabilities
function drawInitialRegime(): RegimeState {
  const r = Math.random();
  let cumProb = 0;
  for (let i = 0; i < INITIAL_REGIME_PROBS.length; i++) {
    cumProb += INITIAL_REGIME_PROBS[i];
    if (r < cumProb) return i as RegimeState;
  }
  return 0; // Default to Calm
}

// Transition to next regime based on Markov matrix
function transitionRegime(currentRegime: RegimeState): RegimeState {
  const r = Math.random();
  const row = TRANSITION_MATRIX[currentRegime];
  let cumProb = 0;
  for (let i = 0; i < row.length; i++) {
    cumProb += row[i];
    if (r < cumProb) return i as RegimeState;
  }
  return currentRegime; // Fallback: stay in current regime
}

// Generate correlated returns using regime-specific parameters
function generateRegimeSwitchingReturns(
  currentRegime: RegimeState
): { stockReturn: number; bondReturn: number; newRegime: RegimeState } {
  // Get regime parameters
  const params = REGIME_PARAMS[currentRegime];

  // Convert annual parameters to monthly
  // For log returns: μ_monthly = ln(1 + μ_annual) / 12
  // For simplicity (small values): μ_monthly ≈ μ_annual / 12
  // Volatility: σ_monthly = σ_annual / √12
  const monthlyStockMean = params.stockMean / 12;
  const monthlyBondMean = params.bondMean / 12;
  const monthlyStockVol = params.stockVol / Math.sqrt(12);
  const monthlyBondVol = params.bondVol / Math.sqrt(12);

  // Generate two independent skewed t-distributed random variables
  // Use regime-specific df and skew for stocks, same df but less skew for bonds
  const z1 = randomSkewedT(params.df, params.stockSkew);
  const z2 = randomSkewedT(params.df, params.stockSkew * 0.5); // Bonds have less skew

  // Apply Cholesky decomposition for correlation
  const correlationFactor = Math.abs(params.correlation) < 0.999
    ? Math.sqrt(1 - params.correlation * params.correlation)
    : 0;

  const stockReturn = monthlyStockMean + monthlyStockVol * z1;
  const bondReturn = monthlyBondMean + monthlyBondVol * (params.correlation * z1 + correlationFactor * z2);

  // Transition to next regime for next month
  const newRegime = transitionRegime(currentRegime);

  return { stockReturn, bondReturn, newRegime };
}

// Generate Skewed Student's t-distributed random variable
// Implements a mean-preserving skewed transformation
// skew < 0 = left tail fatter (more crash risk)
// skew > 0 = right tail fatter (more boom potential)
function randomSkewedT(df: number, skew: number): number {
  // Generate standard t-distributed variable
  const t = randomT(df);
  
  // Check for NaN
  if (isNaN(t)) {
    console.error('randomT produced NaN with df=', df);
    return 0;
  }
  
  // Apply mean-preserving skewness transformation
  // For skew = -0.3 (negative):
  // - Makes negative deviations larger (fatter left tail)
  // - Makes positive deviations smaller (thinner right tail)
  // - But adds correction to preserve mean at 0
  
  let skewed;
  if (t < 0) {
    skewed = t * (1 + Math.abs(skew));  // Amplify crashes
  } else {
    skewed = t * (1 - Math.abs(skew) * 0.5);  // Reduce booms
  }
  
  // Mean correction factor
  // For symmetric distribution around 0:
  // E[negative part] ≈ -0.8, E[positive part] ≈ +0.8
  // After transformation with skew=-0.3:
  //   E[neg] = -0.8 * 1.3 = -1.04
  //   E[pos] = +0.8 * 0.85 = +0.68
  //   Mean shift = 0.5*(-1.04) + 0.5*(0.68) - 0 = -0.18
  // Need to add back +0.18 to preserve mean
  const meanCorrection = 0.18 * Math.abs(skew) / 0.3;  // Scale by actual skew parameter
  
  return skewed + meanCorrection;
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

// Calculate IRR using Newton-Raphson method
function calculateIRR(
  startingBalance: number,
  balances: number[],
  cashFlows: number[],
  monthsTotal: number,
  monthsToRetirement: number,
  annualContribution: number,
  contributionGrowth: number,
  monthsContributing: number,
  annualWithdrawal: number,
  withdrawalInflation: number,
  taxablePortion: number,
  taxRate: number
): number {
  // Build cash flow array properly
  // cashFlows already has: [-startingBalance, ...monthly cash flows...]
  // We need to add the final balance as the terminal value
  const cf = [...cashFlows]; // Copy the array
  
  // Final balance is the terminal value (positive cash flow at the end)
  const finalBalance = balances[balances.length - 1] || 0;
  cf.push(finalBalance);
  
  // Calculate IRR using Newton-Raphson
  return calculateIRRFromCashFlows(cf, monthsTotal);
}

// Calculate IRR from cash flows using Newton-Raphson method
function calculateIRRFromCashFlows(cashFlows: number[], periods: number): number {
  if (cashFlows.length === 0 || cashFlows[0] >= 0) {
    return 0; // Invalid cash flows
  }
  
  // Initial guess: try a few reasonable rates
  let monthlyRate = 0.05 / 12; // Start with 5% annual, convert to monthly
  
  const maxIterations = 100;
  const tolerance = 1e-6;
  
  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let npvDerivative = 0;
    
    // Cash flows are at times 0, 1, 2, ..., periods (total of periods+1 cash flows)
    for (let t = 0; t < cashFlows.length; t++) {
      const cf = cashFlows[t];
      const discountFactor = Math.pow(1 + monthlyRate, t);
      npv += cf / discountFactor;
      if (t > 0) { // Derivative at t=0 is 0
        npvDerivative -= (t * cf) / (discountFactor * (1 + monthlyRate));
      }
    }
    
    if (Math.abs(npv) < tolerance) {
      // Convert monthly rate to annual
      return Math.pow(1 + monthlyRate, 12) - 1;
    }
    
    if (Math.abs(npvDerivative) < tolerance) {
      break; // Derivative too small, can't converge
    }
    
    const newMonthlyRate = monthlyRate - npv / npvDerivative;
    
    // Bounds checking
    if (newMonthlyRate <= -0.99 || newMonthlyRate > 0.5 || !isFinite(newMonthlyRate)) {
      break;
    }
    
    if (Math.abs(monthlyRate - newMonthlyRate) < tolerance / 12) {
      // Convert monthly rate to annual
      return Math.pow(1 + newMonthlyRate, 12) - 1;
    }
    
    monthlyRate = newMonthlyRate;
  }
  
  // Fallback: binary search if Newton-Raphson fails
  return calculateIRRBinarySearch(cashFlows, periods);
}

// Binary search fallback for IRR calculation
function calculateIRRBinarySearch(cashFlows: number[], periods: number): number {
  let low = -0.99; // -99% monthly (very low bound)
  let high = 0.5; // 50% monthly (very high bound)
  const tolerance = 1e-6;
  const maxIterations = 100;
  
  for (let i = 0; i < maxIterations; i++) {
    const mid = (low + high) / 2;
    const monthlyRate = mid;
    
    let npv = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      const discountFactor = Math.pow(1 + monthlyRate, t);
      npv += cashFlows[t] / discountFactor;
    }
    
    if (Math.abs(npv) < tolerance) {
      // Convert monthly rate to annual
      return Math.pow(1 + monthlyRate, 12) - 1;
    }
    
    if (npv > 0) {
      low = mid;
    } else {
      high = mid;
    }
    
    if (high - low < tolerance) {
      break;
    }
  }
  
  // Convert monthly rate to annual
  const finalMonthlyRate = (low + high) / 2;
  return Math.pow(1 + finalMonthlyRate, 12) - 1;
}

// Calculate portfolio returns from balances and cash flows
function calculatePortfolioReturns(balances: number[], cashFlows: number[]): number[] {
  const returns: number[] = [];
  
  // cashFlows[0] is -startingBalance, cashFlows[1..monthsTotal] are monthly cash flows
  // balances[0] is startingBalance, balances[1..monthsTotal] are monthly balances
  
  for (let i = 1; i < balances.length; i++) {
    const prevBalance = balances[i - 1];
    const currBalance = balances[i];
    // cashFlows[i] corresponds to the cash flow during month i (which affects balance at i)
    const cashFlow = (i < cashFlows.length) ? cashFlows[i] : 0;
    
    // Portfolio return = (current balance - previous balance - cash flow) / previous balance
    // Cash flow is negative for contributions, positive for withdrawals
    // Formula: return = (end_balance - start_balance - cash_flow) / start_balance
    if (prevBalance > 0) {
      const returnValue = (currBalance - prevBalance - cashFlow) / prevBalance;
      if (isFinite(returnValue) && !isNaN(returnValue)) {
        returns.push(returnValue);
      } else {
        returns.push(0);
      }
    } else {
      returns.push(0);
    }
  }
  
  return returns;
}

// Calculate volatility (annualized standard deviation) from monthly returns
function calculateVolatility(monthlyReturns: number[]): number {
  if (monthlyReturns.length < 2) {
    return 0;
  }
  
  // Calculate mean
  const mean = monthlyReturns.reduce((sum, r) => sum + r, 0) / monthlyReturns.length;
  
  // Calculate variance
  const variance = monthlyReturns.reduce((sum, r) => {
    const diff = r - mean;
    return sum + diff * diff;
  }, 0) / (monthlyReturns.length - 1);
  
  // Standard deviation (monthly)
  const stdDevMonthly = Math.sqrt(variance);
  
  // Annualize: multiply by sqrt(12)
  return stdDevMonthly * Math.sqrt(12);
}

// Calculate median of an array
function calculateMedian(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  } else {
    return sorted[mid];
  }
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
