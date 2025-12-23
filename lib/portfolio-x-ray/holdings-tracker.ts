/**
 * Portfolio X-Ray - Holdings Tracker
 *
 * Handles position reconstruction and monthly snapshot building.
 *
 * Key insight: Holdings from Plaid are as of TODAY, but we need positions
 * at month-ends going back 24 months. We reconstruct by reversing transactions.
 */

import { Security, Holding, Transaction, Position, PortfolioSnapshot } from './types';
import { formatDate, getMonthEnd } from './date-utils';
import { MarketDataProvider } from './market-data';

/**
 * Build current positions from Plaid holdings.
 * Excludes cash equivalents (tracked separately).
 */
export function buildCurrentPositions(
  holdings: Holding[],
  securities: Map<string, Security>
): Map<string, Position> {
  const positions = new Map<string, Position>();

  for (const holding of holdings) {
    const security = securities.get(holding.security_id);

    // Skip cash equivalents - tracked separately
    if (!security || security.is_cash_equivalent) {
      continue;
    }

    positions.set(holding.security_id, {
      security_id: holding.security_id,
      quantity: holding.quantity,
      value: holding.institution_value,
      price: holding.institution_price,
    });
  }

  return positions;
}

/**
 * Get current cash value from holdings.
 */
export function getCurrentCash(
  holdings: Holding[],
  securities: Map<string, Security>
): number {
  let cash = 0;

  for (const holding of holdings) {
    const security = securities.get(holding.security_id);
    if (security?.is_cash_equivalent) {
      cash += holding.institution_value;
    }
  }

  return cash;
}

/**
 * Reconstruct starting positions by reversing transactions.
 *
 * @param currentPositions Positions as of today (from Plaid holdings)
 * @param transactions ALL transactions from start date to today
 * @param securities Security metadata
 * @param currentCash Cash as of today
 * @returns Starting positions and cash as of start date
 */
export function reconstructStartPositions(
  currentPositions: Map<string, Position>,
  transactions: Transaction[],
  securities: Map<string, Security>,
  currentCash: number
): { positions: Map<string, Position>; cash: number } {
  // Start with current quantities
  const quantities = new Map<string, number>();
  for (const [secId, pos] of currentPositions) {
    quantities.set(secId, pos.quantity);
  }

  // Track prices from transactions for valuation
  const priceHistory = new Map<string, number[]>();

  // Reverse all transactions
  let cashDelta = 0;

  for (const tx of transactions) {
    const isCashEquivalent = tx.security_id && securities.get(tx.security_id)?.is_cash_equivalent;
    // Reverse quantity changes for non-cash securities
    if (tx.security_id && !isCashEquivalent) {
      const currentQty = quantities.get(tx.security_id) || 0;
      quantities.set(tx.security_id, currentQty - tx.quantity);

      // Track prices for later valuation
      if (tx.price > 0) {
        if (!priceHistory.has(tx.security_id)) {
          priceHistory.set(tx.security_id, []);
        }
        priceHistory.get(tx.security_id)!.push(tx.price);
      }
    }

    // Reverse cash impact (amount is positive when cash goes out)
    // Skip cash equivalent buy/sell - internal transfers between cash and money market
    if (!isCashEquivalent) {
      cashDelta += tx.amount;
    }
  }

  // Build starting positions with estimated values
  const startPositions = new Map<string, Position>();

  for (const [secId, qty] of quantities) {
    // Skip zero/near-zero positions
    if (Math.abs(qty) < 0.000001) continue;

    // Get price: prefer first transaction price, fall back to current
    const currentPos = currentPositions.get(secId);
    let price = currentPos?.price || 0;

    const prices = priceHistory.get(secId);
    if (prices && prices.length > 0) {
      price = prices[0]; // Use earliest transaction price
    }

    startPositions.set(secId, {
      security_id: secId,
      quantity: qty,
      value: qty * price,
      price: price,
    });
  }

  // Calculate starting cash
  // cashDelta = total cash out - cash in during period
  // startCash + transactions = currentCash => startCash = currentCash + cashDelta
  const startCash = currentCash + cashDelta;

  return { positions: startPositions, cash: startCash };
}

/**
 * Build monthly portfolio snapshots from start to end.
 *
 * @param startPositions Reconstructed starting positions
 * @param startCash Starting cash
 * @param transactions Transactions within the date range
 * @param securities Security metadata
 * @param monthEnds Array of month-end dates
 * @param marketData Market data provider for returns
 * @returns Array of monthly snapshots
 */
export async function buildMonthlySnapshots(
  startPositions: Map<string, Position>,
  startCash: number,
  transactions: Transaction[],
  securities: Map<string, Security>,
  monthEnds: Date[],
  marketData: MarketDataProvider
): Promise<PortfolioSnapshot[]> {
  if (monthEnds.length === 0) {
    return [];
  }

  // Initialize tracking
  const quantities = new Map<string, number>();
  const basePrices = new Map<string, number>();

  for (const [secId, pos] of startPositions) {
    quantities.set(secId, pos.quantity);
    basePrices.set(secId, pos.price);
  }

  // Collect all tickers for market data
  const tickers = new Set<string>();
  for (const [secId, _] of startPositions) {
    const security = securities.get(secId);
    if (security?.ticker_symbol) {
      tickers.add(security.ticker_symbol);
    }
  }
  for (const tx of transactions) {
    const isCashEquivalent = tx.security_id && securities.get(tx.security_id)?.is_cash_equivalent;
    if (tx.security_id) {
      const security = securities.get(tx.security_id);
      if (security?.ticker_symbol) {
        tickers.add(security.ticker_symbol);
      }
    }
  }

  // Fetch market returns
  const startDate = formatDate(monthEnds[0]);
  const endDate = formatDate(monthEnds[monthEnds.length - 1]);
  const returns = await marketData.getMonthlyReturns(Array.from(tickers), startDate, endDate);

  // Build cumulative price indices
  const priceIndices = new Map<string, Map<string, number>>();
  for (const ticker of tickers) {
    const tickerReturns = returns.get(ticker) || new Map();
    const index = new Map<string, number>();
    let cumulativeIndex = 1.0;

    for (const monthEnd of monthEnds) {
      const monthEndStr = formatDate(monthEnd);
      const monthReturn = tickerReturns.get(monthEndStr) || 0;
      cumulativeIndex *= (1 + monthReturn);
      index.set(monthEndStr, cumulativeIndex);
    }

    priceIndices.set(ticker, index);
  }

  // Build snapshots
  const snapshots: PortfolioSnapshot[] = [];
  let cash = startCash;
  let lastMonthEndStr: string | null = null;

  for (const monthEnd of monthEnds) {
    const monthEndStr = formatDate(monthEnd);

    // Apply transactions that occurred in this month
    for (const tx of transactions) {
    const isCashEquivalent = tx.security_id && securities.get(tx.security_id)?.is_cash_equivalent;
      const shouldApply = lastMonthEndStr === null
        ? tx.date <= monthEndStr
        : tx.date > lastMonthEndStr && tx.date <= monthEndStr;

      if (shouldApply) {
        // Update quantities for non-cash securities
        if (tx.security_id && !isCashEquivalent) {
          const currentQty = quantities.get(tx.security_id) || 0;
          quantities.set(tx.security_id, currentQty + tx.quantity);

          // Set base price if not already set
          if (tx.price > 0 && !basePrices.has(tx.security_id)) {
            basePrices.set(tx.security_id, tx.price);
          }
        }

        // Update cash (amount positive = cash out)
        // Skip cash equivalent transactions - internal transfers
        if (!isCashEquivalent) {
          cash -= tx.amount;
        }
      }
    }

    // Value positions at month-end
    const positions = new Map<string, Position>();
    let totalValue = cash;

    for (const [secId, qty] of quantities) {
      if (Math.abs(qty) < 0.000001) continue;

      const security = securities.get(secId);
      if (!security || security.is_cash_equivalent) continue;

      const ticker = security.ticker_symbol;
      const basePrice = basePrices.get(secId) || 0;

      // Apply cumulative return to get current price
      let currentPrice = basePrice;
      if (ticker && priceIndices.has(ticker)) {
        const index = priceIndices.get(ticker)!.get(monthEndStr) || 1.0;
        currentPrice = basePrice * index;
      }

      const value = qty * currentPrice;
      totalValue += value;

      positions.set(secId, {
        security_id: secId,
        quantity: qty,
        value,
        price: currentPrice,
      });
    }

    snapshots.push({
      date: monthEndStr,
      positions,
      cash,
      totalValue,
    });

    lastMonthEndStr = monthEndStr;
  }

  return snapshots;
}

/**
 * Calculate total portfolio value from positions and cash.
 */
export function calculateTotalValue(
  positions: Map<string, Position>,
  cash: number
): number {
  let total = cash;
  for (const pos of positions.values()) {
    total += pos.value;
  }
  return total;
}
