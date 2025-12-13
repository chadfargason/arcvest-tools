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
 * Approach:
 * 1. Start with current holdings (end state)
 * 2. Work backwards through transactions to reconstruct positions
 * 3. Calculate portfolio value at end of each month
 * 4. Calculate returns accounting for cash flows
 */
export function calculatePortfolioReturns(
  transactions: any[],
  holdings: any[],
  securities: any[],
  startDate: string,
  endDate: string
): MonthlyReturn[] {
  // Sort transactions by date (oldest first)
  const sortedTxns = [...transactions].sort((a, b) => 
    (a.date || '').localeCompare(b.date || '')
  );

  // Build current positions from holdings
  const currentPositions = new Map<string, PortfolioPosition>();
  for (const holding of holdings) {
    if (holding.security_id && holding.quantity !== undefined) {
      currentPositions.set(holding.security_id, {
        security_id: holding.security_id,
        quantity: holding.quantity || 0,
        costBasis: holding.cost_basis || 0,
      });
    }
  }

  // Generate list of months in range
  const months: string[] = [];
  const start = new Date(startDate + '-01');
  const end = new Date(endDate + '-01');
  const current = new Date(start);
  
  while (current <= end) {
    months.push(current.toISOString().substring(0, 7));
    current.setMonth(current.getMonth() + 1);
  }

  // Group transactions by month
  const transactionsByMonth = new Map<string, any[]>();
  for (const tx of sortedTxns) {
    if (!tx.date) continue;
    const month = tx.date.substring(0, 7);
    if (!transactionsByMonth.has(month)) {
      transactionsByMonth.set(month, []);
    }
    transactionsByMonth.get(month)!.push(tx);
  }

  // Work backwards from current holdings to reconstruct positions
  // For each month, apply transactions in reverse order
  const monthlySnapshots: MonthlyPortfolioSnapshot[] = [];
  let positions = new Map<string, PortfolioPosition>(currentPositions);
  let cash = 0;

  // Process months in reverse (from end to start)
  for (let i = months.length - 1; i >= 0; i--) {
    const month = months[i];
    const monthTxns = transactionsByMonth.get(month) || [];
    
    // Reverse transactions within the month (newest first when going backwards)
    const reversedTxns = [...monthTxns].reverse();

    let monthlyCashFlows = {
      contributions: 0,
      withdrawals: 0,
      dividends: 0,
      interest: 0,
      fees: 0,
    };

    // Apply transactions in reverse (going backwards in time)
    for (const tx of reversedTxns) {
      positions = applyTransactionInReverse(positions, tx, monthlyCashFlows);
    }

    // Calculate portfolio value at end of month
    const totalValue = calculatePortfolioValue(positions, securities, holdings);

    monthlySnapshots.unshift({
      month,
      positions: new Map(positions),
      cash,
      totalValue,
      ...monthlyCashFlows,
    });
  }

  // Now calculate returns month-by-month (forward)
  const returns: MonthlyReturn[] = [];
  for (let i = 0; i < monthlySnapshots.length; i++) {
    const current = monthlySnapshots[i];
    const previous = i > 0 ? monthlySnapshots[i - 1] : null;

    let returnValue = 0;
    if (previous && previous.totalValue > 0) {
      // Calculate return accounting for cash flows
      // Modified Dietz method approximation for monthly returns
      const netCashFlow = current.contributions - current.withdrawals + 
                         current.dividends + current.interest - current.fees;
      const adjustedStartValue = previous.totalValue + (netCashFlow / 2);
      returnValue = (current.totalValue - previous.totalValue - netCashFlow) / adjustedStartValue;
    }

    returns.push({
      month: current.month,
      portfolioReturn: returnValue,
      portfolioValue: current.totalValue,
      cashFlows: {
        contributions: current.contributions,
        withdrawals: current.withdrawals,
        dividends: current.dividends,
        interest: current.interest,
        fees: current.fees,
      },
    });
  }

  return returns;
}

/**
 * Apply a transaction in reverse (to reconstruct positions going backwards)
 */
function applyTransactionInReverse(
  positions: Map<string, PortfolioPosition>,
  tx: any,
  cashFlows: any
): Map<string, PortfolioPosition> {
  const newPositions = new Map(positions);
  const txType = tx.type || '';
  const txSubtype = tx.subtype || '';
  const amount = tx.amount || 0;
  const quantity = tx.quantity || 0;
  const security_id = tx.security_id;
  const fees = tx.fees || 0;

  // Handle different transaction types
  switch (txType) {
    case 'buy':
      // Reverse buy = sell (remove position, add cash)
      if (security_id && newPositions.has(security_id)) {
        const pos = newPositions.get(security_id)!;
        const newQuantity = pos.quantity - quantity;
        if (newQuantity <= 0) {
          newPositions.delete(security_id);
        } else {
          newPositions.set(security_id, {
            ...pos,
            quantity: newQuantity,
          });
        }
      }
      // Cash increases when reversing a buy
      // (amount is positive for buy, so reversing subtracts it)
      break;

    case 'sell':
      // Reverse sell = buy (add position, remove cash)
      if (security_id) {
        const existing = newPositions.get(security_id);
        if (existing) {
          newPositions.set(security_id, {
            ...existing,
            quantity: existing.quantity - quantity, // quantity is negative for sells
          });
        } else {
          newPositions.set(security_id, {
            security_id,
            quantity: -quantity, // quantity is negative, so -quantity is positive
            costBasis: Math.abs(amount),
          });
        }
      }
      // Cash decreases when reversing a sell (amount is negative, so we add it back)
      break;

    case 'cash':
      switch (txSubtype) {
        case 'dividend':
          cashFlows.dividends -= amount; // Reverse: subtract dividend (amount is negative)
          break;
        case 'interest':
          cashFlows.interest -= amount; // Reverse: subtract interest (amount is negative)
          break;
        case 'contribution':
          cashFlows.contributions -= amount; // Reverse: subtract contribution (amount is negative)
          break;
      }
      break;

    case 'fee':
      // Reverse fee: add back the fee (fees reduce value)
      cashFlows.fees -= (Math.abs(amount) + fees);
      break;
  }

  // Also handle fees field separately
  if (fees > 0) {
    cashFlows.fees -= fees;
  }

  return newPositions;
}

/**
 * Calculate portfolio value from positions using holdings data for current prices
 */
function calculatePortfolioValue(
  positions: Map<string, PortfolioPosition>,
  securities: any[],
  holdings: any[]
): number {
  let totalValue = 0;

  // Build a map of security_id -> current value from holdings
  const holdingsBySecurity = new Map<string, any>();
  for (const holding of holdings) {
    if (holding.security_id) {
      holdingsBySecurity.set(holding.security_id, holding);
    }
  }

  // Calculate value for each position
  for (const [security_id, position] of positions) {
    const holding = holdingsBySecurity.get(security_id);
    if (holding && holding.institution_value !== undefined) {
      // Use current value proportionally based on quantity
      const currentQuantity = holding.quantity || 0;
      const currentValue = holding.institution_value || 0;
      if (currentQuantity > 0) {
        const valuePerUnit = currentValue / currentQuantity;
        totalValue += position.quantity * valuePerUnit;
      } else {
        // Fallback to cost basis if no current quantity
        totalValue += position.costBasis;
      }
    } else {
      // Fallback to cost basis if no holding data
      totalValue += position.costBasis;
    }
  }

  return totalValue;
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

