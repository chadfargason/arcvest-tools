import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

/**
 * Create and configure Plaid client
 */
export function createPlaidClient() {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = process.env.PLAID_ENV || 'sandbox';
  
  if (!clientId || !secret) {
    throw new Error('Plaid credentials not configured: PLAID_CLIENT_ID and PLAID_SECRET required');
  }

  const configuration = new Configuration({
    basePath: 
      env === 'production' 
        ? PlaidEnvironments.production 
        : PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': secret,
      },
    },
  });

  return new PlaidApi(configuration);
}

/**
 * Validate Plaid configuration
 */
export function validatePlaidConfig(): { valid: boolean; error?: string } {
  if (!process.env.PLAID_CLIENT_ID) {
    return { valid: false, error: 'PLAID_CLIENT_ID is not configured' };
  }
  if (!process.env.PLAID_SECRET) {
    return { valid: false, error: 'PLAID_SECRET is not configured' };
  }
  if (!process.env.PLAID_ENV) {
    return { valid: false, error: 'PLAID_ENV is not configured' };
  }
  return { valid: true };
}

