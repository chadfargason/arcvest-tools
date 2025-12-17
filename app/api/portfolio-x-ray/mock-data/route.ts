import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Mock data endpoint for development/testing
 * Returns the raw Plaid data from a test file without requiring Plaid connection
 */
export async function GET(request: NextRequest) {
  try {
    // Read the raw data file
    // In development, this file is at C:\code\portfolio_x_ray\Raw_Data_Dec_17.txt
    // For deployment, we'd need to embed this or use a different approach
    const rawDataPath = path.join(process.cwd(), '..', 'portfolio_x_ray', 'Raw_Data_Dec_17.txt');

    if (!fs.existsSync(rawDataPath)) {
      return NextResponse.json(
        { error: 'Mock data file not found', path: rawDataPath },
        { status: 404 }
      );
    }

    const rawContent = fs.readFileSync(rawDataPath, 'utf-8');
    const rawData = JSON.parse(rawContent);

    // Transform the raw data format to match what fetch-data returns
    const response = {
      transactions: {
        investment_transactions: rawData.transactions?.all_transactions || [],
        accounts: rawData.transactions?.accounts || [],
        securities: rawData.holdings?.all_securities || [], // Securities are in holdings section
        total_investment_transactions: rawData.transactions?.count || 0,
      },
      holdings: {
        accounts: rawData.holdings?.accounts || [],
        holdings: rawData.holdings?.all_holdings || [],
        securities: rawData.holdings?.all_securities || [],
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
