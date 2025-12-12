import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

/**
 * Create and configure Plaid client
 */
export function createPlaidClient() {
  const configuration = new Configuration({
    basePath: 
      process.env.PLAID_ENV === 'production' 
        ? PlaidEnvironments.production 
        : PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID!,
        'PLAID-SECRET': process.env.PLAID_SECRET!,
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

