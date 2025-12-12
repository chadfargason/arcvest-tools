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
    
    const linkTokenRequest = {
      user: {
        client_user_id: userId,
      },
      client_name: 'ArcVest Portfolio Tools',
      products: ['investments'] as any, // Plaid types may be strict, but API accepts this
      country_codes: ['US'],
      language: 'en',
    } as LinkTokenCreateRequest;

    // Add redirect_uri only if configured (required for OAuth flow, optional for standard Link)
    if (process.env.PLAID_REDIRECT_URI) {
      linkTokenRequest.redirect_uri = process.env.PLAID_REDIRECT_URI;
    }

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
    
    // Extract detailed error information
    let errorMessage = 'Unknown error';
    let errorDetails: any = null;
    
    if (error.response?.data) {
      // Plaid API error response
      errorDetails = error.response.data;
      errorMessage = errorDetails.error_message || errorDetails.error_code || errorDetails.message || 'Plaid API error';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    const configCheck = validatePlaidConfig();
    console.error('Error details:', {
      message: errorMessage,
      plaidResponse: errorDetails,
      status: error.response?.status,
      configValid: configCheck.valid,
    });
    
    return NextResponse.json(
      { 
        error: 'Failed to create link token',
        details: errorMessage,
        plaidError: errorDetails,
        configValid: configCheck.valid,
      },
      { status: 500 }
    );
  }
}

