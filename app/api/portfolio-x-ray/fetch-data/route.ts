import { NextRequest, NextResponse } from 'next/server';
import { createPlaidClient, validatePlaidConfig } from '@/lib/portfolio-x-ray/plaid-client';
import { 
  InvestmentsTransactionsGetRequest,
  InvestmentsHoldingsGetRequest,
} from 'plaid';

export async function POST(request: NextRequest) {
  try {
    const configCheck = validatePlaidConfig();
    if (!configCheck.valid) {
      return NextResponse.json(
        { error: configCheck.error },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { access_token } = body;

    if (!access_token) {
      return NextResponse.json(
        { error: 'access_token is required' },
        { status: 400 }
      );
    }

    const client = createPlaidClient();

    // Calculate date range (24 months ago to today)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 24);
    
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // Fetch investment transactions (24 months)
    const transactionsRequest: InvestmentsTransactionsGetRequest = {
      access_token,
      start_date: startDateStr,
      end_date: endDateStr,
    };

    const transactionsResponse = await client.investmentsTransactionsGet(transactionsRequest);
    
    // Handle pagination if needed
    let allTransactions = transactionsResponse.data.investment_transactions || [];
    let cursor = transactionsResponse.data.total_investment_transactions > allTransactions.length 
      ? transactionsResponse.data.cursor 
      : null;

    // Fetch more pages if needed
    while (cursor) {
      const paginatedRequest: InvestmentsTransactionsGetRequest = {
        access_token,
        start_date: startDateStr,
        end_date: endDateStr,
        cursor,
      };
      const paginatedResponse = await client.investmentsTransactionsGet(paginatedRequest);
      allTransactions = allTransactions.concat(paginatedResponse.data.investment_transactions || []);
      cursor = paginatedResponse.data.cursor || null;
    }

    // Fetch current holdings
    const holdingsRequest: InvestmentsHoldingsGetRequest = {
      access_token,
    };

    const holdingsResponse = await client.investmentsHoldingsGet(holdingsRequest);

    return NextResponse.json({
      transactions: {
        investment_transactions: allTransactions,
        accounts: transactionsResponse.data.accounts,
        securities: transactionsResponse.data.securities,
        total_investment_transactions: allTransactions.length,
      },
      holdings: {
        accounts: holdingsResponse.data.accounts,
        holdings: holdingsResponse.data.holdings,
        securities: holdingsResponse.data.securities,
      },
    });
  } catch (error: any) {
    console.error('Fetch data error:', error);
    
    // Handle specific Plaid errors
    if (error.response?.data?.error_code === 'ITEM_LOGIN_REQUIRED') {
      return NextResponse.json(
        { 
          error: 'ITEM_LOGIN_REQUIRED',
          message: 'Please reconnect your account' 
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { 
        error: 'Failed to fetch data',
        details: error.response?.data || error.message 
      },
      { status: 500 }
    );
  }
}

