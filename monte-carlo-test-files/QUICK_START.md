# Quick Start Guide

## Getting Started in 3 Steps

### Step 1: Basic Usage

```python
from monte_carlo_simulator_v2 import MonteCarloInvestmentSimulator

# Create your simulator
sim = MonteCarloInvestmentSimulator(
    initial_balance=10000,       # Starting amount
    monthly_contribution=500,     # Monthly additions
    annual_return=0.08,          # 8% expected return
    annual_volatility=0.18,      # 18% volatility
    years=30                     # Time horizon
)

# Run it
sim.run_simulation()

# See results
sim.print_summary()
sim.plot_results()
```

### Step 2: Customize Your Scenario

```python
# Conservative (bonds-heavy)
conservative = MonteCarloInvestmentSimulator(
    initial_balance=50000,
    monthly_contribution=1000,
    annual_return=0.05,       # Lower return
    annual_volatility=0.10,   # Lower risk
    years=20,
    fat_tails=True
)

# Aggressive (stocks-heavy)
aggressive = MonteCarloInvestmentSimulator(
    initial_balance=50000,
    monthly_contribution=1000,
    annual_return=0.10,       # Higher return
    annual_volatility=0.22,   # Higher risk
    years=20,
    fat_tails=True,
    tail_severity='extreme'   # Model severe crashes
)
```

### Step 3: Analyze Results

```python
# Run simulation
sim.run_simulation()

# Get statistics
stats = sim.get_statistics()
print(f"Median outcome: ${stats['median_final']:,.0f}")
print(f"Worst 10%: ${stats['p10_final']:,.0f}")
print(f"Best 10%: ${stats['p90_final']:,.0f}")

# Get percentiles over time
percentiles = sim.get_percentiles([25, 50, 75])
```

## Real-World Examples

### Example 1: First Job, Age 25
```python
sim = MonteCarloInvestmentSimulator(
    initial_balance=0,
    monthly_contribution=400,
    annual_return=0.09,
    annual_volatility=0.20,
    years=40
)
sim.run_simulation()
sim.print_summary()
```

### Example 2: Mid-Career Catch-Up, Age 45
```python
sim = MonteCarloInvestmentSimulator(
    initial_balance=150000,
    monthly_contribution=2000,
    annual_return=0.08,
    annual_volatility=0.17,
    years=20
)
sim.run_simulation()
sim.print_summary()
```

### Example 3: Pre-Retirement, Age 60
```python
sim = MonteCarloInvestmentSimulator(
    initial_balance=750000,
    monthly_contribution=3000,
    annual_return=0.06,
    annual_volatility=0.12,
    years=5
)
sim.run_simulation()
sim.print_summary()
```

## Understanding Your Results

### What the Percentiles Mean

| Percentile | Interpretation | Use Case |
|------------|----------------|----------|
| 10th | Pessimistic scenario | Risk planning |
| 20th | Below average outcome | Conservative estimate |
| 50th (Median) | Middle outcome | Most realistic target |
| 80th | Above average outcome | Optimistic planning |
| 90th | Very favorable scenario | Best case |

### Success Rate Guidelines

- **>99%**: Very secure
- **90-99%**: Comfortable
- **80-90%**: Adequate (HonestMath threshold)
- **70-80%**: Moderate risk
- **<70%**: May need adjustments

## Common Adjustments

### If Success Rate Too Low (<80%)

1. **Increase contributions**
```python
monthly_contribution += 200  # Add $200 more per month
```

2. **Extend time horizon**
```python
years += 5  # Work 5 more years
```

3. **Reduce retirement spending** (not modeled directly, but same effect as higher contributions)

### If You Want More Certainty

1. **Use more conservative return assumptions**
```python
annual_return = 0.06  # Instead of 0.08
```

2. **Add bonds to reduce volatility**
```python
annual_volatility = 0.14  # Lower volatility
```

## Typical Asset Allocation Returns

| Portfolio | Return | Volatility | Description |
|-----------|--------|------------|-------------|
| 100% Bonds | 4-5% | 6-8% | Very conservative |
| 60/40 (Stocks/Bonds) | 7-8% | 12-14% | Moderate |
| 80/20 | 8-9% | 15-17% | Moderately aggressive |
| 100% Stocks | 9-10% | 18-20% | Aggressive |

*Historical US market data, not guaranteed for future*

## Pro Tips

1. **Run multiple scenarios** - Compare optimistic, realistic, and pessimistic assumptions

2. **Focus on the 20-80 percentile band** - This is your most likely range

3. **Use fat tails** - They better capture real market crashes

4. **Don't obsess over exact numbers** - These are projections, not predictions

5. **Rerun annually** - Update with actual performance and adjust

## Export Results

```python
import matplotlib.pyplot as plt

# Save chart
fig, ax = sim.plot_results()
plt.savefig('my_retirement_projection.png', dpi=300)

# Export data to CSV
import pandas as pd
results_df = pd.DataFrame(sim.simulation_results.T)
results_df.to_csv('simulation_data.csv', index=False)

# Get summary stats
stats = sim.get_statistics()
import json
with open('summary.json', 'w') as f:
    json.dump(stats, f, indent=2)
```

## Troubleshooting

**Problem**: Results seem unrealistic
- **Solution**: Check your return and volatility assumptions

**Problem**: Too much variation in results
- **Solution**: Normal for fat-tailed distributions; shows real uncertainty

**Problem**: Many negative outcomes
- **Solution**: Reduce volatility or increase contributions

**Problem**: Want to model withdrawals
- **Solution**: Use negative monthly_contribution values, or modify the code

## Next Steps

1. ✅ Run your first simulation
2. ✅ Try different scenarios
3. ✅ Compare fat-tailed vs normal
4. ✅ Save your favorite projections
5. ✅ Update annually with real data

---

**Questions? Issues?** The code is open source - modify it for your needs!
