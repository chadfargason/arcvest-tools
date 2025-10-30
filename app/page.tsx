import Link from 'next/link'
import { Calculator, MessageCircle, TrendingUp, Zap } from 'lucide-react'

export default function Home() {
  return (
    <div className="min-h-screen gradient-bg flex items-center justify-center p-5">
      <div className="max-w-4xl w-full text-center">
        {/* Header */}
        <div className="mb-12 animate-fade-in">
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8 text-arcvest-navy">
            ArcVest Portfolio Investment Tools
          </h1>
        </div>

        {/* Main Tools Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12 animate-slide-up">
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
