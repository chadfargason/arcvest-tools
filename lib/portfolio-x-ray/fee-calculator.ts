/**
 * Calculate fees from Plaid investment transactions
 */

export interface FeeTransaction {
  date: string;
  amount: number;
  account_id: string;
  name: string;
  type: string;
}

export interface FeeSummary {
  totalFees: number;
  feesByType: { [type: string]: number };
  feesByAccount: { [accountId: string]: number };
  feeTransactions: FeeTransaction[];
}

/**
 * Calculate total fees from investment transactions
 * 
 * Plaid fee structure:
 * - Transactions with type='fee' are explicit fee charges
 * - The 'fees' field on buy/sell transactions contains transaction fees
 * - Account fees appear as type='fee', subtype='account fee'
 */
export function calculateFees(transactions: any[]): FeeSummary {
  const feeTransactions: FeeTransaction[] = [];
  const feesByType: { [type: string]: number } = {};
  const feesByAccount: { [accountId: string]: number } = {};
  let totalFees = 0;

  // Process all transactions to extract fees
  for (const tx of transactions) {
    const accountId = tx.account_id || 'unknown';
    let feeAmount = 0;

    // Explicit fee transactions
    if (tx.type === 'fee') {
      // Fee transactions: amount is positive (expense)
      feeAmount = Math.abs(tx.amount || 0);
    }
    
    // Transaction fees (fees field on buy/sell transactions)
    if (tx.fees && tx.fees > 0) {
      feeAmount += tx.fees;
    }

    if (feeAmount > 0) {
      totalFees += feeAmount;

      // Track by type/subtype
      const feeType = tx.subtype || tx.type || 'fee';
      feesByType[feeType] = (feesByType[feeType] || 0) + feeAmount;

      // Track by account
      feesByAccount[accountId] = (feesByAccount[accountId] || 0) + feeAmount;

      feeTransactions.push({
        date: tx.date || '',
        amount: feeAmount,
        account_id: accountId,
        name: tx.name || 'Fee',
        type: feeType,
      });
    }
  }

  // Also check for expense ratio fees (may appear as periodic small fees)
  // These are typically embedded in share prices, but some custodians report them separately
  const expenseRatioFees = transactions.filter(tx => 
    tx.name && (
      tx.name.toLowerCase().includes('expense') ||
      tx.name.toLowerCase().includes('er ') ||
      tx.name.toLowerCase().includes('management fee')
    )
  );

  for (const tx of expenseRatioFees) {
    const feeAmount = Math.abs(tx.amount || 0);
    if (feeAmount > 0 && !feeTransactions.some(ft => ft.date === tx.date && ft.amount === feeAmount)) {
      totalFees += feeAmount;
      feesByType['expense_ratio'] = (feesByType['expense_ratio'] || 0) + feeAmount;
      
      const accountId = tx.account_id || 'unknown';
      feesByAccount[accountId] = (feesByAccount[accountId] || 0) + feeAmount;

      feeTransactions.push({
        date: tx.date || '',
        amount: feeAmount,
        account_id: accountId,
        name: tx.name || 'Expense Ratio',
        type: 'expense_ratio',
      });
    }
  }

  // Sort fee transactions by date (newest first)
  feeTransactions.sort((a, b) => b.date.localeCompare(a.date));

  return {
    totalFees,
    feesByType,
    feesByAccount,
    feeTransactions,
  };
}

