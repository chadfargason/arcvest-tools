# Portfolio X-Ray: Calculation Methodology

This document details the mathematical methods used in Portfolio X-Ray for calculating returns, benchmarks, and fees.

---

## 1. Position Reconstruction

### The Challenge

Plaid's Investment API provides:
- **Holdings**: Current positions as of TODAY
- **Transactions**: Historical activity (up to 24 months)

We need month-end snapshots for historical analysis, so we must reconstruct positions.

### The Algorithm

```
Starting from current holdings, work backward through time:

For each transaction (sorted newest to oldest):
  switch(transaction.type):
    case 'buy':
      // We had FEWER shares before this buy
      position.quantity -= transaction.quantity

    case 'sell':
      // We had MORE shares before this sell
      position.quantity += transaction.quantity

    case 'dividend':
      // No impact on share count (cash is separate)
      pass

    case 'transfer':
      // Treat like buy/sell based on direction
      if (quantity > 0) position.quantity -= quantity
      else position.quantity += abs(quantity)
```

### Month-End Snapshots

For each month-end date:
1. Calculate position quantities as of that date
2. Look up closing prices for each security
3. Calculate position values: `value = quantity * price`
4. Sum to get total portfolio value

---

## 2. Return Calculations

### Total Return

Simple percentage return over the analysis period:

```
Total Return = (Ending Value - Starting Value + Withdrawals - Deposits)
               / Starting Value

Or equivalently:
Total Return = (Ending Value - Starting Value - Net Cashflows)
               / Starting Value
```

### Annualized Return

Converting total return to an annual rate:

```
Years = (End Date - Start Date) / 365

Annualized Return = (1 + Total Return)^(1/Years) - 1
```

### XIRR (Money-Weighted Return)

The Internal Rate of Return accounts for the timing of cashflows.

**Definition**: Find rate `r` such that the Net Present Value equals zero:

```
NPV = 0 = Σ (cashflow_i / (1 + r)^(days_i / 365))

Where:
- cashflow_i = each deposit (negative) or withdrawal (positive)
- days_i = days from first date to cashflow date
- Final cashflow = ending portfolio value
```

**Implementation** (bisection method):

```typescript
function xirr(cashflows: Cashflow[]): number {
  let low = -0.99;  // -99% annual return
  let high = 10.0;  // 1000% annual return

  while (high - low > 0.0001) {
    const mid = (low + high) / 2;
    const npv = xnpv(cashflows, mid);

    if (npv > 0) {
      low = mid;  // Rate too low
    } else {
      high = mid; // Rate too high
    }
  }

  return (low + high) / 2;
}
```

**Why XIRR matters**: For investors who add or withdraw money over time, XIRR reflects their actual experience better than time-weighted returns.

---

## 3. Benchmark Calculation

### Asset Class Mapping

Each portfolio holding is mapped to a benchmark proxy ETF:

| Asset Class | Benchmark | Rationale |
|-------------|-----------|-----------|
| US Large Cap | SPY | S&P 500 tracking |
| US Mid Cap | IJH | S&P MidCap 400 |
| US Small Cap | IWM | Russell 2000 |
| International Developed | VEA | FTSE Developed ex-US |
| Emerging Markets | VWO | FTSE Emerging Markets |
| US Bonds | AGG | Bloomberg US Aggregate |
| Cash | SGOV | Ultra-short Treasury |

### Benchmark Weight Calculation

At each month-end, calculate dollar-weighted allocation:

```typescript
// Example: Portfolio has $60K in SPY-mapped securities, $40K in VEA-mapped
benchmarkWeights = {
  'SPY': 60000 / 100000,  // 60%
  'VEA': 40000 / 100000,  // 40%
}

// Cash gets its own allocation
cashWeight = cashValue / totalValue;
securitiesWeight = 1 - cashWeight;
```

### Benchmark Value Evolution

For each month:

```typescript
// 1. Get benchmark returns for the month
const spyReturn = getMonthlyReturn('SPY', month);
const veaReturn = getMonthlyReturn('VEA', month);
const sgovReturn = getMonthlyReturn('SGOV', month);

// 2. Calculate weighted securities return
const securitiesReturn =
  weights['SPY'] * spyReturn +
  weights['VEA'] * veaReturn;

// 3. Calculate blended return
const blendedReturn =
  securitiesWeight * securitiesReturn +
  cashWeight * sgovReturn;

// 4. Update benchmark value
benchmarkValue *= (1 + blendedReturn);

// 5. Adjust for cashflows (same as portfolio)
benchmarkValue += netCashflows;
```

### Benchmark Rebalancing

The benchmark rebalances monthly to match the portfolio's allocation changes:
- When the portfolio's asset allocation shifts, benchmark weights update
- New deposits are allocated according to current portfolio weights
- This creates an "apples-to-apples" comparison

---

## 4. Fee Calculations

### Explicit Fees

Fees directly captured in Plaid transactions:

```typescript
function isExplicitFee(transaction: Transaction): boolean {
  return transaction.type === 'fee' ||
         transaction.subtype === 'fee' ||
         transaction.subtype === 'account fee' ||
         transaction.subtype === 'management fee';
}

explicitFees = transactions
  .filter(isExplicitFee)
  .reduce((sum, t) => sum + Math.abs(t.amount), 0);
```

### Implicit Fees (Expense Ratios)

Estimated annual cost based on fund expense ratios:

```typescript
// For each holding:
const expenseRatio = DEFAULT_EXPENSE_RATIOS[ticker] || 0.005; // Default 0.5%
const annualCost = holdingValue * expenseRatio;

// Total implicit fees
implicitFees = holdings.reduce((sum, h) => {
  const ratio = getExpenseRatio(h.ticker);
  return sum + (h.value * ratio);
}, 0);
```

### Expense Ratio Database

From `config.ts`:

```typescript
export const DEFAULT_EXPENSE_RATIOS: Record<string, number> = {
  // Vanguard
  'VTI': 0.0003,   // 0.03%
  'VOO': 0.0003,   // 0.03%
  'VEA': 0.0005,   // 0.05%
  'VWO': 0.0008,   // 0.08%

  // iShares
  'SPY': 0.000945, // 0.0945%
  'AGG': 0.0003,   // 0.03%

  // Active funds (higher fees)
  'PIMIX': 0.0055, // 0.55%

  // Default for unknown funds
  // Uses 0.5% if not in database
};
```

### Fee Impact on Returns

Expense ratios are already reflected in fund NAVs, so no adjustment is needed for return calculations. The fee display is purely informational to show the "hidden" cost.

---

## 5. Cash Tracking

### Cash Balance Components

```
Cash Balance = Starting Cash
             + Deposits
             - Withdrawals
             + Dividends (if not reinvested)
             - Buy transactions
             + Sell transactions
             - Explicit fees
```

### Cash Ledger

The cash ledger tracks every transaction affecting cash:

```typescript
for (const transaction of sortedTransactions) {
  const cashImpact = getCashImpact(transaction);

  ledger.push({
    date: transaction.date,
    type: transaction.type,
    description: getDescription(transaction),
    amount: cashImpact,
    runningBalance: previousBalance + cashImpact,
  });
}

function getCashImpact(t: Transaction): number {
  switch (t.type) {
    case 'buy': return -t.amount;      // Cash goes out
    case 'sell': return t.amount;       // Cash comes in
    case 'cash': return t.amount;       // Deposit/withdrawal
    case 'dividend': return t.amount;   // Cash dividend
    case 'fee': return -Math.abs(t.amount); // Fee paid
    default: return t.amount;
  }
}
```

---

## 6. Reconciliation

### Why Values May Differ

The PDF shows both:
1. **Calculated Holdings** (month-end snapshots)
2. **Current Plaid Holdings** (real-time)

Differences occur because:
- Calculation uses month-end prices, Plaid uses current prices
- Calculation date may differ from Plaid fetch date
- Corporate actions (splits, mergers) may not be fully reflected

### Reconciliation Notes

The PDF includes reconciliation notes when:

```typescript
const tolerance = 0.01; // 1%

if (Math.abs(calculated - plaid) / plaid > tolerance) {
  notes.push(`Difference of ${diff.toFixed(2)}% from Plaid`);
}
```

---

## 7. Edge Cases

### Missing Prices

When market data is unavailable:
```typescript
if (!price) {
  // Use last known price
  price = getLastKnownPrice(security, date);

  // If still missing, use cost basis
  if (!price) {
    price = transaction.price || security.close_price;
  }
}
```

### Zero Starting Value

For IRR calculation with $0 starting value:
```typescript
if (startingValue === 0 && deposits > 0) {
  // Treat first deposit as starting point
  // Calculate return from first deposit date
}
```

### Fractional Shares

Fully supported - quantities are stored as decimals.

### Stock Splits

Handled automatically if Plaid reflects split-adjusted quantities.

---

## 8. Data Sources

### Market Data

Monthly returns are stored in Supabase `asset_returns` table:

```sql
CREATE TABLE asset_returns (
  id SERIAL PRIMARY KEY,
  ticker VARCHAR(10),
  date DATE,
  return DECIMAL(10, 6),
  price DECIMAL(10, 2)
);

-- Query for monthly returns
SELECT ticker, date, return
FROM asset_returns
WHERE ticker = 'SPY'
  AND date >= '2022-12-31'
ORDER BY date;
```

### Return Calculation for Supabase Data

```
Monthly Return = (Month End Price - Previous Month End Price)
                 / Previous Month End Price
```

---

## References

- [XIRR Methodology](https://en.wikipedia.org/wiki/Internal_rate_of_return#Modified_internal_rate_of_return)
- [Modified Dietz Method](https://en.wikipedia.org/wiki/Modified_Dietz_method)
- [Plaid Investment Transactions](https://plaid.com/docs/investments/investment-transactions/)
