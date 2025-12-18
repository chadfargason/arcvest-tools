# Plaid Sandbox to Production Migration Guide

## Current Status

- **OAuth Registration**: Approved (as of Dec 2024)
- **Environment**: Currently using Sandbox
- **Waiting on**: Production secret to become available in Plaid Dashboard

## Institution Access Timeline

Per Plaid's email:
- **Wells Fargo, USAA, Capital One**: Should work immediately after production setup
- **Chase**: Allow 2 additional weeks for OAuth access
- **Charles Schwab**: Allow 2-4 additional weeks for OAuth access

Check status at: [Plaid OAuth Dashboard](https://dashboard.plaid.com/)

---

## Migration Checklist

### 1. Get Production Credentials

- [ ] Log into [Plaid Dashboard](https://dashboard.plaid.com/)
- [ ] Go to **Team Settings → Keys**
- [ ] Copy **Production secret** (different from sandbox secret)
- [ ] Note: `PLAID_CLIENT_ID` stays the same

### 2. Update Environment Variables

Update `.env.local` (and Vercel environment variables):

```bash
# Change from sandbox to production
PLAID_ENV=production

# Use production secret (NOT the sandbox secret)
PLAID_SECRET=<your-production-secret>

# Keep redirect URI for OAuth
PLAID_REDIRECT_URI=https://arcvest-tools.vercel.app/portfolio-x-ray/oauth-return
```

### 3. Configure Redirect URI in Plaid Dashboard

**Critical for OAuth institutions** (Wells Fargo, USAA, Capital One, etc.)

1. Go to Plaid Dashboard → **Team Settings → API → Allowed redirect URIs**
2. Add: `https://arcvest-tools.vercel.app/portfolio-x-ray/oauth-return`
3. Must be HTTPS in production

### 4. Create OAuth Return Page

Create a page at `/portfolio-x-ray/oauth-return` to handle the OAuth callback.

**File**: `app/portfolio-x-ray/oauth-return/page.tsx`

```tsx
'use client';

import { useEffect } from 'react';

export default function OAuthReturn() {
  useEffect(() => {
    // Plaid Link will handle the OAuth return automatically
    // This page just needs to exist for the redirect

    // If opened in a popup, close it and let parent handle
    if (window.opener) {
      window.close();
    }
  }, []);

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      fontFamily: 'system-ui, sans-serif'
    }}>
      <p>Completing authentication... Please wait.</p>
    </div>
  );
}
```

### 5. Update Link Token Creation

Modify `app/api/portfolio-x-ray/link-token/route.ts` to include redirect_uri:

```typescript
const linkTokenRequest: any = {
  user: {
    client_user_id: userId,
  },
  client_name: 'ArcVest Portfolio Tools',
  products: ['investments'],
  country_codes: ['US'],
  language: 'en',
  redirect_uri: process.env.PLAID_REDIRECT_URI,  // ADD THIS LINE
};
```

**Why**: Without `redirect_uri`, OAuth institutions won't appear in the Link UI.

### 6. Update Vercel Environment Variables

1. Go to Vercel Dashboard → Project → Settings → Environment Variables
2. Update/Add:
   - `PLAID_ENV` = `production`
   - `PLAID_SECRET` = `<production-secret>`
   - `PLAID_REDIRECT_URI` = `https://arcvest-tools.vercel.app/portfolio-x-ray/oauth-return`

---

## Testing Production

### Quick Smoke Test

1. Deploy changes to Vercel
2. Visit https://arcvest-tools.vercel.app/portfolio-x-ray
3. Click "Connect Account"
4. Verify real institutions appear (not just sandbox test banks)
5. Try connecting to a real account

### Common Issues

**OAuth institutions not appearing:**
- Check `redirect_uri` is included in link token request
- Verify redirect URI is in Plaid Dashboard allowed list
- Ensure production secret is being used

**Authentication errors:**
- Double-check you're using the production secret, not sandbox
- Verify `PLAID_ENV=production`

**"Institution not supported" errors:**
- Some institutions require additional Plaid approval
- Check OAuth Dashboard for pending approvals

---

## Files to Modify

| File | Change |
|------|--------|
| `.env.local` | Update PLAID_ENV and PLAID_SECRET |
| `app/api/portfolio-x-ray/link-token/route.ts` | Add redirect_uri parameter |
| `app/portfolio-x-ray/oauth-return/page.tsx` | Create OAuth return page |
| Vercel Dashboard | Update environment variables |

---

## Reference Documentation

- [Plaid OAuth Guide](https://plaid.com/docs/link/oauth/)
- [Plaid Launch Checklist](https://plaid.com/docs/launch-checklist/)
- [Plaid Link API](https://plaid.com/docs/api/link/)
- [Plaid Sandbox Overview](https://plaid.com/docs/sandbox/)

---

## Current Configuration

**File**: `lib/portfolio-x-ray/plaid-client.ts`

The client automatically selects the correct Plaid environment based on `PLAID_ENV`:
- `sandbox` → PlaidEnvironments.sandbox
- `production` → PlaidEnvironments.production

No code changes needed in plaid-client.ts - it's already configured to handle both environments.
