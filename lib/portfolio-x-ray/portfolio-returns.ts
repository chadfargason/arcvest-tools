/**
 * Calculate portfolio returns from Plaid investment transaction data
 * Properly handles buys, sells, dividends, fees, and contributions
 */

export interface PortfolioPosition {
  security_id: string;
  quantity: number;
  costBasis: number;
}

export interface MonthlyPortfolioSnapshot {
  month: string; // YYYY-MM
  positions: Map<string, PortfolioPosition>; // security_id -> position
  cash: number;
  totalValue: number; // Sum of position values + cash
  contributions: number; // Cash added
  withdrawals: number; // Cash withdrawn
  dividends: number; // Dividends received
  interest: number; // Interest received
  fees: number; // Fees paid
}

export interface MonthlyReturn {
  month: string;
  portfolioReturn: number; // Portfolio return for the month (decimal)
  portfolioValue: number; // End-of-month portfolio value
  cashFlows: {
    contributions: number;
    withdrawals: number;
    dividends: number;
    interest: number;
    fees: number;
  };
}

/**
 * Calculate monthly portfolio returns from transactions and holdings
 * 
 * Simplified approach:
 * 1. Group transactions by month
 * 2. Calculate cash flows (contributions, withdrawals, dividends, fees) per month
 * 3. Estimate portfolio value at end of each month using current holdings
 *    proportionally scaled by estimated returns
 * 4. Calculate returns using Modified Dietz method
 * 
 * Note: This is a simplified approach. For full accuracy, we'd need historical
 * security prices for each month, which we approximate using current holdings.
 */
export function calculatePortfolioReturns(
  transactions: any[],
  holdings: any[],
  securities: any[],
  startDate: string,
  endDate: string
): MonthlyReturn[] {
  // Sort transactions by date (oldest first)
  const sortedTxns = [...transactions].filter(tx => tx.date).sort((a, b) => 
    (a.date || '').localeCompare(b.date || '')
  );

  // Generate list of months in range
  const months: string[] = [];
  const start = new Date(startDate + '-01');
  const end = new Date(endDate + '-01');
  const current = new Date(start);
  
  while (current <= end) {
    months.push(current.toISOString().substring(0, 7));
    current.setMonth(current.getMonth() + 1);
  }

  // Group transactions by month and calculate cash flows
  const transactionsByMonth = new Map<string, any[]>();
  for (const tx of sortedTxns) {
    const month = tx.date.substring(0, 7);
    if (!transactionsByMonth.has(month)) {
      transactionsByMonth.set(month, []);
    }
    transactionsByMonth.get(month)!.push(tx);
  }

  // Calculate current total portfolio value from holdings
  const currentPortfolioValue = holdings.reduce((sum, h) => 
    sum + (h.institution_value || 0), 0
  );

  // Calculate cash flows and estimated portfolio values month by month
  const returns: MonthlyReturn[] = [];
  let cumulativeCostBasis = 0;
  let cumulativeCashFlows = 0;

  for (let i = 0; i < months.length; i++) {
    const month = months[i];
    const monthTxns = transactionsByMonth.get(month) || [];

    // Calculate cash flows for this month
    const cashFlows = {
      contributions: 0,
      withdrawals: 0,
      dividends: 0,
      interest: 0,
      fees: 0,
    };

    // Process transactions for cash flows
    for (const tx of monthTxns) {
      const txType = tx.type || '';
      const txSubtype = tx.subtype || '';
      const amount = tx.amount || 0;
      const fees = tx.fees || 0;

      switch (txType) {
        case 'cash':
          switch (txSubtype) {
            case 'contribution':
              cashFlows.contributions += Math.abs(amount); // amount is negative
              cumulativeCashFlows += Math.abs(amount);
              break;
            case 'dividend':
              cashFlows.dividends += Math.abs(amount); // amount is negative
              cumulativeCashFlows += Math.abs(amount);
              break;
            case 'interest':
              cashFlows.interest += Math.abs(amount); // amount is negative
              cumulativeCashFlows += Math.abs(amount);
              break;
          }
          break;

        case 'fee':
          cashFlows.fees += Math.abs(amount) + fees;
          cumulativeCashFlows -= (Math.abs(amount) + fees);
          break;

        case 'buy':
          cumulativeCostBasis += Math.abs(amount) + fees;
          cashFlows.fees += fees; // Track fees separately
          cumulativeCashFlows -= (Math.abs(amount) + fees);
          break;

        case 'sell':
          cumulativeCostBasis -= Math.abs(amount); // amount is negative
          cashFlows.withdrawals += Math.abs(amount); // Track as withdrawal
          cashFlows.fees += fees;
          cumulativeCashFlows += (Math.abs(amount) - fees);
          break;
      }

      // Also track fees field separately
      if (fees > 0 && txType !== 'fee') {
        cashFlows.fees += fees;
      }
    }

    // Estimate portfolio value at end of month
    // Simplified: use current value proportionally based on cost basis growth
    // This is an approximation - ideally we'd use historical security prices
    let estimatedValue = currentPortfolioValue;
    if (i < months.length - 1 && cumulativeCostBasis > 0) {
      // Estimate value based on cost basis (very rough approximation)
      const costBasisRatio = cumulativeCostBasis / (currentPortfolioValue + cumulativeCashFlows);
      estimatedValue = cumulativeCostBasis / Math.max(costBasisRatio, 0.5); // Cap ratio
    }

    // Calculate return for this month (Modified Dietz approximation)
    const previousValue = i > 0 ? returns[i - 1].portfolioValue : cumulativeCostBasis;
    const netCashFlow = cashFlows.contributions - cashFlows.withdrawals + 
                       cashFlows.dividends + cashFlows.interest - cashFlows.fees;
    
    let returnValue = 0;
    if (previousValue > 0) {
      const adjustedStartValue = previousValue + (netCashFlow / 2);
      if (adjustedStartValue > 0) {
        returnValue = (estimatedValue - previousValue - netCashFlow) / adjustedStartValue;
      }
    }

    returns.push({
      month,
      portfolioReturn: returnValue,
      portfolioValue: estimatedValue,
      cashFlows,
    });
  }

  return returns;
}


/**
 * Calculate geometric return from monthly returns
 */
export function calculateGeometricReturn(monthlyReturns: number[]): number {
  if (monthlyReturns.length === 0) return 0;
  
  const product = monthlyReturns.reduce((acc, ret) => acc * (1 + ret), 1);
  return product - 1;
}

/**
 * Annualize return based on number of periods
 */
export function annualizeReturn(totalReturn: number, periods: number): number {
  if (periods <= 0) return 0;
  const years = periods / 12; // Assuming monthly periods
  return Math.pow(1 + totalReturn, 1 / years) - 1;
}

