# Portfolio X-Ray Documentation

> **Last Updated:** December 29, 2025
> **Status:** Production - Live at tools.arcvest.com/portfolio-x-ray

---

## Overview

**Portfolio X-Ray** is a portfolio analysis tool that helps investors understand their investment performance by:

- Connecting to financial institutions via Plaid API to retrieve 24 months of transaction history
- Analyzing current investment holdings
- Calculating portfolio returns vs. weighted benchmark ETFs
- Computing explicit (transaction fees) and implicit (expense ratio) fees
- Generating performance reports with outperformance metrics
- Delivering detailed PDF reports via email

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15.1.9, React 19, Static HTML UI (iframe), Tailwind CSS |
| Backend | Next.js API Routes (TypeScript) |
| Data Integration | Plaid SDK v40.0.0 (investment accounts) |
| Database | Supabase (market data / benchmark returns) |
| PDF Generation | pdf-lib v1.17.1, @pdf-lib/fontkit v1.1.1 |
| Deployment | Vercel |

---

## Project Structure

```
fargason-capital-site/
├── app/
│   ├── portfolio-x-ray/
│   │   ├── page.tsx                    # Main page wrapper (header + iframe)
│   │   └── oauth-return/page.tsx       # Plaid OAuth callback handler
│   └── api/portfolio-x-ray/
│       ├── link-token/route.ts         # Generate Plaid Link token
│       ├── exchange-token/route.ts     # Exchange public token for access token
│       ├── fetch-data/route.ts         # Fetch transactions & holdings from Plaid
│       ├── analyze/route.ts            # Main analysis orchestrator
│       ├── request-report/route.ts     # Generate and email PDF report
│       └── mock-data/route.ts          # Test data endpoint
├── lib/portfolio-x-ray/
│   ├── types.ts                        # Central type definitions
│   ├── config.ts                       # Constants, expense ratios, benchmarks
│   ├── portfolio-analyzer.ts           # Main orchestrator
│   ├── plaid-parser.ts                 # Parse Plaid API responses
│   ├── plaid-client.ts                 # Plaid API client setup
│   ├── market-data.ts                  # Supabase data fetching
│   ├── holdings-tracker.ts             # Position reconstruction
│   ├── benchmark-matcher.ts            # Map securities to benchmarks
│   ├── return-calculator.ts            # Calculate portfolio & benchmark returns
│   ├── irr-calculator.ts               # XIRR and Modified Dietz algorithms
│   ├── cashflow-analyzer.ts            # Extract external cash flows
│   ├── fee-calculator.ts               # Calculate explicit & implicit fees
│   ├── security-ledger.ts              # Build per-security transaction ledgers
│   ├── date-utils.ts                   # Date manipulation utilities
│   └── debug-export.ts                 # Export debug CSV files
├── public/
│   └── portfolio-x-ray.html            # Frontend UI (static HTML with JavaScript)
└── data/
    └── Raw Data.txt                    # Test data file (development)
```

### Additional Documentation

Located in `C:\code\Portfolio_x_ray\`:
- `README.md` - Quick setup guide
- `IMPLEMENTATION_SUMMARY.md` - Detailed implementation notes
- `COMPLETE_IMPLEMENTATION_DOCUMENTATION.md` - Full system documentation
- `EXECUTION_PLAN.md` - Original implementation plan
- `PLAID_API_REQUIREMENTS.md` - Plaid integration details
- `FEE_CALCULATION_DOCUMENTATION.md` - Fee calculation methodology

---

## Core Modules

### types.ts
Central type definitions for the entire system:
- **Plaid Data Types:** `Security`, `Holding`, `Transaction`
- **Portfolio State:** `Position`, `PortfolioSnapshot`, `Cashflow`
- **Calculations:** `PortfolioResult`, `BenchmarkResult`, `FeeResult`
- **API Response:** `AnalysisResponse`, `MonthlyAnalysis`, `HoldingDetail`

### config.ts
Central configuration containing:
- `LOOKBACK_MONTHS`: 24 months (default analysis period)
- `CASH_BENCHMARK_TICKER`: SGOV (short-term treasury benchmark)
- `DEFAULT_EXPENSE_RATIOS`: 20+ fund/ETF expense ratios
- `BENCHMARK_TICKERS`: Maps to SPY, VEA, AGG, IWM, IJH, VWO
- `TICKER_BENCHMARK_MAP`: Direct mappings for 50+ known funds
- `EXTERNAL_CASHFLOW_SUBTYPES`: Identifies deposits, withdrawals
- `FEE_SUBTYPES`: Identifies fee transactions

### portfolio-analyzer.ts
Main orchestrator that:
1. Determines analysis period (24 months lookback)
2. Reconstructs starting positions from current holdings
3. Builds monthly portfolio snapshots
4. Calculates portfolio IRR using XIRR algorithm
5. Fetches benchmark data from Supabase
6. Simulates benchmark performance with same cash flows
7. Calculates explicit and implicit fees
8. Returns comprehensive `PortfolioResult`

### holdings-tracker.ts
Reconstructs portfolio positions over time:
- `buildCurrentPositions()`: Extracts non-cash holdings from Plaid
- `getCurrentCash()`: Sums cash/cash-equivalent holdings
- `reconstructStartPositions()`: Reverses transactions to find starting positions
- `buildMonthlySnapshots()`: Creates month-end portfolio snapshots

### benchmark-matcher.ts
Maps securities to benchmark ETFs using:
1. Direct ticker mapping (VTI→SPY, VTIAX→VEA)
2. Name heuristics (bonds→AGG, international→VEA)
3. Type-based fallback (equity→SPY, bond→AGG)

### return-calculator.ts
Calculates portfolio and benchmark performance:
- Uses XIRR with monthly adjustments
- Tracks securities and cash separately (cash earns SGOV rate)
- Handles margin (negative cash) costs

### irr-calculator.ts
Implements return calculations:
- `xnpv()`: Extended Net Present Value
- `xirr()`: XIRR using bisection method
- `modifiedDietz()`: Fallback when XIRR fails
- `annualizeReturn()`: Period to annualized conversion

### fee-calculator.ts
Calculates fees:
- **Explicit:** Transaction fees, account fees from records
- **Implicit:** Estimated from expense ratios
- Note: Phase 1 calculates but hides fee display

---

## Data Flow

### User Connection Flow

```
1. User visits tools.arcvest.com/portfolio-x-ray
2. Clicks "Connect Account" → calls /api/portfolio-x-ray/link-token
3. Plaid Link modal opens (user authenticates)
4. User selects accounts → Plaid returns public_token
5. Frontend calls /api/portfolio-x-ray/exchange-token
6. Backend exchanges for access_token
7. Frontend calls /api/portfolio-x-ray/fetch-data
8. Backend fetches 24 months transactions + holdings
9. Frontend calls /api/portfolio-x-ray/analyze
10. Analysis engine processes and returns results
11. Results displayed on frontend
```

### Analysis Calculation Flow

```
Raw Data (Plaid or test file)
  │
  ▼
PortfolioAnalyzer.analyze()
  ├── Determine period (24 months lookback)
  ├── Build current positions from holdings
  ├── Reconstruct starting positions (reverse transactions)
  ├── Build monthly snapshots with valuations
  ├── Extract external cash flows
  ├── Calculate portfolio IRR (XIRR)
  ├── Fetch benchmark returns from Supabase
  ├── Map holdings to benchmarks (SPY, VEA, AGG, SGOV)
  ├── Simulate benchmark with same cash flows
  ├── Calculate benchmark IRR
  ├── Calculate explicit + implicit fees
  └── Return PortfolioResult
```

---

## Environment Variables

```env
# Plaid API
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_secret
PLAID_ENV=sandbox  # or production
PLAID_REDIRECT_URI=https://arcvest-tools.vercel.app/portfolio-x-ray/oauth-return

# Supabase (benchmark returns)
SUPABASE_URL=https://rhysciwzmjleziieeugv.supabase.co
SUPABASE_KEY=your_supabase_key

# Email (PDF reports via MailerSend)
MAILERSEND_API_TOKEN=your_token
PDF_FROM_EMAIL=wealth@arcvest.com
PDF_FROM_NAME=ArcVest

# Optional
NODE_ENV=development  # enables debug CSV export
NEXT_PUBLIC_APP_URL=https://arcvest-tools.vercel.app
```

---

## Benchmark Mappings

### US Markets
| Fund/ETF | Benchmark |
|----------|-----------|
| VTI, VOO, VFIAX, FXAIX, SPY, SWPPX | SPY (large cap) |
| VSMAX, VB, IWM, SCHA, IJR | IWM (small cap) |
| VIMAX, VO, IJH, SCHM | IJH (mid cap) |

### International
| Fund/ETF | Benchmark |
|----------|-----------|
| VTIAX, VXUS, VEA, VFWAX, EFA | VEA (developed) |
| VEMAX, VWO, EEM, IEMG, SCHE | VWO (emerging) |

### Bonds & Cash
| Fund/ETF | Benchmark |
|----------|-----------|
| VBTLX, BND, AGG, FXNAX, SCHZ, FBND | AGG |
| BIL, SGOV, SHV, VMFXX, SPAXX, FDRXX | SGOV |

---

## Default Expense Ratios

| Ticker | Expense Ratio |
|--------|---------------|
| VTI | 0.03% (3 bps) |
| SPY | 0.0945% (9.45 bps) |
| VOO | 0.03% (3 bps) |
| AGG | 0.03% (3 bps) |
| BND | 0.03% (3 bps) |
| VEA | 0.08% (8 bps) |
| VXUS | 0.08% (8 bps) |
| Mutual funds (default) | 0.50% (50 bps) |
| ETFs (default) | 0.10% (10 bps) |

---

## Deployment

- **Platform:** Vercel
- **Live URL:** tools.arcvest.com/portfolio-x-ray
- **Repository:** chadfargason/arcvest-tools
- **Build:** Automatic on push to `main` branch

---

## Testing & Debugging

### Test Data
- Location: `C:\code\Portfolio_x_ray\Raw Data.txt`
- Format: JSON with `transactions` and `holdings` matching Plaid format

### Debug Outputs (Development Only)
When `NODE_ENV=development`, CSV files export to:
```
C:\code\Portfolio_x_ray\debug_output\{accountId}\
  ├── transactions.csv
  ├── positions.csv
  ├── monthly_snapshots.csv
  └── summary.txt
```

---

## Known Limitations

1. Fee display hidden in Phase 1 (calculated but not shown)
2. Limited to 24-month analysis window
3. Benchmark matching uses heuristics (not perfect classification)
4. Expense ratio data approximated from defaults
5. Monthly analysis detail is simplified

---

## Planned Enhancements

1. Phase 2: Enable fee display with detailed breakdown
2. Historical price data for more accurate valuations
3. Monthly return breakdown in reports
4. Enhanced PDF report visualizations
5. Tax-loss harvesting analysis
6. Sector/geographic allocation visualization
7. Multiple account aggregation improvements

---

## Codebase Statistics

- **Total modules:** 14 TypeScript files
- **Total lines:** ~2,800 lines of code
- **API endpoints:** 6 routes

---

*This documentation reflects the codebase state as of December 29, 2025.*
