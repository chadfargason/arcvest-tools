/**
 * Calculate monthly portfolio returns from Plaid data
 */

export interface MonthlyReturn {
  month: string; // YYYY-MM format
  portfolioReturn: number; // Portfolio return for the month (decimal)
  portfolioValue: number; // End-of-month portfolio value
  benchmarkReturn?: number; // Weighted benchmark return
  benchmarkValue?: number; // End-of-month benchmark value
}

export interface ReturnsAnalysis {
  monthlyReturns: MonthlyReturn[];
  totalReturn: number; // Geometric return over period
  annualizedReturn: number; // Annualized return
  benchmarkTotalReturn?: number;
  benchmarkAnnualizedReturn?: number;
  outperformance?: number; // Difference in annualized returns
}

/**
 * Calculate monthly portfolio returns from transactions and holdings
 */
export function calculatePortfolioReturns(
  transactions: any[],
  holdings: any[],
  securities: any[],
  startDate: string,
  endDate: string
): MonthlyReturn[] {
  // Group transactions by month
  const transactionsByMonth = groupTransactionsByMonth(transactions);
  
  // Get initial portfolio value from earliest holdings snapshot
  // For simplicity, we'll use current holdings as a starting point
  // and work backwards with transactions, or forward from the start date
  
  // This is a simplified approach - in production, you'd want to:
  // 1. Reconstruct position history month-by-month from transactions
  // 2. Calculate portfolio value each month using historical prices
  // 3. Account for contributions, withdrawals, dividends, etc.
  
  // For now, return empty array - this will be implemented with historical price data
  return [];
}

/**
 * Group transactions by month (YYYY-MM format)
 */
function groupTransactionsByMonth(transactions: any[]): Map<string, any[]> {
  const grouped = new Map<string, any[]>();
  
  for (const tx of transactions) {
    if (!tx.date) continue;
    const month = tx.date.substring(0, 7); // Extract YYYY-MM
    
    if (!grouped.has(month)) {
      grouped.set(month, []);
    }
    grouped.get(month)!.push(tx);
  }
  
  return grouped;
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

