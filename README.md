# ArcVest Tools

Modern Next.js website featuring portfolio analysis tools, retirement simulator, and investment chatbot integration.

## Quick Start

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript type checking

### Tech Stack

- **Next.js 15** - React framework
- **React 19** - UI library
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Plaid SDK** - Brokerage account connections
- **Supabase** - Database and market data
- **jsPDF** - PDF report generation
- **MailerSend** - Email delivery

## Project Structure

```
fargason-capital-site/
├── app/
│   ├── api/
│   │   ├── portfolio-x-ray/    # Portfolio X-Ray API (6 endpoints)
│   │   └── retirement/         # Retirement simulator API
│   ├── calculator/             # Retirement calculator page
│   ├── chat/                   # Investment chatbot page
│   ├── portfolio-x-ray/        # Portfolio X-Ray page
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── lib/
│   ├── portfolio-x-ray/        # Portfolio analysis modules (16 files)
│   └── utils.ts
├── public/
│   ├── calculator.html         # Retirement calculator
│   └── portfolio-x-ray.html    # Portfolio X-Ray UI
├── docs/                       # Documentation
└── package.json
```

---

## Features

### Portfolio X-Ray

Comprehensive portfolio analysis tool with Plaid integration.

**Capabilities:**
- Connect brokerage accounts via Plaid (sandbox or production)
- 24-month historical analysis with position reconstruction
- XIRR (money-weighted return) calculation
- Benchmark comparison using 6 asset class proxies:
  - US Large Cap: SPY
  - US Mid Cap: IJH
  - US Small Cap: IWM
  - International Developed: VEA
  - Emerging Markets: VWO
  - US Bonds: AGG
  - Cash: SGOV
- Fee transparency (explicit fees + expense ratios)
- PDF report generation with optional email delivery
- Security and cash ledgers for full transparency

**API Endpoints:**
| Endpoint | Purpose |
|----------|---------|
| `POST /api/portfolio-x-ray/link-token` | Create Plaid Link token |
| `POST /api/portfolio-x-ray/exchange-token` | Exchange public token |
| `POST /api/portfolio-x-ray/fetch-data` | Fetch investment data |
| `POST /api/portfolio-x-ray/analyze` | Run portfolio analysis |
| `POST /api/portfolio-x-ray/request-report` | Generate PDF report |
| `POST /api/portfolio-x-ray/mock-data` | Development testing |

**Documentation:**
- [Portfolio X-Ray Overview](docs/PORTFOLIO_X_RAY_OVERVIEW.md)
- [Calculation Methodology](docs/PORTFOLIO_X_RAY_CALCULATIONS.md)
- [Plaid Production Migration](docs/PLAID_PRODUCTION_MIGRATION.md)

### Retirement Simulator

Monte Carlo retirement planning calculator:
- Asset allocation modeling
- Inflation-adjusted projections
- Social Security integration
- Withdrawal strategy analysis

### Investment Chatbot

AI-powered investment Q&A assistant.

---

## Environment Variables

```bash
# Plaid (Portfolio X-Ray)
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_secret
PLAID_ENV=sandbox  # or 'production'
PLAID_REDIRECT_URI=https://your-domain.com/portfolio-x-ray/oauth-return

# Supabase (Market Data)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Email (Optional)
MAILERSEND_API_KEY=your_mailersend_key
```

## Deployment

### Vercel (Recommended)

1. Connect GitHub repository to Vercel
2. Set environment variables in Vercel dashboard
3. Set build command: `npm run build`
4. Set output directory: `.next`
5. Deploy

### Other Platforms

The website can be deployed to any platform that supports Next.js:
- Netlify
- Railway
- AWS Amplify

---

## Pages

| Path | Description |
|------|-------------|
| `/` | Landing page with navigation to tools |
| `/calculator` | Retirement simulator |
| `/portfolio-x-ray` | Portfolio X-Ray tool |
| `/chat` | Investment chatbot |

---

## Troubleshooting

### Common Issues

1. **Build Errors**
   - Run `npm run type-check` to identify TypeScript issues
   - Check for missing dependencies with `npm install`

2. **Plaid Connection Issues**
   - Verify `PLAID_CLIENT_ID` and `PLAID_SECRET` are set
   - Check `PLAID_ENV` matches your credentials (sandbox vs production)
   - For OAuth institutions, ensure redirect URI is configured

3. **Market Data Missing**
   - Check Supabase `asset_returns` table has data
   - Verify Supabase credentials are correct

4. **PDF Generation Fails**
   - Check memory limits for large transaction histories
   - Verify jsPDF dependencies installed

### Debug Tools

- Use `/api/portfolio-x-ray/mock-data` for testing without Plaid
- PDF reports include security ledgers for position verification
- Debug exports available in `lib/portfolio-x-ray/debug-export.ts`

---

## Recent Updates

### December 2024
- Portfolio X-Ray: Fixed cash ledger to include all cash-affecting transactions
- Plaid OAuth registration approved
- Added comprehensive documentation

### November 2024
- Portfolio X-Ray initial release
- 24-month historical analysis
- Benchmark comparison
- XIRR calculation
- PDF report generation

---

## License

MIT License
