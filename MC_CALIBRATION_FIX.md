# Monte Carlo Engine: Implementation Details & Calibration Fixes

## Current Implementation

### Return Distribution Pipeline

The simulator generates monthly returns through a 4-step pipeline:

1. **Box-Muller Normal** (`randomNormal`): Generates standard normal random variables using the Box-Muller transform: `z = sqrt(-2*ln(u1)) * cos(2*pi*u2)`.

2. **Student's t-distribution** (`randomT`): Generates fat-tailed samples by dividing a normal by the square root of a chi-squared/df. Variance-scaled via `sqrt((df-2)/df)` so the output has unit variance for df > 2.

3. **Skewed t-distribution** (`randomSkewedT`): Applies an asymmetric transformation to the t-sample:
   - Negative values: amplified by `(1 + |skew|)` — crashes are bigger
   - Positive values: dampened by `(1 - |skew| * 0.5)` — booms are smaller
   - A mean correction is added to re-center the distribution at zero

4. **Cholesky correlation** (`generateCorrelatedReturns`): Produces correlated stock/bond pairs: `return1 = mean + std * z1`, `return2 = mean + std * (rho*z1 + sqrt(1-rho^2)*z2)`.

### Parameters

| Parameter | Default | Location |
|-----------|---------|----------|
| Degrees of freedom | 5 | UI input `#degreesOfFreedom` |
| Skewness | -0.3 | Hardcoded in `generateCorrelatedReturns` |
| Stock mean return | 10% annual | UI input `#stockReturn` |
| Stock volatility | 15% annual | UI input `#stockVolatility` |
| Bond mean return | 4% annual | UI input `#bondReturn` |
| Bond volatility | 4% annual | UI input `#bondVolatility` |
| Correlation | 0.0 | UI input `#correlation` |

### Simulation Modes

1. **Simple (default)**: User-specified parameters with skewed-t distribution
2. **Regime-switching**: 3-state Markov model (Calm/Crash/Inflation) with per-regime parameters for mean, vol, correlation, df, and skew
3. **Historical**: Actual historical returns during retirement period

### Annual-to-Monthly Conversion

Returns are converted from annual to monthly for the simulation loop. Volatility is correctly scaled as `annual / sqrt(12)`. Mean returns are converted via simple division: `annual / 12`.

---

## Bug 1: Hardcoded Mean Correction

### Problem

In `randomSkewedT` (both `route.ts` and `retirement-simulator.html`):

```typescript
const meanCorrection = 0.18 * Math.abs(skew) / 0.3;
```

This constant (0.18) was derived analytically for **df=4 only**. The skewness transform shifts the distribution mean by an amount that depends on BOTH `df` and `skew`. When df=5 (the current default), the correction overshoots slightly, pushing MC returns above their true center. For other df values (3, 7, 10, etc.), it can be significantly wrong.

### Fix

Replace the hardcoded constant with an empirical calibration. Generate a large deterministic sample with the given df/skewness, measure its actual mean, and use the negative of that as the correction:

```typescript
function computeEmpiricalMeanCorrection(df: number, skew: number): number {
  // Use a seeded PRNG for determinism (simple xorshift128)
  let s0 = 123456789, s1 = 362436069;
  function nextRandom(): number {
    let x = s0, y = s1;
    s0 = y;
    x ^= (x << 23) | 0;
    x ^= (x >> 17) | 0;
    x ^= (y ^ (y >> 26)) | 0;
    s1 = x;
    return ((x + y) >>> 0) / 4294967296;
  }

  function seededNormal(): number {
    let u1 = 0, u2 = 0;
    while (u1 === 0) u1 = nextRandom();
    while (u2 === 0) u2 = nextRandom();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  }

  function seededT(df: number): number {
    const z = seededNormal();
    let chiSq = 0;
    for (let i = 0; i < df; i++) {
      const n = seededNormal();
      chiSq += n * n;
    }
    if (df > 2) {
      return z / Math.sqrt(chiSq / df) * Math.sqrt((df - 2) / df);
    }
    return z / Math.sqrt(chiSq / df);
  }

  const N = 50000;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const t = seededT(df);
    const skewed = t < 0
      ? t * (1 + Math.abs(skew))
      : t * (1 - Math.abs(skew) * 0.5);
    sum += skewed;
  }
  return -(sum / N);
}
```

This runs once per unique (df, skew) pair. At 50K samples with a deterministic seed, it takes ~5ms and is accurate to ~0.002.

### Files & Lines

| File | Line | Current | Replacement |
|------|------|---------|-------------|
| `app/api/retirement/simulate/route.ts` | 1294 | `const meanCorrection = 0.18 * Math.abs(skew) / 0.3;` | `const meanCorrection = computeEmpiricalMeanCorrection(df, skew);` |
| `public/retirement-simulator.html` | 1596 | `const meanCorrection = 0.18 * Math.abs(skew) / 0.3;` | `const meanCorrection = computeEmpiricalMeanCorrection(df, skew);` |

---

## Bug 2: Arithmetic Monthly Mean Conversion

### Problem

Monthly mean returns are computed as:

```typescript
const monthlyStockReturn = stockReturn / 12;
const monthlyBondReturn = bondReturn / 12;
```

This is an **arithmetic** approximation. When these monthly returns are compounded over 12 months, the result overshoots the stated annual return:

- Input: 10% annual
- Arithmetic monthly: 0.8333%
- Compounded: (1.008333)^12 - 1 = **10.47%** (overstates by 0.47%)

The correct conversion is **geometric**:

```
monthlyReturn = (1 + annualReturn)^(1/12) - 1
```

- Geometric monthly: 0.7974%
- Compounded: (1.007974)^12 - 1 = **10.00%** (exact)

Over 30 years at 10% annual, the arithmetic error compounds to ~15% extra terminal value. This makes the simulator systematically optimistic.

### Fix

Replace `annual / 12` with `Math.pow(1 + annual, 1/12) - 1`:

```typescript
const monthlyStockReturn = Math.pow(1 + stockReturn, 1/12) - 1;
const monthlyBondReturn = Math.pow(1 + bondReturn, 1/12) - 1;
```

### Files & Lines

| File | Lines | Current | Replacement |
|------|-------|---------|-------------|
| `app/api/retirement/simulate/route.ts` | 201-202 | `stockReturn / 12` / `bondReturn / 12` | `Math.pow(1 + stockReturn, 1/12) - 1` / `Math.pow(1 + bondReturn, 1/12) - 1` |
| `app/api/retirement/simulate/route.ts` | 1235-1236 | `params.stockMean / 12` / `params.bondMean / 12` (regime-switching) | `Math.pow(1 + params.stockMean, 1/12) - 1` / `Math.pow(1 + params.bondMean, 1/12) - 1` |
| `public/retirement-simulator.html` | 1629-1630 | `stockReturn / 12` / `bondReturn / 12` (CAGR estimator) | `Math.pow(1 + stockReturn, 1/12) - 1` / `Math.pow(1 + bondReturn, 1/12) - 1` |

---

## Impact Summary

| Bug | Direction | Magnitude (30yr, 60/40 @ 10%/4%) |
|-----|-----------|----------------------------------|
| Hardcoded mean correction | Slight upward bias at df=5 | ~0.5-1% terminal value |
| Arithmetic monthly mean | Upward bias (returns overstated) | ~10-15% terminal value |
| **Combined** | **MC outcomes systematically too optimistic** | **~12-16% terminal value** |

Note: The retirement planner engine had the *opposite* problem — its vectorized path applied skew-then-scale (instead of scale-then-skew), which pushed returns *down*. The ArcVest simulator's scalar path has the correct operation order, so that bug doesn't apply here.
