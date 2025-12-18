/**
 * Portfolio X-Ray - Plaid Data Parser
 *
 * Parses raw Plaid API responses into typed structures.
 * This module preserves the exact Plaid interface - no changes to input format.
 */

import { Security, Holding, Transaction } from './types';

/**
 * Parse securities from Plaid response.
 * Handles securities from holdings, transactions, and dedicated securities responses.
 */
export function parseSecurities(
  holdingsData: any,
  transactionsData: any,
  securitiesData?: any
): Map<string, Security> {
  const securities = new Map<string, Security>();

  // Collect securities from all sources
  const allSecurities = [
    ...(holdingsData?.securities || []),
    ...(transactionsData?.securities || []),
    ...(securitiesData?.securities || []),
  ];

  // Deduplicate by security_id
  for (const s of allSecurities) {
    if (s.security_id && !securities.has(s.security_id)) {
      securities.set(s.security_id, {
        security_id: s.security_id,
        ticker_symbol: s.ticker_symbol || null,
        name: s.name || 'Unknown',
        type: s.type || 'unknown',
        is_cash_equivalent: s.is_cash_equivalent || false,
      });
    }
  }

  return securities;
}

/**
 * Parse holdings from Plaid response.
 */
export function parseHoldings(holdingsData: any): Holding[] {
  const rawHoldings = holdingsData?.holdings || [];

  return rawHoldings.map((h: any) => ({
    account_id: h.account_id,
    security_id: h.security_id,
    quantity: parseFloat(h.quantity || 0),
    institution_value: parseFloat(h.institution_value || 0),
    institution_price: parseFloat(h.institution_price || 0),
  }));
}

/**
 * Parse transactions from Plaid response.
 */
export function parseTransactions(transactionsData: any): Transaction[] {
  const rawTransactions = transactionsData?.investment_transactions || [];

  return rawTransactions.map((t: any) => ({
    account_id: t.account_id,
    security_id: t.security_id || null,
    date: t.date,
    type: t.type,
    subtype: t.subtype || null,
    quantity: parseFloat(t.quantity || 0),
    amount: parseFloat(t.amount || 0),
    price: parseFloat(t.price || 0),
    fees: parseFloat(t.fees || 0),
    name: t.name || '',
  }));
}

/**
 * Get unique account IDs from holdings and transactions.
 */
export function getAccountIds(holdings: Holding[], transactions: Transaction[]): Set<string> {
  const accountIds = new Set<string>();

  for (const h of holdings) {
    accountIds.add(h.account_id);
  }

  for (const t of transactions) {
    accountIds.add(t.account_id);
  }

  return accountIds;
}

/**
 * Parse all Plaid data in one call.
 */
export function parsePlaidData(
  holdingsData: any,
  transactionsData: any,
  securitiesData?: any
): {
  securities: Map<string, Security>;
  holdings: Holding[];
  transactions: Transaction[];
  accountIds: Set<string>;
} {
  const securities = parseSecurities(holdingsData, transactionsData, securitiesData);
  const holdings = parseHoldings(holdingsData);
  const transactions = parseTransactions(transactionsData);
  const accountIds = getAccountIds(holdings, transactions);

  return { securities, holdings, transactions, accountIds };
}
