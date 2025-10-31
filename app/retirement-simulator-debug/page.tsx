import { ArrowLeft, Bug } from 'lucide-react'

export default function RetirementSimulatorDebugPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-white border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <a 
                href="/retirement-simulator" 
                className="flex items-center text-arcvest-body hover:text-arcvest-teal transition-colors"
              >
                <ArrowLeft className="w-5 h-5 mr-2" />
                Back to Simulator
              </a>
              <div className="h-6 w-px bg-border" />
              <div className="flex items-center space-x-2">
                <Bug className="w-5 h-5 text-arcvest-teal" />
                <h1 className="text-xl font-semibold text-arcvest-navy">Debug: Median Simulation</h1>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Debug iframe */}
      <iframe
        src="/retirement-simulator-debug.html"
        className="w-full border-0"
        style={{ height: 'calc(100vh - 64px)' }}
        title="Retirement Simulator Debug"
      />
    </div>
  )
}

