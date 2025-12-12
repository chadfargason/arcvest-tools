import { NextRequest, NextResponse } from 'next/server';
import { createPlaidClient, validatePlaidConfig } from '@/lib/portfolio-x-ray/plaid-client';
import { ItemPublicTokenExchangeRequest } from 'plaid';

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
    const { public_token } = body;

    if (!public_token) {
      return NextResponse.json(
        { error: 'public_token is required' },
        { status: 400 }
      );
    }

    const client = createPlaidClient();

    const exchangeRequest: ItemPublicTokenExchangeRequest = {
      public_token,
    };

    const response = await client.itemPublicTokenExchange(exchangeRequest);

    return NextResponse.json({
      access_token: response.data.access_token,
      item_id: response.data.item_id,
    });
  } catch (error: any) {
    console.error('Token exchange error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to exchange token',
        details: error.response?.data || error.message 
      },
      { status: 500 }
    );
  }
}

