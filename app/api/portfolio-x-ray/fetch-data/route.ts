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

    // Fetch investment transactions (24 months) with pagination
    // Plaid returns max 100 transactions per request, use offset/count for pagination
    const PAGE_SIZE = 100;
    let allTransactions: any[] = [];
    let allSecurities: any[] = [];
    let accounts: any[] = [];
    let totalTransactions = 0;
    let offset = 0;

    // First request to get total count
    const firstRequest: InvestmentsTransactionsGetRequest = {
      access_token,
      start_date: startDateStr,
      end_date: endDateStr,
      options: {
        count: PAGE_SIZE,
        offset: 0,
      },
    };

    const firstResponse = await client.investmentsTransactionsGet(firstRequest);
    allTransactions = firstResponse.data.investment_transactions || [];
    allSecurities = firstResponse.data.securities || [];
    accounts = firstResponse.data.accounts || [];
    totalTransactions = firstResponse.data.total_investment_transactions;

    console.log(`Fetched ${allTransactions.length} of ${totalTransactions} transactions (page 1)`);

    // Fetch remaining pages if needed
    offset = allTransactions.length;
    while (offset < totalTransactions) {
      const paginatedRequest: InvestmentsTransactionsGetRequest = {
        access_token,
        start_date: startDateStr,
        end_date: endDateStr,
        options: {
          count: PAGE_SIZE,
          offset: offset,
        },
      };

      const paginatedResponse = await client.investmentsTransactionsGet(paginatedRequest);
      const newTransactions = paginatedResponse.data.investment_transactions || [];
      const newSecurities = paginatedResponse.data.securities || [];

      allTransactions = allTransactions.concat(newTransactions);

      // Merge securities (avoid duplicates)
      for (const sec of newSecurities) {
        if (!allSecurities.find(s => s.security_id === sec.security_id)) {
          allSecurities.push(sec);
        }
      }

      offset += newTransactions.length;
      console.log(`Fetched ${allTransactions.length} of ${totalTransactions} transactions (offset: ${offset})`);

      // Safety check to prevent infinite loop
      if (newTransactions.length === 0) {
        console.log('No more transactions returned, stopping pagination');
        break;
      }
    }

    console.log(`Total transactions fetched: ${allTransactions.length}`);

    // Fetch current holdings
    const holdingsRequest: InvestmentsHoldingsGetRequest = {
      access_token,
    };

    const holdingsResponse = await client.investmentsHoldingsGet(holdingsRequest);

    return NextResponse.json({
      transactions: {
        investment_transactions: allTransactions,
        accounts: accounts,
        securities: allSecurities,
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
