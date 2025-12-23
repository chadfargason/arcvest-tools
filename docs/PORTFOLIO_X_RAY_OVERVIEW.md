# Portfolio X-Ray: Complete Documentation

## Overview

Portfolio X-Ray is a comprehensive portfolio analysis tool that connects to brokerage accounts via Plaid, retrieves investment data, and generates detailed performance reports with benchmark comparisons.

## Current Status

- **Environment**: Sandbox (transitioning to Production)
- **OAuth Registration**: Approved (December 2024)
- **Production Migration**: See [PLAID_PRODUCTION_MIGRATION.md](./PLAID_PRODUCTION_MIGRATION.md)

---

## Architecture

### System Flow

```
User Interface (portfolio-x-ray.html)
    │
    ├── 1. Connect Account
    │   └── POST /api/portfolio-x-ray/link-token
    │       └── Returns Plaid Link token
    │
    ├── 2. User Authenticates via Plaid Link
    │   └── POST /api/portfolio-x-ray/exchange-token
    │       └── Exchanges public token for access token
    │
    ├── 3. Fetch Investment Data
    │   └── POST /api/portfolio-x-ray/fetch-data
    │       └── Returns holdings, transactions, securities (24 months)
    │
    ├── 4. Analyze Portfolio
    │   └── POST /api/portfolio-x-ray/analyze
    │       └── Returns comprehensive analysis with benchmarks
    │
    └── 5. Generate Report
        └── POST /api/portfolio-x-ray/request-report
            └── Returns PDF report (optionally emails it)
```

### Core Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Frontend | `app/portfolio-x-ray/page.tsx` | React wrapper for the tool |
| UI | `public/portfolio-x-ray.html` | Main interface (vanilla JS) |
| API Routes | `app/api/portfolio-x-ray/` | 6 API endpoints |
| Library | `lib/portfolio-x-ray/` | 16 analysis modules |

---

## Library Modules

### Data Processing

| Module | Purpose |
|--------|---------|
| `plaid-parser.ts` | Parses raw Plaid API responses |
| `plaid-client.ts` | Configures Plaid SDK client |
| `holdings-tracker.ts` | Reconstructs historical positions from transactions |
| `cashflow-analyzer.ts` | Identifies external deposits/withdrawals |

### Calculations

| Module | Purpose |
|--------|---------|
| `portfolio-analyzer.ts` | Main orchestrator - coordinates all analysis |
| `return-calculator.ts` | Portfolio and benchmark return calculations |
| `irr-calculator.ts` | XIRR (money-weighted return) implementation |
| `fee-calculator.ts` | Explicit fees + implicit expense ratios |
| `benchmark-matcher.ts` | Maps holdings to benchmark proxies |
| `market-data.ts` | Fetches monthly returns from Supabase |

### Utilities

| Module | Purpose |
|--------|---------|
| `types.ts` | TypeScript type definitions |
| `config.ts` | Configuration (benchmarks, expense ratios, etc.) |
| `date-utils.ts` | Date formatting and calculations |
| `security-ledger.ts` | Transaction ledgers for debugging/PDF |
| `debug-export.ts` | CSV/text exports for verification |

---

## Key Features

### 1. 24-Month Historical Analysis
- Retrieves transactions going back 24 months
- Reconstructs month-end portfolio snapshots
- Handles position changes, dividends, and corporate actions

### 2. Position Reconstruction
- Plaid only provides TODAY's holdings
- System reverse-engineers historical positions from transaction history
- Tracks each security's quantity and value at each month-end

### 3. Benchmark Comparison
- Maps each holding to a benchmark proxy:
  - US Large Cap → SPY
  - International Developed → VEA
  - Emerging Markets → VWO
  - US Bonds → AGG
  - US Mid Cap → IJH
  - US Small Cap → IWM
  - Cash → SGOV
- Calculates dollar-weighted benchmark portfolio
- Tracks benchmark evolution month-by-month

### 4. XIRR Calculation
- Money-weighted internal rate of return
- Accounts for timing of deposits/withdrawals
- More accurate than time-weighted returns for individual investors

### 5. Fee Transparency (Phase 2 - Ready)
- **Explicit fees**: Transaction fees, account fees captured from Plaid
- **Implicit fees**: Expense ratios calculated from holdings
- Currently hidden in PDF output; ready to enable

### 6. Comprehensive PDF Reports
Report sections:
1. Executive Summary
2. Portfolio Holdings (as of month-end)
3. Current Holdings from Plaid (reconciliation)
4. Benchmark Composition
5. Monthly Portfolio Values
6. IRR Calculation Cashflows
7. Benchmark Performance Details
8. Transaction History (by account)
9. Transaction Ledger (by security)
10. Security Position Ledgers
11. Cash Position Ledger

### 7. Email Delivery
- Optional email delivery via MailerSend
- Falls back to PDF download if email fails

---

## Configuration

### Environment Variables

```bash
# Plaid Configuration
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_secret_key
PLAID_ENV=sandbox  # or 'production'
PLAID_REDIRECT_URI=https://arcvest-tools.vercel.app/portfolio-x-ray/oauth-return

# Supabase (for market data)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Email (optional)
MAILERSEND_API_KEY=your_mailersend_key
```

### Benchmark Configuration

Defined in `lib/portfolio-x-ray/config.ts`:

```typescript
export const TICKER_BENCHMARK_MAP: Record<string, string> = {
  // US Large Cap → SPY
  'VTI': 'SPY', 'VOO': 'SPY', 'IVV': 'SPY',

  // International → VEA
  'VXUS': 'VEA', 'VEU': 'VEA', 'IXUS': 'VEA',

  // Emerging Markets → VWO
  'VWO': 'VWO', 'IEMG': 'VWO', 'EEM': 'VWO',

  // Bonds → AGG
  'BND': 'AGG', 'VBTLX': 'AGG',

  // ... 30+ mappings
};
```

### Expense Ratios

Defined in `lib/portfolio-x-ray/config.ts`:

```typescript
export const DEFAULT_EXPENSE_RATIOS: Record<string, number> = {
  'SPY': 0.0945,
  'VTI': 0.03,
  'VOO': 0.03,
  'VEA': 0.05,
  'AGG': 0.03,
  // ... 40+ funds with specific ratios
};
```

---

## Data Flow Details

### 1. Plaid Data Ingestion

```
Plaid API Response
├── accounts: Account[]        → Account metadata
├── holdings: Holding[]        → Current positions (TODAY)
├── securities: Security[]     → Security details (ticker, name, type)
└── transactions: Transaction[] → 24 months of activity
```

### 2. Position Reconstruction

```typescript
// Problem: Plaid only gives us TODAY's holdings
// Solution: Reverse-engineer historical positions

For each month-end going backward:
  1. Start with current holdings
  2. Reverse each transaction:
     - BUY: Subtract shares (we had fewer before)
     - SELL: Add shares back (we had more before)
     - DIVIDEND: No change to shares
  3. Apply that month's prices to get values
```

### 3. Return Calculation

```typescript
// Portfolio returns use Modified Dietz method:
return = (endValue - startValue - cashflows) /
         (startValue + timeWeightedCashflows)

// Also calculate XIRR for money-weighted return
// Uses bisection method to solve:
// 0 = sum(cashflow_i / (1 + rate)^(days_i/365))
```

### 4. Benchmark Calculation

```typescript
// For each month:
1. Calculate dollar-weighted benchmark allocation
2. Apply benchmark returns to each component
3. Apply SGOV rate to cash portion
4. Track cumulative benchmark value
```

---

## API Endpoints

### POST /api/portfolio-x-ray/link-token

Creates a Plaid Link token for account connection.

**Request**: Empty body

**Response**:
```json
{
  "link_token": "link-sandbox-xxx",
  "expiration": "2024-12-18T12:00:00Z"
}
```

### POST /api/portfolio-x-ray/exchange-token

Exchanges public token for access token.

**Request**:
```json
{
  "public_token": "public-sandbox-xxx"
}
```

**Response**:
```json
{
  "access_token": "access-sandbox-xxx"
}
```

### POST /api/portfolio-x-ray/fetch-data

Retrieves investment data from Plaid.

**Request**:
```json
{
  "access_token": "access-sandbox-xxx"
}
```

**Response**:
```json
{
  "holdings": [...],
  "transactions": [...],
  "securities": [...],
  "accounts": [...]
}
```

### POST /api/portfolio-x-ray/analyze

Performs comprehensive portfolio analysis.

**Request**:
```json
{
  "holdings": [...],
  "transactions": [...],
  "securities": [...],
  "accounts": [...]
}
```

**Response**:
```json
{
  "summary": {
    "startDate": "2022-12-31",
    "endDate": "2024-11-30",
    "startValue": 100000,
    "endValue": 125000,
    "totalReturn": 0.25,
    "annualizedReturn": 0.118,
    "irr": 0.112,
    "benchmarkReturn": 0.22,
    "outperformance": 0.03
  },
  "monthlyAnalysis": [...],
  "holdings": [...],
  "benchmarkComposition": [...],
  "cashflows": [...],
  "securityLedgers": [...]
}
```

### POST /api/portfolio-x-ray/request-report

Generates PDF report.

**Request**:
```json
{
  "analysis": { ... },
  "email": "optional@email.com"
}
```

**Response**: PDF file (or JSON with download URL)

### POST /api/portfolio-x-ray/mock-data

Development endpoint for testing without Plaid.

---

## Troubleshooting

### Common Issues

1. **"PLAID_CLIENT_ID is not configured"**
   - Check `.env.local` has all Plaid variables
   - Restart development server after changes

2. **Holdings don't match Plaid**
   - This is expected for month-end snapshots
   - Current Plaid holdings section shows real-time comparison

3. **Benchmark returns seem off**
   - Check `asset_returns` table in Supabase has data
   - Verify ticker mappings in config.ts

4. **PDF generation fails**
   - Check memory limits (large transaction histories)
   - Verify jsPDF dependencies installed

5. **Cash ledger discrepancy**
   - Fixed in Dec 2024: now includes all cash-affecting transactions
   - See commit `1dfc4a6`

### Debug Tools

1. **Mock Data Endpoint**: Use `/api/portfolio-x-ray/mock-data` for testing
2. **Security Ledgers**: PDF includes detailed position reconstruction
3. **CSV Export**: `debug-export.ts` can export to CSV for verification

---

## Version History

### December 2024
- Cash ledger fix: Include all cash-affecting transactions
- Plaid production migration documentation
- OAuth registration approved

### November 2024
- Initial release of Portfolio X-Ray
- 24-month historical analysis
- Benchmark comparison with 6 asset class proxies
- XIRR calculation
- PDF report generation with email delivery
- Security and cash ledgers for transparency

---

## Related Documentation

- [PLAID_PRODUCTION_MIGRATION.md](./PLAID_PRODUCTION_MIGRATION.md) - Production migration checklist
- [PORTFOLIO_X_RAY_CALCULATIONS.md](./PORTFOLIO_X_RAY_CALCULATIONS.md) - Calculation methodology details
