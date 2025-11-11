'use client'

import Link from 'next/link'
import { ArrowLeft, Target } from 'lucide-react'
import { useEffect, useRef } from 'react'

export default function RetirementSimulatorPage() {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return
      if (event.data.type === 'arcvest-simulator-size') {
        const height = Number(event.data.height)
        if (!Number.isFinite(height) || !iframeRef.current) return
        const minHeight = Math.max(window.innerHeight - 64, 400)
        iframeRef.current.style.height = `${Math.max(height, minHeight)}px`
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const requestChildHeight = () => {
    try {
      iframeRef.current?.contentWindow?.postMessage({ type: 'arcvest-request-size' }, '*')
    } catch {
      // ignore cross-origin or unavailable frame errors
    }
  }

  useEffect(() => {
    const timer = setTimeout(requestChildHeight, 500)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-white border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <Link 
                href="/"
                className="flex items-center text-arcvest-body hover:text-arcvest-teal transition-colors"
              >
                <ArrowLeft className="w-5 h-5 mr-2" />
                Back to Tools
              </Link>
              <div className="h-6 w-px bg-border" />
              <div className="flex items-center space-x-2">
                <Target className="w-5 h-5 text-arcvest-teal" />
                <h1 className="text-xl font-semibold text-arcvest-navy">Retirement Simulator</h1>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Simulator iframe */}
      <iframe
        ref={iframeRef}
        src="/retirement-simulator.html"
        className="w-full border-0"
        scrolling="no"
        style={{ minHeight: 'calc(100vh - 64px)' }}
        title="Retirement Simulator"
        onLoad={requestChildHeight}
      />
    </div>
  )
}

