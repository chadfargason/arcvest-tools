#!/usr/bin/env python3
"""
Simple Command-Line Interface for Monte Carlo Investment Simulator
Usage: python simple_cli.py
"""

from monte_carlo_simulator_v2 import MonteCarloInvestmentSimulator
import matplotlib.pyplot as plt

def get_number(prompt, default=None, minimum=None, maximum=None):
    """Helper to get numeric input with validation."""
    while True:
        if default is not None:
            user_input = input(f"{prompt} (default: {default}): ").strip()
            if user_input == "":
                return default
        else:
            user_input = input(f"{prompt}: ").strip()
        
        try:
            value = float(user_input)
            if minimum is not None and value < minimum:
                print(f"  ⚠ Must be at least {minimum}")
                continue
            if maximum is not None and value > maximum:
                print(f"  ⚠ Must be at most {maximum}")
                continue
            return value
        except ValueError:
            print("  ⚠ Please enter a valid number")

def get_choice(prompt, options):
    """Helper to get choice input."""
    print(prompt)
    for i, option in enumerate(options, 1):
        print(f"  {i}. {option}")
    
    while True:
        try:
            choice = int(input("Enter choice: ").strip())
            if 1 <= choice <= len(options):
                return choice - 1
            print(f"  ⚠ Please enter a number between 1 and {len(options)}")
        except ValueError:
            print("  ⚠ Please enter a valid number")

def main():
    """Main CLI interface."""
    print("=" * 70)
    print("MONTE CARLO INVESTMENT SIMULATOR")
    print("Based on HonestMath.com Methodology")
    print("=" * 70)
    print()
    
    # Mode selection
    print("Choose a mode:")
    print("  1. Quick Start (recommended defaults)")
    print("  2. Custom Scenario (full control)")
    print("  3. Preset Examples")
    print()
    
    mode = get_choice("Select mode:", ["Quick Start", "Custom Scenario", "Preset Examples"])
    print()
    
    if mode == 0:  # Quick Start
        print("QUICK START MODE")
        print("-" * 70)
        initial_balance = get_number("Initial balance ($)", default=10000, minimum=0)
        monthly_contribution = get_number("Monthly contribution ($)", default=500, minimum=0)
        years = int(get_number("Years to invest", default=30, minimum=1, maximum=60))
        
        # Use recommended defaults
        annual_return = 0.08
        annual_volatility = 0.18
        fat_tails = True
        tail_severity = 'standard'
        
        print("\nUsing recommended defaults:")
        print(f"  • Annual return: {annual_return*100:.1f}%")
        print(f"  • Annual volatility: {annual_volatility*100:.1f}%")
        print(f"  • Fat tails: Enabled (standard)")
    
    elif mode == 1:  # Custom
        print("CUSTOM SCENARIO")
        print("-" * 70)
        initial_balance = get_number("Initial balance ($)", default=10000, minimum=0)
        monthly_contribution = get_number("Monthly contribution ($)", default=500, minimum=0)
        annual_return = get_number("Expected annual return (%)", default=8, minimum=0, maximum=20) / 100
        annual_volatility = get_number("Annual volatility (%)", default=18, minimum=0, maximum=50) / 100
        years = int(get_number("Years to invest", default=30, minimum=1, maximum=60))
        
        use_fat_tails = get_choice("\nUse fat-tailed distributions?", ["Yes (recommended)", "No (normal)"])
        fat_tails = (use_fat_tails == 0)
        
        if fat_tails:
            severity = get_choice("\nTail severity:", ["Standard", "Extreme"])
            tail_severity = 'standard' if severity == 0 else 'extreme'
        else:
            tail_severity = 'standard'
    
    else:  # Preset Examples
        print("PRESET EXAMPLES")
        print("-" * 70)
        presets = [
            ("Young Investor (Age 25)", {
                'initial_balance': 5000,
                'monthly_contribution': 500,
                'annual_return': 0.09,
                'annual_volatility': 0.20,
                'years': 40,
                'fat_tails': True,
                'tail_severity': 'standard'
            }),
            ("Mid-Career (Age 40)", {
                'initial_balance': 100000,
                'monthly_contribution': 1500,
                'annual_return': 0.08,
                'annual_volatility': 0.16,
                'years': 25,
                'fat_tails': True,
                'tail_severity': 'standard'
            }),
            ("Near Retirement (Age 55)", {
                'initial_balance': 500000,
                'monthly_contribution': 2000,
                'annual_return': 0.06,
                'annual_volatility': 0.12,
                'years': 10,
                'fat_tails': True,
                'tail_severity': 'standard'
            }),
            ("Aggressive Growth", {
                'initial_balance': 25000,
                'monthly_contribution': 1000,
                'annual_return': 0.10,
                'annual_volatility': 0.22,
                'years': 30,
                'fat_tails': True,
                'tail_severity': 'extreme'
            }),
        ]
        
        preset_choice = get_choice("Select preset:", [name for name, _ in presets])
        params = presets[preset_choice][1]
        
        initial_balance = params['initial_balance']
        monthly_contribution = params['monthly_contribution']
        annual_return = params['annual_return']
        annual_volatility = params['annual_volatility']
        years = params['years']
        fat_tails = params['fat_tails']
        tail_severity = params['tail_severity']
        
        print(f"\nSelected: {presets[preset_choice][0]}")
    
    # Confirm and run
    print("\n" + "=" * 70)
    print("SIMULATION PARAMETERS")
    print("=" * 70)
    print(f"Initial Balance: ${initial_balance:,.2f}")
    print(f"Monthly Contribution: ${monthly_contribution:,.2f}")
    print(f"Annual Return: {annual_return*100:.1f}%")
    print(f"Annual Volatility: {annual_volatility*100:.1f}%")
    print(f"Time Horizon: {years} years")
    print(f"Distribution: {'Fat-Tailed (' + tail_severity + ')' if fat_tails else 'Normal'}")
    print("=" * 70)
    print()
    
    confirm = input("Run simulation? (Y/n): ").strip().lower()
    if confirm == 'n':
        print("Simulation cancelled.")
        return
    
    # Create and run simulator
    print("\n🔄 Running simulation (10,000 trials)...")
    
    simulator = MonteCarloInvestmentSimulator(
        initial_balance=initial_balance,
        monthly_contribution=monthly_contribution,
        annual_return=annual_return,
        annual_volatility=annual_volatility,
        years=years,
        n_simulations=10000,
        fat_tails=fat_tails,
        tail_severity=tail_severity
    )
    
    simulator.run_simulation()
    
    # Show results
    simulator.print_summary()
    
    # Ask about visualization
    print()
    show_chart = input("Generate and display chart? (Y/n): ").strip().lower()
    if show_chart != 'n':
        print("\n📊 Generating visualization...")
        fig, ax = simulator.plot_results()
        
        # Ask about saving
        save_chart = input("\nSave chart to file? (Y/n): ").strip().lower()
        if save_chart != 'n':
            filename = input("Filename (default: simulation_result.png): ").strip()
            if not filename:
                filename = "simulation_result.png"
            if not filename.endswith('.png'):
                filename += '.png'
            
            plt.savefig(filename, dpi=150, bbox_inches='tight')
            print(f"✓ Saved: {filename}")
        
        plt.show()
    
    # Ask about another simulation
    print()
    another = input("Run another simulation? (y/N): ").strip().lower()
    if another == 'y':
        print("\n" * 2)
        main()
    else:
        print("\nThank you for using the Monte Carlo Investment Simulator!")
        print("Remember: These are projections based on assumptions, not guarantees.")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nSimulation cancelled by user.")
    except Exception as e:
        print(f"\n⚠ Error: {e}")
        print("Please check your inputs and try again.")
