"""
Monte Carlo Investment Simulator - Improved Version
Inspired by HonestMath.com methodology

Features:
- Fat-tailed returns that capture real market volatility
- Monthly calculation periods
- 10,000 simulation trials
- Realistic handling of extreme events
"""

import numpy as np
import matplotlib.pyplot as plt
from scipy import stats
import pandas as pd


class MonteCarloInvestmentSimulator:
    """
    Monte Carlo simulation for investment returns with optional fat-tailed distributions.
    """
    
    def __init__(self, 
                 initial_balance=0,
                 monthly_contribution=500,
                 annual_return=0.08,
                 annual_volatility=0.18,
                 years=30,
                 n_simulations=10000,
                 fat_tails=True,
                 tail_severity='standard'):
        """
        Initialize the Monte Carlo simulator.
        
        Parameters:
        -----------
        initial_balance : float
            Starting portfolio balance
        monthly_contribution : float
            Amount added each month
        annual_return : float
            Expected annual return (e.g., 0.08 for 8%)
        annual_volatility : float
            Annual volatility (e.g., 0.18 for 18%)
        years : int
            Investment time horizon
        n_simulations : int
            Number of simulations (default 10,000)
        fat_tails : bool
            Use fat-tailed distribution (True) or normal (False)
        tail_severity : str
            'standard' or 'extreme' - how severe the fat tails should be
        """
        self.initial_balance = initial_balance
        self.monthly_contribution = monthly_contribution
        self.annual_return = annual_return
        self.annual_volatility = annual_volatility
        self.years = years
        self.n_simulations = n_simulations
        self.fat_tails = fat_tails
        self.tail_severity = tail_severity
        
        # Convert to monthly
        self.months = years * 12
        self.monthly_return = (1 + annual_return) ** (1/12) - 1
        self.monthly_volatility = annual_volatility / np.sqrt(12)
        
        # For fat tails: df=5 is moderately fat, df=3 is quite fat
        # These values capture extreme events without being unrealistic
        if tail_severity == 'extreme':
            self.degrees_of_freedom = 3  # Very fat tails
        else:
            self.degrees_of_freedom = 5  # Moderately fat tails
        
        self.simulation_results = None
        
    def generate_returns(self):
        """
        Generate monthly returns - either normal or fat-tailed.
        
        Fat-tailed uses Student's t-distribution to capture extreme events
        better than normal distribution.
        """
        if self.fat_tails:
            # Use t-distribution for fat tails
            # Scale appropriately to match desired volatility
            t_scale = self.monthly_volatility * np.sqrt(
                (self.degrees_of_freedom - 2) / self.degrees_of_freedom
            )
            
            random_returns = stats.t.rvs(
                df=self.degrees_of_freedom,
                loc=self.monthly_return,
                scale=t_scale,
                size=(self.n_simulations, self.months)
            )
        else:
            # Use normal distribution (traditional approach)
            random_returns = np.random.normal(
                loc=self.monthly_return,
                scale=self.monthly_volatility,
                size=(self.n_simulations, self.months)
            )
        
        return random_returns
    
    def run_simulation(self):
        """
        Run the Monte Carlo simulation.
        
        Returns:
        --------
        numpy.ndarray : Portfolio values over time for each simulation
        """
        # Generate returns
        returns = self.generate_returns()
        
        # Initialize portfolio values
        portfolio_values = np.zeros((self.n_simulations, self.months + 1))
        portfolio_values[:, 0] = self.initial_balance
        
        # Simulate month by month
        for month in range(self.months):
            # Previous balance
            prev_balance = portfolio_values[:, month]
            
            # Add contribution and apply return
            # Order: (previous_balance + contribution) * (1 + return)
            portfolio_values[:, month + 1] = (prev_balance + self.monthly_contribution) * (1 + returns[:, month])
        
        self.simulation_results = portfolio_values
        return portfolio_values
    
    def get_percentiles(self, percentiles=[10, 20, 50, 80, 90]):
        """Calculate percentile bands from simulation results."""
        if self.simulation_results is None:
            raise ValueError("Must run simulation first")
        
        percentile_data = {}
        for p in percentiles:
            percentile_data[f'p{p}'] = np.percentile(self.simulation_results, p, axis=0)
        
        return percentile_data
    
    def get_statistics(self):
        """Calculate summary statistics."""
        if self.simulation_results is None:
            raise ValueError("Must run simulation first")
        
        final_values = self.simulation_results[:, -1]
        total_contributions = self.initial_balance + (self.monthly_contribution * self.months)
        
        return {
            'median_final': np.median(final_values),
            'mean_final': np.mean(final_values),
            'std_final': np.std(final_values),
            'p10_final': np.percentile(final_values, 10),
            'p20_final': np.percentile(final_values, 20),
            'p80_final': np.percentile(final_values, 80),
            'p90_final': np.percentile(final_values, 90),
            'min_final': np.min(final_values),
            'max_final': np.max(final_values),
            'total_contributions': total_contributions,
            'success_rate_positive': np.mean(final_values > 0) * 100,
            'success_rate_beat_contributions': np.mean(final_values > total_contributions) * 100,
            'success_rate_2x': np.mean(final_values > total_contributions * 2) * 100,
        }
    
    def plot_results(self, figsize=(14, 8), show_sample_paths=True):
        """Create visualization of simulation results."""
        if self.simulation_results is None:
            raise ValueError("Must run simulation first")
        
        percentiles = self.get_percentiles([10, 20, 50, 80, 90])
        time_years = np.linspace(0, self.years, self.months + 1)
        
        fig, ax = plt.subplots(figsize=figsize)
        
        # Plot percentile bands (HonestMath style: 20-80 prominent)
        ax.fill_between(time_years, percentiles['p10'], percentiles['p90'],
                        alpha=0.15, color='blue', label='10th-90th Percentile')
        ax.fill_between(time_years, percentiles['p20'], percentiles['p80'],
                        alpha=0.25, color='blue', label='20th-80th Percentile')
        
        # Median line
        ax.plot(time_years, percentiles['p50'], color='darkblue', 
                linewidth=2.5, label='Median (50th Percentile)', zorder=5)
        
        # Sample paths for context
        if show_sample_paths:
            sample_indices = np.random.choice(self.n_simulations, size=30, replace=False)
            for idx in sample_indices:
                ax.plot(time_years, self.simulation_results[idx], 
                       color='gray', alpha=0.15, linewidth=0.5, zorder=1)
        
        # Formatting
        tail_label = f"Fat-Tailed ({self.tail_severity})" if self.fat_tails else "Normal"
        ax.set_title(f'Monte Carlo Investment Simulation ({self.n_simulations:,} trials)\n'
                    f'{tail_label} Returns | {self.annual_return*100:.0f}% Annual Return | '
                    f'{self.annual_volatility*100:.0f}% Volatility',
                    fontsize=14, fontweight='bold', pad=20)
        ax.set_xlabel('Years', fontsize=12, fontweight='bold')
        ax.set_ylabel('Portfolio Value ($)', fontsize=12, fontweight='bold')
        ax.legend(loc='upper left', fontsize=10, framealpha=0.9)
        ax.grid(True, alpha=0.3, linestyle='--')
        ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'${x:,.0f}'))
        
        # Add stats text box
        stats = self.get_statistics()
        stats_text = (f"Final Value (Median): ${stats['median_final']:,.0f}\n"
                     f"Total Invested: ${stats['total_contributions']:,.0f}\n"
                     f"Success Rate (>$0): {stats['success_rate_positive']:.1f}%")
        ax.text(0.98, 0.02, stats_text, transform=ax.transAxes,
               fontsize=10, verticalalignment='bottom', horizontalalignment='right',
               bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.8))
        
        plt.tight_layout()
        return fig, ax
    
    def print_summary(self):
        """Print detailed summary of simulation results."""
        if self.simulation_results is None:
            raise ValueError("Must run simulation first")
        
        stats = self.get_statistics()
        tail_label = f"Fat-Tailed ({self.tail_severity})" if self.fat_tails else "Normal"
        
        print("\n" + "="*75)
        print("MONTE CARLO INVESTMENT SIMULATION RESULTS")
        print("="*75)
        print(f"\nSimulation Parameters:")
        print(f"  • Distribution Type: {tail_label}")
        print(f"  • Initial Balance: ${self.initial_balance:,.2f}")
        print(f"  • Monthly Contribution: ${self.monthly_contribution:,.2f}")
        print(f"  • Annual Return: {self.annual_return*100:.1f}%")
        print(f"  • Annual Volatility: {self.annual_volatility*100:.1f}%")
        print(f"  • Time Horizon: {self.years} years")
        print(f"  • Number of Simulations: {self.n_simulations:,}")
        
        print(f"\nTotal Amount Invested: ${stats['total_contributions']:,.2f}")
        
        print(f"\nFinal Portfolio Value Distribution:")
        print(f"  • 10th Percentile (Unlucky): ${stats['p10_final']:,.2f}")
        print(f"  • 20th Percentile: ${stats['p20_final']:,.2f}")
        print(f"  • 50th Percentile (Median): ${stats['median_final']:,.2f}")
        print(f"  • 80th Percentile: ${stats['p80_final']:,.2f}")
        print(f"  • 90th Percentile (Lucky): ${stats['p90_final']:,.2f}")
        
        print(f"\nStatistical Measures:")
        print(f"  • Mean Final Value: ${stats['mean_final']:,.2f}")
        print(f"  • Standard Deviation: ${stats['std_final']:,.2f}")
        print(f"  • Minimum: ${stats['min_final']:,.2f}")
        print(f"  • Maximum: ${stats['max_final']:,.2f}")
        
        print(f"\nSuccess Metrics:")
        print(f"  • Ending with Positive Balance: {stats['success_rate_positive']:.1f}%")
        print(f"  • Beating Total Contributions: {stats['success_rate_beat_contributions']:.1f}%")
        print(f"  • Doubling Total Contributions: {stats['success_rate_2x']:.1f}%")
        print("="*75)


def compare_distributions():
    """Compare normal vs fat-tailed distributions."""
    print("\n" + "="*75)
    print("COMPARING NORMAL vs FAT-TAILED DISTRIBUTIONS")
    print("="*75)
    
    params = {
        'initial_balance': 10000,
        'monthly_contribution': 500,
        'annual_return': 0.08,
        'annual_volatility': 0.18,
        'years': 30,
        'n_simulations': 10000
    }
    
    # Fat-tailed (standard)
    print("\n1. FAT-TAILED DISTRIBUTION (Captures Real Market Volatility)")
    sim_fat = MonteCarloInvestmentSimulator(**params, fat_tails=True, tail_severity='standard')
    sim_fat.run_simulation()
    sim_fat.print_summary()
    
    # Normal distribution
    print("\n2. NORMAL DISTRIBUTION (Traditional Assumption)")
    sim_normal = MonteCarloInvestmentSimulator(**params, fat_tails=False)
    sim_normal.run_simulation()
    sim_normal.print_summary()
    
    # Comparison visualization
    fig, axes = plt.subplots(1, 2, figsize=(16, 6))
    
    # Fat-tailed plot
    percentiles_fat = sim_fat.get_percentiles()
    time_years = np.linspace(0, 30, 361)
    axes[0].fill_between(time_years, percentiles_fat['p20'], percentiles_fat['p80'],
                        alpha=0.3, color='red', label='20th-80th Percentile')
    axes[0].plot(time_years, percentiles_fat['p50'], color='darkred', linewidth=2, label='Median')
    axes[0].set_title('Fat-Tailed Distribution\n(More Realistic - Captures Crashes)', 
                     fontweight='bold', fontsize=12)
    axes[0].set_xlabel('Years')
    axes[0].set_ylabel('Portfolio Value ($)')
    axes[0].legend()
    axes[0].grid(True, alpha=0.3)
    axes[0].yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'${x/1000:.0f}K'))
    
    # Normal plot
    percentiles_normal = sim_normal.get_percentiles()
    axes[1].fill_between(time_years, percentiles_normal['p20'], percentiles_normal['p80'],
                        alpha=0.3, color='green', label='20th-80th Percentile')
    axes[1].plot(time_years, percentiles_normal['p50'], color='darkgreen', linewidth=2, label='Median')
    axes[1].set_title('Normal Distribution\n(Traditional - Underestimates Extremes)', 
                     fontweight='bold', fontsize=12)
    axes[1].set_xlabel('Years')
    axes[1].set_ylabel('Portfolio Value ($)')
    axes[1].legend()
    axes[1].grid(True, alpha=0.3)
    axes[1].yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'${x/1000:.0f}K'))
    
    plt.tight_layout()
    return sim_fat, sim_normal, fig


# Main execution
if __name__ == "__main__":
    print("\n" + "="*75)
    print("MONTE CARLO INVESTMENT SIMULATOR")
    print("Based on HonestMath.com Methodology")
    print("="*75)
    
    # Example 1: Standard 30-year plan with fat tails
    print("\n--- EXAMPLE 1: Standard 30-Year Investment Plan ---")
    simulator = MonteCarloInvestmentSimulator(
        initial_balance=10000,
        monthly_contribution=500,
        annual_return=0.08,
        annual_volatility=0.18,
        years=30,
        n_simulations=10000,
        fat_tails=True,
        tail_severity='standard'
    )
    
    simulator.run_simulation()
    simulator.print_summary()
    
    fig1, ax1 = simulator.plot_results()
    plt.savefig('/mnt/user-data/outputs/monte_carlo_simulation.png', dpi=150, bbox_inches='tight')
    print("\n✓ Saved: monte_carlo_simulation.png")
    plt.close()
    
    # Example 2: Comparison
    print("\n--- EXAMPLE 2: Normal vs Fat-Tailed Comparison ---")
    sim_fat, sim_normal, fig2 = compare_distributions()
    plt.savefig('/mnt/user-data/outputs/distribution_comparison.png', dpi=150, bbox_inches='tight')
    print("\n✓ Saved: distribution_comparison.png")
    plt.close()
    
    # Example 3: More aggressive scenario
    print("\n--- EXAMPLE 3: Higher Risk Scenario (Extreme Tails) ---")
    simulator_extreme = MonteCarloInvestmentSimulator(
        initial_balance=10000,
        monthly_contribution=1000,
        annual_return=0.10,  # Higher expected return
        annual_volatility=0.25,  # Much higher volatility
        years=30,
        n_simulations=10000,
        fat_tails=True,
        tail_severity='extreme'  # More severe tail events
    )
    
    simulator_extreme.run_simulation()
    simulator_extreme.print_summary()
    
    fig3, ax3 = simulator_extreme.plot_results()
    plt.savefig('/mnt/user-data/outputs/high_risk_simulation.png', dpi=150, bbox_inches='tight')
    print("\n✓ Saved: high_risk_simulation.png")
    plt.close()
    
    print("\n" + "="*75)
    print("ALL SIMULATIONS COMPLETE!")
    print("="*75)
