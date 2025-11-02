import Link from 'next/link'
import { Calculator, MessageCircle, TrendingUp, Zap, Target, Home as HomeIcon, DollarSign } from 'lucide-react'

export default function Home() {
  return (
    <div className="min-h-screen gradient-bg flex items-center justify-center p-5">
      <div className="max-w-5xl w-full text-center">
        {/* Header */}
        <div className="mb-12 animate-fade-in">
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8 text-arcvest-navy">
            ArcVest Portfolio Investment Tools
          </h1>
        </div>

        {/* Main Tools Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12 animate-slide-up">
          <Link href="/calculator" className="group">
            <div className="bg-white border border-border p-8 h-full card-hover">
              <div className="flex items-center justify-center w-16 h-16 bg-arcvest-light mb-6 mx-auto group-hover:bg-arcvest-teal/20 transition-colors">
                <Calculator className="w-8 h-8 text-arcvest-teal" />
              </div>
              <h2 className="text-2xl font-bold text-arcvest-navy mb-3">
                Portfolio Calculator
              </h2>
              <p className="text-arcvest-body leading-relaxed">
                Analyze portfolio returns, volatility, and performance over time with custom asset allocations and rebalancing strategies
              </p>
              <div className="mt-4 flex items-center justify-center text-sm text-arcvest-teal font-medium">
                <TrendingUp className="w-4 h-4 mr-2" />
                Advanced Analytics
              </div>
            </div>
          </Link>

          <Link href="/retirement-simulator" className="group">
            <div className="bg-white border border-border p-8 h-full card-hover">
              <div className="flex items-center justify-center w-16 h-16 bg-arcvest-light mb-6 mx-auto group-hover:bg-arcvest-teal/20 transition-colors">
                <Target className="w-8 h-8 text-arcvest-teal" />
              </div>
              <h2 className="text-2xl font-bold text-arcvest-navy mb-3">
                Retirement Simulator
              </h2>
              <p className="text-arcvest-body leading-relaxed">
                Run Monte Carlo simulations to test your retirement plan against thousands of market scenarios and real volatility
              </p>
              <div className="mt-4 flex items-center justify-center text-sm text-arcvest-teal font-medium">
                <TrendingUp className="w-4 h-4 mr-2" />
                Monte Carlo Analysis
              </div>
            </div>
          </Link>

          <Link href="/fee-calculator" className="group">
            <div className="bg-white border border-border p-8 h-full card-hover">
              <div className="flex items-center justify-center w-16 h-16 bg-arcvest-light mb-6 mx-auto group-hover:bg-arcvest-teal/20 transition-colors">
                <DollarSign className="w-8 h-8 text-arcvest-teal" />
              </div>
              <h2 className="text-2xl font-bold text-arcvest-navy mb-3">
                Fee Impact Calculator
              </h2>
              <p className="text-arcvest-body leading-relaxed">
                See how much advisory fees cost you over time. Compare typical 1.25% fees vs ArcVest's 0.40% with Monte Carlo analysis
              </p>
              <div className="mt-4 flex items-center justify-center text-sm text-arcvest-teal font-medium">
                <TrendingUp className="w-4 h-4 mr-2" />
                Fee Comparison
              </div>
            </div>
          </Link>

          <Link href="/mortgage-calculator.html" className="group">
            <div className="bg-white border border-border p-8 h-full card-hover">
              <div className="flex items-center justify-center w-16 h-16 bg-arcvest-light mb-6 mx-auto group-hover:bg-arcvest-teal/20 transition-colors">
                <HomeIcon className="w-8 h-8 text-arcvest-teal" />
              </div>
              <h2 className="text-2xl font-bold text-arcvest-navy mb-3">
                Mortgage Calculator
              </h2>
              <p className="text-arcvest-body leading-relaxed">
                Calculate monthly mortgage payments, compare loan terms, and determine home affordability with detailed breakdowns
              </p>
              <div className="mt-4 flex items-center justify-center text-sm text-arcvest-teal font-medium">
                <TrendingUp className="w-4 h-4 mr-2" />
                Home Financing
              </div>
            </div>
          </Link>

          <Link href="/chat" className="group">
            <div className="bg-white border border-border p-8 h-full card-hover">
              <div className="flex items-center justify-center w-16 h-16 bg-arcvest-light mb-6 mx-auto group-hover:bg-arcvest-teal/20 transition-colors">
                <MessageCircle className="w-8 h-8 text-arcvest-teal" />
              </div>
              <h2 className="text-2xl font-bold text-arcvest-navy mb-3">
                Investment Chatbot
              </h2>
              <p className="text-arcvest-body leading-relaxed">
                Ask questions about investments, portfolio strategies, and financial planning with AI-powered insights
              </p>
              <div className="mt-4 flex items-center justify-center text-sm text-arcvest-teal font-medium">
                <Zap className="w-4 h-4 mr-2" />
                AI-Powered
              </div>
            </div>
          </Link>
        </div>

        {/* Footer */}
        <div className="mt-12 text-sm text-arcvest-body animate-fade-in">
          <p>Copyright © 2025 ArcVest | Powered by ArcVest</p>
        </div>
      </div>
    </div>
  )
}
