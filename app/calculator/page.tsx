'use client'

import { ArrowLeft } from 'lucide-react'

export default function CalculatorPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-white border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <a 
                href="https://arcvest.com/tools" 
                target="_parent"
                className="flex items-center text-arcvest-body hover:text-arcvest-teal transition-colors"
              >
                <ArrowLeft className="w-5 h-5 mr-2" />
                Back to Tools
              </a>
              <div className="h-6 w-px bg-border" />
              <h1 className="text-xl font-semibold text-arcvest-navy">Portfolio Calculator</h1>
            </div>
          </div>
        </div>
      </div>

      {/* Calculator iframe */}
      <iframe 
        src="/calculator.html" 
        className="w-full h-[calc(100vh-4rem)] border-0"
        title="Portfolio Calculator"
      />
    </div>
  )
}
