import { NextRequest, NextResponse } from 'next/server';
import { createPlaidClient, validatePlaidConfig } from '@/lib/portfolio-x-ray/plaid-client';
import { InvestmentsHoldingsGetRequest } from 'plaid';

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

    // Use investmentsHoldingsGet to get accounts - it's a lightweight call
    // that returns account info without needing to paginate through transactions
    const holdingsRequest: InvestmentsHoldingsGetRequest = {
      access_token,
    };

    const holdingsResponse = await client.investmentsHoldingsGet(holdingsRequest);

    // Extract account information
    const accounts = holdingsResponse.data.accounts.map((account) => ({
      account_id: account.account_id,
      name: account.name,
      official_name: account.official_name,
      type: account.type,
      subtype: account.subtype,
      mask: account.mask,
      // Include current balance info for context
      balances: {
        current: account.balances.current,
        available: account.balances.available,
        iso_currency_code: account.balances.iso_currency_code,
      },
    }));

    // Also get holdings count per account for display
    const holdingsByAccount: Record<string, number> = {};
    for (const holding of holdingsResponse.data.holdings) {
      const accId = holding.account_id;
      holdingsByAccount[accId] = (holdingsByAccount[accId] || 0) + 1;
    }

    // Enrich accounts with holdings count
    const enrichedAccounts = accounts.map((account) => ({
      ...account,
      holdings_count: holdingsByAccount[account.account_id] || 0,
    }));

    return NextResponse.json({
      accounts: enrichedAccounts,
      institution: holdingsResponse.data.item?.institution_id || null,
    });
  } catch (error: any) {
    console.error('List accounts error:', error);

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
        error: 'Failed to list accounts',
        details: error.response?.data || error.message
      },
      { status: 500 }
    );
  }
}
