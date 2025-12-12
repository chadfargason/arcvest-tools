import { NextRequest, NextResponse } from 'next/server';
import { createPlaidClient, validatePlaidConfig } from '@/lib/portfolio-x-ray/plaid-client';
import { LinkTokenCreateRequest } from 'plaid';

export async function POST(request: NextRequest) {
  try {
    // Validate configuration
    const configCheck = validatePlaidConfig();
    if (!configCheck.valid) {
      return NextResponse.json(
        { error: configCheck.error },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    const client = createPlaidClient();
    
    const linkTokenRequest: LinkTokenCreateRequest = {
      user: {
        client_user_id: userId,
      },
      client_name: 'ArcVest Portfolio Tools',
      products: ['investments'],
      country_codes: ['US'],
      language: 'en',
      redirect_uri: process.env.PLAID_REDIRECT_URI || 
        `${process.env.NEXT_PUBLIC_APP_URL || 'https://arcvest-tools.vercel.app'}/portfolio-x-ray/oauth-return`,
    };

    // Add webhook if configured
    if (process.env.PLAID_WEBHOOK_URL) {
      linkTokenRequest.webhook = process.env.PLAID_WEBHOOK_URL;
    }

    const response = await client.linkTokenCreate(linkTokenRequest);

    return NextResponse.json({
      link_token: response.data.link_token,
      expiration: response.data.expiration,
    });
  } catch (error: any) {
    console.error('Link token creation error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to create link token',
        details: error.response?.data || error.message 
      },
      { status: 500 }
    );
  }
}

