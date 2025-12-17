import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Mock data endpoint for development/testing
 * Returns the raw Plaid data from a test file without requiring Plaid connection
 */
export async function GET(request: NextRequest) {
  try {
    // Read the raw data file - try multiple possible locations
    const possiblePaths = [
      // Absolute path (works on dev machine)
      'C:\\code\\portfolio_x_ray\\Raw_Data_Dec_17.txt',
      // Relative to cwd (if running from fargason-capital-site)
      path.join(process.cwd(), '..', 'portfolio_x_ray', 'Raw_Data_Dec_17.txt'),
      // Relative to cwd (if running from code directory)
      path.join(process.cwd(), 'portfolio_x_ray', 'Raw_Data_Dec_17.txt'),
    ];

    let rawDataPath: string | null = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        rawDataPath = p;
        break;
      }
    }

    if (!rawDataPath) {
      return NextResponse.json(
        { error: 'Mock data file not found', triedPaths: possiblePaths, cwd: process.cwd() },
        { status: 404 }
      );
    }

    const rawContent = fs.readFileSync(rawDataPath, 'utf-8');
    const rawData = JSON.parse(rawContent);

    // Extract all transactions and holdings
    const allTransactions = rawData.transactions?.all_transactions || [];
    const allHoldings = rawData.holdings?.all_holdings || [];
    const allSecurities = rawData.holdings?.all_securities || [];

    // Build accounts array from unique account IDs in transactions/holdings
    const accountIds = new Set<string>();
    for (const tx of allTransactions) {
      if (tx.account_id) accountIds.add(tx.account_id);
    }
    for (const h of allHoldings) {
      if (h.account_id) accountIds.add(h.account_id);
    }

    // Create mock account objects (Plaid returns these with more fields, but we only need account_id)
    const accounts = Array.from(accountIds).map(id => ({
      account_id: id,
      name: `Investment Account ${id.substring(0, 8)}`,
      type: 'investment',
      subtype: 'brokerage',
    }));

    // Transform the raw data format to match what fetch-data returns
    const response = {
      transactions: {
        investment_transactions: allTransactions,
        accounts: accounts,
        securities: allSecurities,
        total_investment_transactions: allTransactions.length,
      },
      holdings: {
        accounts: accounts,
        holdings: allHoldings,
        securities: allSecurities,
      },
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Mock data error:', error);
    return NextResponse.json(
      {
        error: 'Failed to load mock data',
        details: error.message
      },
      { status: 500 }
    );
  }
}
