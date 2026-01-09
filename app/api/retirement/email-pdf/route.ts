import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'

interface ContactInfo {
  email: string
  name?: string
  lastName?: string
  phone?: string
}

interface EmailPdfRequest {
  contact: ContactInfo
  simulation: any
  assumptions: any
  mode?: 'download' | 'email'
  charts?: {
    portfolio?: string | null
    distribution?: string | null
  }
}

const MAILERLITE_ENDPOINT = 'https://api.mailerlite.com/api/v2/subscribers'

// Historical scenario descriptions for PDF
const HISTORICAL_SCENARIO_INFO: Record<string, { name: string; date: string; description: string }> = {
  '1929-10': {
    name: 'Great Depression',
    date: 'October 1929',
    description: 'The Great Depression saw stocks fall 86% over 3 years, with deflation initially followed by a slow recovery that took until 1954 to fully recoup losses.'
  },
  '1966-01': {
    name: 'Lost Decades',
    date: 'January 1966',
    description: 'The "Lost Decades" featured high inflation, stagnant markets, and multiple recessions through 1982. After adjusting for inflation, stocks made no real gains for 16 years.'
  },
  '1973-01': {
    name: 'Oil Crisis & Stagflation',
    date: 'January 1973',
    description: 'The Oil Crisis brought stagflation—simultaneous high inflation and economic stagnation—with stocks falling 48% and bonds losing purchasing power.'
  },
  '2000-03': {
    name: 'Dot-Com Bubble',
    date: 'March 2000',
    description: 'The Dot-Com Bubble burst led to a 49% stock decline, and retirees faced a "lost decade" as markets were hit again by the 2008 financial crisis.'
  },
  '2007-10': {
    name: 'Global Financial Crisis',
    date: 'October 2007',
    description: 'The Global Financial Crisis saw stocks fall 57% in 17 months—the worst decline since the Depression—devastating portfolios just as many began retirement.'
  },
  '2022-01': {
    name: 'Inflation Shock',
    date: 'January 2022',
    description: 'The 2022 Inflation Shock brought rapid interest rate hikes and simultaneous stock and bond losses—a rare double hit that hurt even diversified portfolios.'
  }
}

let loraFontDataPromise:
  | Promise<{ regular: Uint8Array; bold: Uint8Array; italic: Uint8Array }>
  | null = null

async function loadLoraFontData() {
  if (!loraFontDataPromise) {
    const basePath = join(process.cwd(), 'app', 'fonts', 'lora')
    loraFontDataPromise = Promise.all([
      readFile(join(basePath, 'Lora-Regular.ttf')),
      readFile(join(basePath, 'Lora-Bold.ttf')),
      readFile(join(basePath, 'Lora-Italic.ttf')),
    ]).then(([regular, bold, italic]) => ({
      regular: new Uint8Array(regular),
      bold: new Uint8Array(bold),
      italic: new Uint8Array(italic),
    }))
  }
  return loraFontDataPromise
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as EmailPdfRequest
    const mode = body.mode ?? 'download'
    const hasMailerSendToken = Boolean(process.env.MAILERSEND_API_TOKEN)
    const shouldSendEmail = mode === 'email' && hasMailerSendToken

    if (!body?.contact?.email) {
      return NextResponse.json({ error: 'Email address is required' }, { status: 400 })
    }

    let mailerLiteResult: unknown = { status: 'skipped', reason: 'mode_download' }
    if (mode === 'email' && process.env.MAILERLITE_API_KEY) {
      mailerLiteResult = await syncWithMailerLite(body.contact)
    }

    const pdfBuffer = await buildPdfBuffer({
      contact: body.contact,
      simulation: body.simulation,
      assumptions: body.assumptions,
      charts: body.charts,
    })

    if (shouldSendEmail) {
      await sendEmailWithMailerSend(body.contact, pdfBuffer)

      return NextResponse.json({
        ok: true,
        mailerLiteStatus: mailerLiteResult,
      })
    }

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="ArcVest-Retirement-Simulation.pdf"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Email PDF error:', error)
    const message = error instanceof Error ? error.message : 'Failed to send PDF'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function syncWithMailerLite(contact: ContactInfo) {
  const apiKey = process.env.MAILERLITE_API_KEY

  if (!apiKey) {
    console.warn('MAILERLITE_API_KEY not configured – skipping MailerLite sync')
    return { status: 'skipped', reason: 'missing_api_key' }
  }

  try {
    const response = await fetch(MAILERLITE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MailerLite-ApiKey': apiKey,
      },
      body: JSON.stringify({
        email: contact.email,
        name: contact.name ?? '',
        fields: {
          last_name: contact.lastName ?? '',
          phone: contact.phone ?? '',
        },
        resubscribe: true,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('MailerLite error:', errorText)
      return { status: 'error', httpStatus: response.status, body: errorText }
    }

    return { status: 'synced' }
  } catch (error) {
    console.error('MailerLite request failed:', error)
    return { status: 'error', reason: 'network_error' }
  }
}

async function buildPdfBuffer({
  contact,
  simulation,
  assumptions,
  charts,
}: {
  contact: ContactInfo
  simulation: any
  assumptions: any
  charts?: { portfolio?: string | null; distribution?: string | null }
}) {
  const { PDFDocument, rgb } = (await import('pdf-lib')) as typeof import('pdf-lib')
  const fontkit = (await import('@pdf-lib/fontkit')).default
  const fonts = await loadLoraFontData()
  const pdfDoc = await PDFDocument.create()
  pdfDoc.registerFontkit(fontkit)
  const normalFont = await pdfDoc.embedFont(fonts.regular)
  const boldFont = await pdfDoc.embedFont(fonts.bold)
  const italicFont = await pdfDoc.embedFont(fonts.italic)

  const portraitSize: [number, number] = [612, 792]
  const landscapeSize: [number, number] = [792, 612]
  const marginDefault = 50

  const textColor = rgb(0.07, 0.09, 0.16)
  const accentColor = rgb(0.106, 0.58, 0.52)
  const subtleColor = rgb(0.44, 0.48, 0.55)
  const cardBackground = rgb(0.97, 0.98, 0.99)
  const cardBorder = rgb(0.88, 0.92, 0.96)

  let page = pdfDoc.addPage(portraitSize)
  let currentMargin = marginDefault
  let currentSize: [number, number] = portraitSize
  let contentWidth = page.getWidth() - currentMargin * 2
  let y = page.getHeight() - currentMargin

  const addPage = (size: [number, number] = portraitSize, marginVal = marginDefault) => {
    page = pdfDoc.addPage(size)
    currentSize = size
    currentMargin = marginVal
    contentWidth = page.getWidth() - currentMargin * 2
    y = page.getHeight() - currentMargin
  }

  const ensureSpace = (
    height: number,
    options?: { size?: [number, number]; margin?: number; onAdd?: () => void }
  ) => {
    if (y - height < currentMargin) {
      addPage(options?.size ?? currentSize, options?.margin ?? currentMargin)
      options?.onAdd?.()
    }
  }

  const drawTextLine = (
    text: string,
    options: {
      size?: number
      font?: any
      color?: ReturnType<typeof rgb>
      lineHeight?: number
      x?: number
    } = {}
  ) => {
    const size = options.size ?? 12
    const font = options.font ?? normalFont
    const color = options.color ?? textColor
    const lineHeight = options.lineHeight ?? size * 1.35
    const x = options.x ?? currentMargin

    ensureSpace(lineHeight)
    page.drawText(text, {
      x,
      y,
      size,
      font,
      color,
    })
    y -= lineHeight
  }

  const drawSectionHeading = (
    text: string,
    options: { size?: number; spacingAfter?: number; lineHeight?: number } = {}
  ) => {
    const size = options.size ?? 14
    const lineHeight = options.lineHeight ?? size * 1.3
    const spacingAfter = options.spacingAfter ?? 6
    ensureSpace(lineHeight + spacingAfter)
    page.drawText(text, {
      x: currentMargin,
      y,
      size,
      font: boldFont,
      color: textColor,
    })
    y -= lineHeight + spacingAfter
  }

  const drawSubheading = (
    text: string,
    options: { size?: number; spacingAfter?: number } = {}
  ) => {
    const size = options.size ?? 14
    ensureSpace(size * 1.4)
    drawTextLine(text, {
      font: boldFont,
      size,
      color: textColor,
      lineHeight: size * 1.4,
    })
    y -= options.spacingAfter ?? 4
  }

  const drawParagraph = (
    text: string,
    options: {
      size?: number
      font?: any
      color?: ReturnType<typeof rgb>
      spacingAfter?: number
      lineHeight?: number
      indent?: number
    } = {}
  ) => {
    const size = options.size ?? 12
    const font = options.font ?? normalFont
    const color = options.color ?? textColor
    const lineHeight = options.lineHeight ?? size * 1.4
    const indent = options.indent ?? 0
    const availableWidth = contentWidth - indent

    const words = text.split(' ')
    let line = ''

    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word
      const lineWidth = font.widthOfTextAtSize(testLine, size)

      if (lineWidth > availableWidth) {
        ensureSpace(lineHeight)
        page.drawText(line, {
          x: currentMargin + indent,
          y,
          size,
          font,
          color,
        })
        y -= lineHeight
        line = word
      } else {
        line = testLine
      }
    }

    if (line) {
      ensureSpace(lineHeight)
      page.drawText(line, {
        x: currentMargin + indent,
        y,
        size,
        font,
        color,
      })
      y -= lineHeight
    }

    if (options.spacingAfter) {
      y -= options.spacingAfter
    }
  }

  const drawSummaryCards = (
    cards: Array<{
      label: string
      value: string
      helper?: string
      valueColor?: ReturnType<typeof rgb>
      background?: ReturnType<typeof rgb>
      borderColor?: ReturnType<typeof rgb>
    }>,
    options: { columns?: number; cardHeight?: number; valueSize?: number; labelSize?: number; gutter?: number; spacingAfter?: number } = {}
  ) => {
    if (!cards.length) return

    const columns = options.columns ?? 2
    const cardHeight = options.cardHeight ?? 80
    const valueSize = options.valueSize ?? 22
    const labelSize = options.labelSize ?? 10
    const gutter = options.gutter ?? 16
    const spacingAfter = options.spacingAfter ?? 20
    const rows = Math.ceil(cards.length / columns)
    const usedHeight = rows * cardHeight + (rows - 1) * gutter

    ensureSpace(usedHeight + spacingAfter)
    const startY = y
    const cardWidth =
      columns === 1 ? contentWidth : (contentWidth - gutter * (columns - 1)) / columns

    cards.forEach((card, index) => {
      const row = Math.floor(index / columns)
      const column = index % columns
      const cardX = currentMargin + column * (cardWidth + gutter)
      const cardTop = startY - row * (cardHeight + gutter)

        page.drawRectangle({
          x: cardX,
          y: cardTop - cardHeight,
          width: cardWidth,
          height: cardHeight,
          color: card.background ?? cardBackground,
          borderColor: card.borderColor ?? cardBorder,
          borderWidth: 1,
        })

        const paddingX = Math.min(16, Math.max(10, cardWidth * 0.08))
        const topPadding = Math.min(16, Math.max(8, cardHeight * 0.28))
        const labelY = cardTop - topPadding
        const valueY = Math.max(
          cardTop - cardHeight + Math.max(8, valueSize + 4),
          labelY - valueSize - 7
        )

        page.drawText(card.label.toUpperCase(), {
          x: cardX + paddingX,
          y: labelY,
          size: labelSize,
          font: boldFont,
          color: subtleColor,
        })

        page.drawText(card.value, {
          x: cardX + paddingX,
          y: valueY,
          size: valueSize,
          font: boldFont,
          color: card.valueColor ?? textColor,
        })

        if (card.helper) {
          page.drawText(card.helper, {
            x: cardX + paddingX,
            y: cardTop - cardHeight + Math.min(14, Math.max(8, cardHeight * 0.25)),
            size: Math.max(8, labelSize - 1),
            font: normalFont,
            color: subtleColor,
          })
        }
    })

    y = startY - usedHeight - spacingAfter
  }

  const drawChartImage = async (
    dataUri: string | null | undefined,
    caption: string,
    options: { maxHeight?: number; spacingAfter?: number } = {}
  ) => {
    const chartHeight = options.maxHeight ?? 220
    const chartPadding = 18
    ensureSpace(chartHeight + chartPadding)

    drawTextLine(caption, { font: boldFont, size: 14, color: textColor, lineHeight: 18 })
    y -= 6

    if (!dataUri) {
      drawParagraph('Chart image not available for this simulation.', { size: 11 })
      return
    }

    try {
      const [, base64] = dataUri.split(',')
      if (!base64) {
        drawParagraph('Chart image not available for this simulation.', { size: 11 })
        return
      }

      const imageBytes = Uint8Array.from(Buffer.from(base64, 'base64'))
      const png = await pdfDoc.embedPng(imageBytes)
      const maxWidth = contentWidth
      const maxHeight = chartHeight
      const scale = Math.min(maxWidth / png.width, maxHeight / png.height, 1)
      const scaledWidth = png.width * scale
      const scaledHeight = png.height * scale
      const chartX = currentMargin + (contentWidth - scaledWidth) / 2

      page.drawImage(png, {
        x: chartX,
        y: y - scaledHeight,
        width: scaledWidth,
        height: scaledHeight,
      })

      const spacingAfter = options.spacingAfter ?? 12
      y -= scaledHeight + spacingAfter
    } catch (error) {
      console.error(`Failed to embed chart (${caption}):`, error)
      drawParagraph('Chart image could not be rendered.', { size: 11 })
    }
  }

  const formatPercent = (value?: number | null, isFraction = true, digits = 1) => {
    if (value === undefined || value === null || Number.isNaN(value)) return '—'
    const percentValue = isFraction ? value * 100 : value
    return `${percentValue.toFixed(digits)}%`
  }

  const calculateMedian = (arr?: number[]) => {
    if (!arr || arr.length === 0) return null
    const sorted = [...arr].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }

  const calculatePercentile = (arr?: number[], percentile = 0.5) => {
    if (!arr || arr.length === 0) return null
    const sorted = [...arr].sort((a, b) => a - b)
    const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * percentile)))
    return sorted[index]
  }

  const formatCurrencyShort = (
    value: number,
    { signed = false, dashForZero = true }: { signed?: boolean; dashForZero?: boolean } = {}
  ) => {
    if (!value) {
      return dashForZero ? '—' : '$0'
    }

    const sign = value < 0 ? '-' : value > 0 && signed ? '+' : ''
    const absValue = Math.abs(value)

    if (absValue >= 1_000_000) {
      const units = absValue / 1_000_000
      const formatted = units >= 10 ? units.toFixed(0) : units.toFixed(1)
      return `${sign}$${formatted}M`
    }

    if (absValue >= 1_000) {
      const units = absValue / 1_000
      const formatted = units >= 10 ? units.toFixed(0) : units.toFixed(1)
      return `${sign}$${formatted}K`
    }

    const formatted = formatCurrency(absValue)
    if (value < 0) return `-${formatted}`
    if (value > 0 && signed) return `+${formatted}`
    return formatted
  }

  const formatSignedCurrency = (
    value: number,
    { positivePrefix = '+', negativePrefix = '-' }: { positivePrefix?: string; negativePrefix?: string } = {}
  ) => {
    if (!value) return '—'
    const formatted = formatCurrency(Math.abs(value))
    return value > 0 ? `${positivePrefix}${formatted}` : `${negativePrefix}${formatted}`
  }

  const successRate = typeof simulation?.successRate === 'number' ? simulation.successRate : null
  const medianBalance = typeof simulation?.medianBalance === 'number' ? simulation.medianBalance : null
  const percentile20 = typeof simulation?.percentile20 === 'number' ? simulation.percentile20 : null
  const percentile80 = typeof simulation?.percentile80 === 'number' ? simulation.percentile80 : null

  const stockMedian = calculateMedian(simulation?.stockReturnDistribution)
  const stockP20 = calculatePercentile(simulation?.stockReturnDistribution, 0.2)
  const stockP80 = calculatePercentile(simulation?.stockReturnDistribution, 0.8)
  const bondMedian = calculateMedian(simulation?.bondReturnDistribution)
  const bondP20 = calculatePercentile(simulation?.bondReturnDistribution, 0.2)
  const bondP80 = calculatePercentile(simulation?.bondReturnDistribution, 0.8)

  const summaryCardsPrimary = [
    {
      label: 'Success Rate',
      value: successRate !== null ? `${(successRate * 100).toFixed(1)}%` : '—',
      valueColor:
        successRate !== null
          ? successRate >= 0.9
            ? rgb(0.04, 0.55, 0.34)
            : successRate >= 0.7
            ? rgb(0.95, 0.63, 0.13)
            : rgb(0.82, 0.16, 0.16)
          : textColor,
    },
    {
      label: 'Median Final Balance',
      value: medianBalance !== null ? formatCurrency(medianBalance) : '—',
    },
    {
      label: '20th Percentile',
      value: percentile20 !== null ? formatCurrency(percentile20) : '—',
    },
    {
      label: '80th Percentile',
      value: percentile80 !== null ? formatCurrency(percentile80) : '—',
    },
  ]

  const summaryCardsSecondary = [
    {
      label: 'Stock Return (Median)',
      value: stockMedian !== null ? `${stockMedian.toFixed(2)}%` : 'N/A',
    },
    {
      label: 'Stock Return (20th-80th)',
      value:
        stockP20 !== null && stockP80 !== null
          ? `${stockP20.toFixed(2)}% to ${stockP80.toFixed(2)}%`
          : 'N/A',
    },
    {
      label: 'Bond Return (Median)',
      value: bondMedian !== null ? `${bondMedian.toFixed(2)}%` : 'N/A',
    },
    {
      label: 'Bond Return (20th-80th)',
      value:
        bondP20 !== null && bondP80 !== null
          ? `${bondP20.toFixed(2)}% to ${bondP80.toFixed(2)}%`
          : 'N/A',
    },
  ]


  const stockAllocationValue = assumptions?.allocation?.STOCKS
  const bondAllocationValue = assumptions?.allocation?.BONDS
  const stockAllocation =
    stockAllocationValue === undefined || stockAllocationValue === null
      ? null
      : Number.isFinite(Number(stockAllocationValue))
      ? Number(stockAllocationValue)
      : null
  const bondAllocation =
    bondAllocationValue === undefined || bondAllocationValue === null
      ? null
      : Number.isFinite(Number(bondAllocationValue))
      ? Number(bondAllocationValue)
      : null

  const otherAllocations: Array<[string, unknown]> = assumptions?.allocation
    ? Object.entries(assumptions.allocation).filter(
        ([ticker]) => ticker !== 'STOCKS' && ticker !== 'BONDS'
      )
    : []

  const drawAssumptionSectionTitle = (title: string) => {
    const sectionHeight = 22
    ensureSpace(sectionHeight)
    drawTextLine(title, { font: boldFont, size: 15, color: textColor, lineHeight: 20 })
    y -= 4
  }

  const drawAssumptionSubheader = (title: string) => {
    const subHeight = 18
    ensureSpace(subHeight)
    drawTextLine(title, {
      font: boldFont,
      size: 11,
      color: subtleColor,
      lineHeight: 15,
    })
    y -= 2
  }

  const drawAssumptionRow = (
    leftLabel: string,
    leftValue: string,
    rightLabel?: string | null,
    rightValue?: string | null
  ) => {
    const gap = 22
    const columnWidth = (contentWidth - gap) / 2
    const rowHeight = 22

    ensureSpace(rowHeight)

    const drawColumn = (x: number, label?: string | null, value?: string | null) => {
      if (label) {
        page.drawText(label, {
          x,
          y: y,
          size: 9,
          font: boldFont,
          color: subtleColor,
        })
      }
      if (value) {
        page.drawText(value, {
          x,
          y: y - 12,
          size: 10.5,
          font: normalFont,
          color: textColor,
        })
      }
    }

    drawColumn(currentMargin, leftLabel, leftValue)
    if (rightLabel || rightValue) {
      drawColumn(currentMargin + columnWidth + gap, rightLabel, rightValue)
    }

    y -= rowHeight
  }

  const drawAllocationTable = (entries: Array<{ label: string; value: string }>) => {
    if (!entries.length) return

    const gap = 22
    const columnWidth = (contentWidth - gap) / 2
    const tableWidth = columnWidth
    const rowHeight = 15
    const headerHeight = 18
    const tableHeight = headerHeight + entries.length * rowHeight + 10

    ensureSpace(tableHeight)

    const tableX = currentMargin
    const tableY = y

    page.drawRectangle({
      x: tableX,
      y: tableY - tableHeight,
      width: tableWidth,
      height: tableHeight,
      color: rgb(0.98, 0.99, 1),
      borderColor: cardBorder,
      borderWidth: 1,
    })

    page.drawText('Asset Allocation', {
      x: tableX + 14,
      y: tableY - 16,
      size: 10,
      font: boldFont,
      color: subtleColor,
    })

    let cursor = tableY - headerHeight
    entries.forEach(({ label, value }) => {
      page.drawText(`\u2022 ${label}`, {
        x: tableX + 18,
        y: cursor - 10,
        size: 10,
        font: normalFont,
        color: textColor,
      })
      const valueWidth = boldFont.widthOfTextAtSize(value, 10)
      page.drawText(value, {
        x: tableX + tableWidth - 18 - valueWidth,
        y: cursor - 10,
        size: 10,
        font: boldFont,
        color: textColor,
      })
      cursor -= rowHeight
    })

    y = tableY - tableHeight - 12
  }

  const yearData: Array<any> = Array.isArray(simulation?.medianSimulationDetails)
    ? simulation.medianSimulationDetails
    : []

  const medianSimulationIndex =
    typeof simulation?.medianSimulationIndex === 'number'
      ? simulation.medianSimulationIndex
      : null

  const finalBalance = yearData.length
    ? yearData[yearData.length - 1]?.endBalance ?? 0
    : assumptions?.startingBalance ?? 0
  const totalContributions = yearData.reduce(
    (sum, row) => sum + (row.contributions ?? 0),
    0
  )
  const totalWithdrawals = yearData.reduce(
    (sum, row) => sum + (row.withdrawalGross ?? 0),
    0
  )
  const totalReturns = yearData.reduce((sum, row) => sum + (row.returns ?? 0), 0)
  const startingBalance = yearData.length ? yearData[0]?.startBalance ?? 0 : finalBalance
  const netGain = finalBalance - startingBalance

  const detailSummaryCards = [
    { label: 'Final Balance', value: formatCurrency(finalBalance) },
    { label: 'Total Contributions', value: formatCurrency(totalContributions) },
    { label: 'Total Withdrawals', value: formatCurrency(totalWithdrawals) },
    { label: 'Total Investment Returns', value: formatCurrency(totalReturns) },
    { label: 'Net Gain', value: formatCurrency(netGain) },
  ]

  type DetailRow = {
    year: string
    age: string
    startBalance: string
    stockReturn: string
    bondReturn: string
    returns: string
    contributions: string
    withdrawalGross: string
    tax: string
    withdrawalNet: string
    endBalance: string
    netChange: string
  }

  const detailRows: DetailRow[] = yearData.map((row: any): DetailRow => ({
    year: row?.year !== undefined && row?.year !== null ? String(row.year) : '—',
    age: String(row.age ?? 0),
    startBalance: formatCurrency(row.startBalance ?? 0),
    stockReturn: typeof row.stockReturn === 'string' ? row.stockReturn : '0.0%',
    bondReturn: typeof row.bondReturn === 'string' ? row.bondReturn : '0.0%',
    returns: formatCurrencyShort(row.returns ?? 0, { signed: false }),
    contributions: formatSignedCurrency(row.contributions ?? 0),
    withdrawalGross: row.withdrawalGross
      ? formatSignedCurrency(row.withdrawalGross, { positivePrefix: '-', negativePrefix: '-' })
      : '—',
    tax: row.tax
      ? formatSignedCurrency(row.tax, { positivePrefix: '-', negativePrefix: '-' })
      : '—',
    withdrawalNet: row.withdrawalNet
      ? formatSignedCurrency(row.withdrawalNet, { positivePrefix: '-', negativePrefix: '-' })
      : '—',
    endBalance: formatCurrency(row.endBalance ?? 0),
    netChange: formatCurrencyShort(row.netChange ?? 0, { signed: false }),
  }))

  const detailColumns: Array<{
    key: keyof DetailRow
    title: string
    width: number
    align?: 'left' | 'right' | 'center'
  }> = [
    { key: 'year', title: 'Year', width: 0.07, align: 'left' },
    { key: 'age', title: 'Age', width: 0.05, align: 'left' },
    { key: 'startBalance', title: 'Start\nBalance', width: 0.1, align: 'right' },
    { key: 'stockReturn', title: 'Stock\nReturn', width: 0.08, align: 'right' },
    { key: 'bondReturn', title: 'Bond\nReturn', width: 0.08, align: 'right' },
    { key: 'returns', title: 'Total\nReturns', width: 0.078, align: 'right' },
    { key: 'contributions', title: 'Contributions', width: 0.09, align: 'right' },
    { key: 'withdrawalGross', title: 'Withdrawal\n(Gross)', width: 0.098, align: 'right' },
    { key: 'tax', title: 'Tax', width: 0.06, align: 'right' },
    { key: 'withdrawalNet', title: 'Withdrawal\n(Net)', width: 0.1, align: 'right' },
    { key: 'endBalance', title: 'End\nBalance', width: 0.1, align: 'right' },
    { key: 'netChange', title: 'Net\nChange', width: 0.1, align: 'right' },
  ]

  let detailColumnPositions: Array<{ x: number; width: number }> = []

  const computeDetailColumnPositions = () => {
    const positions: Array<{ x: number; width: number }> = []
    let cursorX = currentMargin

    detailColumns.forEach((column, index) => {
      const width =
        index === detailColumns.length - 1
          ? currentMargin + contentWidth - cursorX
          : Math.round(contentWidth * column.width)

      positions.push({ x: cursorX, width })
      cursorX += width
    })

    return positions
  }

  const drawTableHeader = () => {
    const headerHeight = 24
    ensureSpace(headerHeight + 6)
    const headerTop = y

    page.drawRectangle({
      x: currentMargin,
      y: headerTop - headerHeight,
      width: contentWidth,
      height: headerHeight,
      color: rgb(0.94, 0.97, 0.98),
    })

    detailColumns.forEach((column, index) => {
      const { x, width } = detailColumnPositions[index]
      const lines = column.title.split('\n')
      const fontSize = 9
      const lineHeight = 10
      let textY = headerTop - 6 - fontSize

      const titleHeight = lines.length * lineHeight
      textY = headerTop - (headerHeight - titleHeight) / 2 - fontSize + 4

      lines.forEach((line, lineIndex) => {
        const textWidth = boldFont.widthOfTextAtSize(line, fontSize)
        let textX = x + 6
        if (column.align === 'right') {
          textX = x + width - textWidth - 6
        } else if (column.align === 'center') {
          textX = x + (width - textWidth) / 2
        }

        page.drawText(line, {
          x: textX,
          y: textY - lineIndex * lineHeight,
          size: fontSize,
          font: boldFont,
          color: subtleColor,
        })
      })
    })

    y = headerTop - headerHeight - 6
  }

  const drawTableRow = (row: DetailRow) => {
    const rowHeight = 16
    const rowTop = y

    detailColumns.forEach((column, index) => {
      const { x, width } = detailColumnPositions[index]
      const text = row[column.key] ?? '—'
      const columnFont = column.key === 'year' ? boldFont : normalFont
      const fontSize = column.key === 'year' ? 10 : 9
      const textWidth = columnFont.widthOfTextAtSize(text, fontSize)

      let textX = x + 6
      if (column.align === 'right') {
        textX = x + width - textWidth - 6
      } else if (column.align === 'center') {
        textX = x + (width - textWidth) / 2
      }

      page.drawText(text, {
        x: textX,
        y: rowTop - rowHeight + 5,
        size: fontSize,
        font: columnFont,
        color: textColor,
      })
    })

    y = rowTop - rowHeight
  }

  const startDetailPage = (withIntro: boolean) => {
    addPage(landscapeSize, 40)
    detailColumnPositions = computeDetailColumnPositions()

    if (withIntro) {
      drawSectionHeading('Year-by-Year Breakdown')
      drawParagraph(
        'After running the simulation, this section shows the detailed year-by-year progression of the median scenario. The median scenario is ranked 500th out of 1,000 simulations by final balance.'
      )

      if (medianSimulationIndex !== null) {
        drawParagraph(`Median Scenario Details (Simulation #${medianSimulationIndex})`, {
          font: boldFont,
          size: 13,
          spacingAfter: 4,
        })
      } else {
        drawParagraph('Median Scenario Details', { font: boldFont, size: 13, spacingAfter: 4 })
      }

      drawParagraph(
        'This shows the year-by-year progression of the simulation that had the median final balance (ranked 500th out of 1,000 scenarios).',
        { size: 11, spacingAfter: 12 }
      )

      drawSummaryCards(detailSummaryCards, {
        columns: 2,
        cardHeight: 68,
        valueSize: 18,
        spacingAfter: 16,
      })
    } else {
      drawTextLine('Year-by-Year Breakdown (continued)', {
        font: boldFont,
        size: 14,
        color: textColor,
        lineHeight: 20,
      })
      y -= 4
    }

    drawTableHeader()
  }

  // ---- Page 1: Summary ----
  drawTextLine('Retirement Outlook Summary', {
    font: boldFont,
    size: 24,
    color: textColor,
    lineHeight: 30,
  })
  if (contact?.name || contact?.lastName) {
    drawTextLine(
      `Prepared for ${[contact.name, contact.lastName].filter(Boolean).join(' ')}`.trim(),
      { size: 12, color: subtleColor, lineHeight: 18 }
    )
  }
  y -= 8

  // Scenario Type Banner
  const historicalScenario = assumptions?.historicalScenario
  const historicalInfo = historicalScenario ? HISTORICAL_SCENARIO_INFO[historicalScenario] : null
  const yearsToRetirement = assumptions?.retirementAge && assumptions?.currentAge
    ? assumptions.retirementAge - assumptions.currentAge
    : 0
  const yearsInRetirement = assumptions?.yearsInRetirement ?? 30
  const totalYears = yearsToRetirement + yearsInRetirement
  const isImmediateRetirement = yearsToRetirement <= 0

  const bannerHeight = 44
  const bannerColor = historicalInfo ? rgb(1, 0.97, 0.9) : rgb(0.91, 0.96, 0.95)
  const bannerBorderColor = historicalInfo ? rgb(0.96, 0.62, 0.04) : accentColor

  ensureSpace(bannerHeight + 12)
  page.drawRectangle({
    x: currentMargin,
    y: y - bannerHeight,
    width: contentWidth,
    height: bannerHeight,
    color: bannerColor,
    borderColor: bannerBorderColor,
    borderWidth: 0,
  })
  page.drawRectangle({
    x: currentMargin,
    y: y - bannerHeight,
    width: 4,
    height: bannerHeight,
    color: bannerBorderColor,
  })

  const bannerTitle = historicalInfo
    ? `Historical Stress Test: ${historicalInfo.name}`
    : 'Monte Carlo Simulation'
  const bannerDesc = historicalInfo
    ? isImmediateRetirement
      ? `All ${yearsInRetirement} years use actual historical returns starting ${historicalInfo.date}.`
      : `Pre-retirement: ${yearsToRetirement} years simulated. Retirement: ${yearsInRetirement} years of actual returns starting ${historicalInfo.date}.`
    : `Results based on 1,000 randomized scenarios across all ${totalYears} years.`

  page.drawText(bannerTitle, {
    x: currentMargin + 14,
    y: y - 16,
    size: 12,
    font: boldFont,
    color: textColor,
  })
  page.drawText(bannerDesc, {
    x: currentMargin + 14,
    y: y - 32,
    size: 10,
    font: normalFont,
    color: subtleColor,
  })
  y -= bannerHeight + 12

  // --- Scenario Being Tested Section ---
  const stockAlloc = stockAllocation ?? 70
  const bondAlloc = bondAllocation ?? 30

  const contributionText = yearsToRetirement > 0
    ? `Beginning at age ${assumptions?.currentAge ?? 30}, contribute ${formatCurrency(assumptions?.annualContribution ?? 0)} per year for ${assumptions?.yearsContributing ?? yearsToRetirement} years, increasing ${((assumptions?.contributionGrowth ?? 0) * 100).toFixed(1)}% annually.`
    : 'No contribution period (retiring immediately).'

  // Build withdrawal description
  let withdrawalDesc = ''
  if (assumptions?.withdrawalType === 'percentage') {
    const pct = ((assumptions?.withdrawalPercentage ?? 0.04) * 100).toFixed(1)
    if (assumptions?.guardrailBand > 0) {
      const band = ((assumptions?.guardrailBand ?? 0) * 100).toFixed(0)
      const adj = ((assumptions?.guardrailAdjustment ?? 0) * 100).toFixed(0)
      withdrawalDesc = `Withdraw ${pct}% of portfolio at retirement, then grow with inflation. Guyton-Klinger guardrails (±${band}% band, ${adj}% adjustment).`
    } else {
      withdrawalDesc = `Withdraw ${pct}% of portfolio at retirement, then grow ${((assumptions?.withdrawalInflation ?? 0) * 100).toFixed(1)}%/year with inflation.`
    }
  } else {
    withdrawalDesc = `Withdraw a fixed ${formatCurrency(assumptions?.annualWithdrawal ?? 0)} per year, increasing ${((assumptions?.withdrawalInflation ?? 0) * 100).toFixed(1)}% annually with inflation.`
  }

  // Calculate how many years of historical data are available (needed for multiple sections)
  let historicalYearsAvailable = 0
  let retirementFullyCovered = false
  if (assumptions?.historicalScenario) {
    const historicalScenario = assumptions.historicalScenario
    const scenarioYear = parseInt(historicalScenario.substring(0, 4)) || 2000
    const scenarioMonth = parseInt(historicalScenario.substring(5, 7)) || 1
    const dataEndYear = 2025
    const dataEndMonth = 12
    const historicalMonthsAvailable = (dataEndYear - scenarioYear) * 12 + (dataEndMonth - scenarioMonth) + 1
    historicalYearsAvailable = Math.floor(historicalMonthsAvailable / 12)
    retirementFullyCovered = historicalYearsAvailable >= yearsInRetirement
  }

  // Build market outcomes description
  let marketDesc = ''
  if (historicalInfo) {
    if (isImmediateRetirement) {
      if (retirementFullyCovered) {
        marketDesc = `SINGLE PATH: All ${yearsInRetirement} years use actual historical returns from ${historicalInfo.date}. All 1,000 simulations are identical—success is either 0% or 100%.`
      } else {
        marketDesc = `Partially Historical: First ${historicalYearsAvailable} years use actual returns from ${historicalInfo.date}. Remaining ${yearsInRetirement - historicalYearsAvailable} years use Monte Carlo.`
      }
    } else {
      if (retirementFullyCovered) {
        marketDesc = `Hybrid: Pre-retirement (${yearsToRetirement} yrs) uses Monte Carlo. Retirement (${yearsInRetirement} yrs) is deterministic—all scenarios use actual returns from ${historicalInfo.date}.`
      } else {
        marketDesc = `Hybrid: Pre-retirement uses Monte Carlo. First ${historicalYearsAvailable} yrs of retirement use actual returns, rest uses Monte Carlo.`
      }
    }
  } else {
    if (assumptions?.simulationMode === 'regime') {
      marketDesc = 'Regime-Switching Model with Calm (85%), Crash (10%), and Inflation (5%) regimes.'
    } else {
      marketDesc = `Monte Carlo: 1,000 scenarios. Stock: ${((assumptions?.stockReturn ?? 0.08) * 100).toFixed(1)}%, Bond: ${((assumptions?.bondReturn ?? 0.045) * 100).toFixed(1)}%.`
    }
  }

  drawSectionHeading('Scenario Being Tested', { size: 12, spacingAfter: 4, lineHeight: 16 })

  // Build "What This Means" for deterministic historical scenarios
  const isDeterministicHistorical = historicalInfo && retirementFullyCovered

  // Draw scenario items in a compact format
  const scenarioItems: Array<{ label: string; value: string; highlight?: boolean }> = [
    { label: 'Portfolio', value: `${formatCurrency(assumptions?.startingBalance ?? 0)} at age ${assumptions?.currentAge ?? 30}, allocated ${stockAlloc}% stocks / ${bondAlloc}% bonds.` },
    { label: 'Contributions', value: contributionText },
    { label: 'Withdrawals', value: `Begin at age ${assumptions?.retirementAge ?? 65} for ${yearsInRetirement} years. ${withdrawalDesc}` },
    { label: 'Market Outcomes', value: marketDesc },
  ]

  // Add "What This Means" for deterministic historical
  if (isDeterministicHistorical) {
    let whatThisMeans = ''
    if (isImmediateRetirement) {
      whatThisMeans = 'DETERMINISTIC: All 1,000 simulations follow identical historical returns. Success is either 0% (plan fails) or 100% (plan survives). The result is definitive.'
    } else {
      whatThisMeans = 'DETERMINISTIC RETIREMENT: Accumulation varies, but all scenarios follow identical historical returns during retirement. Success rates near 0% or 100% indicate whether this period was survivable.'
    }
    scenarioItems.push({ label: 'What This Means', value: whatThisMeans, highlight: true })
  }

  for (const item of scenarioItems) {
    const itemHeight = 28
    ensureSpace(itemHeight)
    page.drawText(item.label.toUpperCase(), {
      x: currentMargin,
      y: y - 6,
      size: 8,
      font: boldFont,
      color: subtleColor,
    })
    // Wrap long value text
    const valueWords = item.value.split(' ')
    let valueLine = ''
    let valueY = y - 18
    for (const word of valueWords) {
      const testLine = valueLine ? `${valueLine} ${word}` : word
      const lineWidth = normalFont.widthOfTextAtSize(testLine, 9)
      if (lineWidth > contentWidth - 10) {
        page.drawText(valueLine, { x: currentMargin, y: valueY, size: 9, font: normalFont, color: textColor })
        valueY -= 11
        valueLine = word
      } else {
        valueLine = testLine
      }
    }
    if (valueLine) {
      page.drawText(valueLine, { x: currentMargin, y: valueY, size: 9, font: normalFont, color: textColor })
    }
    y -= itemHeight
  }
  y -= 6

  drawSectionHeading('Simulation Results', { size: 14, spacingAfter: 4, lineHeight: 18 })
  drawSummaryCards(summaryCardsPrimary, {
    columns: 4,
    cardHeight: 36,
    valueSize: 12,
    labelSize: 7,
    gutter: 12,
    spacingAfter: 3,
  })

  if (summaryCardsSecondary.some((card) => card.value !== 'N/A')) {
    drawSubheading('Annualized Return Distributions', { size: 11, spacingAfter: 4 })
    drawSummaryCards(summaryCardsSecondary, {
      columns: 4,
      cardHeight: 32,
      valueSize: 10.5,
      labelSize: 7,
      gutter: 12,
      spacingAfter: 6,
    })
  }

  // -- Portfolio Chart --
  await drawChartImage(charts?.portfolio ?? null, 'Portfolio Balance Over Time', {
    maxHeight: 220,
    spacingAfter: 12,
  })

  // Comprehensive "Understanding Your Results" section
  const successRatePercent = successRate !== null ? `${Math.round(successRate * 100)}%` : '—'
  const riskPercent = successRate !== null ? `${Math.max(0, 100 - Math.round(successRate * 100))}%` : '—'
  const successRateNum = successRate !== null ? successRate * 100 : 0

  // Calculate median savings at retirement and first year withdrawal
  let medianSavingsAtRetirement = assumptions?.startingBalance ?? 0
  let firstYearWithdrawal = 0
  if (yearData.length > 0) {
    const retirementYearIndex = yearData.findIndex((y: any) => y.withdrawalGross > 0)
    if (retirementYearIndex > 0) {
      medianSavingsAtRetirement = yearData[retirementYearIndex - 1].endBalance ?? medianSavingsAtRetirement
    } else if (retirementYearIndex === 0) {
      medianSavingsAtRetirement = yearData[0].startBalance ?? medianSavingsAtRetirement
    }
    const firstRetirementYear = yearData.find((y: any) => y.withdrawalGross > 0)
    if (firstRetirementYear) {
      firstYearWithdrawal = firstRetirementYear.withdrawalGross
    }
  }

  drawSectionHeading('Understanding Your Results', { size: 12, spacingAfter: 6 })

  // Paragraph 1: What This Simulation Did (narrative)
  let pdfPara1 = 'What This Simulation Did: '
  if (yearsToRetirement > 0) {
    pdfPara1 += `Starting with ${formatCurrency(assumptions?.startingBalance ?? 0)} at age ${assumptions?.currentAge ?? 30}, you saved for ${yearsToRetirement} years. In the median scenario, your portfolio grew to ${formatCurrency(medianSavingsAtRetirement)} by retirement at age ${assumptions?.retirementAge ?? 65}. `
  } else {
    pdfPara1 += `Starting with ${formatCurrency(assumptions?.startingBalance ?? 0)} at age ${assumptions?.currentAge ?? 30} (immediate retirement). `
  }
  if (assumptions?.withdrawalType === 'percentage') {
    const pct = ((assumptions?.withdrawalPercentage ?? 0.04) * 100).toFixed(1)
    pdfPara1 += `You then began withdrawing ${pct}% of your retirement portfolio value (${formatCurrency(firstYearWithdrawal)} in year one), increasing with ${((assumptions?.withdrawalInflation ?? 0) * 100).toFixed(1)}% inflation each year. `
    if (assumptions?.guardrailBand > 0) {
      pdfPara1 += 'Guyton-Klinger guardrails automatically adjusted spending. '
    }
  } else {
    pdfPara1 += `You then began withdrawing ${formatCurrency(assumptions?.annualWithdrawal ?? 0)}/year. In the first year, this was ${formatCurrency(firstYearWithdrawal)}. `
  }
  pdfPara1 += `After ${yearsInRetirement} years of retirement, the simulation tracked how much money remained.`
  drawParagraph(pdfPara1, { size: 10, spacingAfter: 8 })

  // Define percentile strings early since they're used in multiple places
  const p20Str = percentile20 !== null ? formatCurrency(percentile20) : '—'
  const medianStr = medianBalance !== null ? formatCurrency(medianBalance) : '—'
  const p80Str = percentile80 !== null ? formatCurrency(percentile80) : '—'

  // Paragraph 2: Success Rate - different for deterministic historical vs Monte Carlo
  let pdfPara2 = ''
  const failureCount = simulation?.failureCount ?? 0
  const failureAge = simulation?.medianFailureAge ?? 0
  const yearsUntilFailure = failureAge > 0 ? failureAge - (assumptions?.retirementAge ?? 65) : 0

  if (isDeterministicHistorical && (successRateNum <= 5 || successRateNum >= 95)) {
    // Deterministic historical with clear pass/fail
    if (successRateNum <= 5) {
      pdfPara2 = 'HISTORICAL RESULT: PLAN DID NOT SURVIVE. '
      pdfPara2 += `Your retirement plan failed the ${historicalInfo?.name} stress test. `
      if (failureAge > 0) {
        pdfPara2 += `Money ran out at age ${failureAge} (${yearsUntilFailure} years into retirement). `
      }
      pdfPara2 += `What happened: ${historicalInfo?.description} `
      pdfPara2 += 'Your withdrawal strategy could not be sustained through this historically difficult period. '
      pdfPara2 += 'See the Detailed Failure section for a year-by-year breakdown.'
    } else {
      pdfPara2 = 'HISTORICAL RESULT: PLAN SURVIVED. '
      pdfPara2 += `Your retirement plan survived the ${historicalInfo?.name} stress test with a final balance of ${medianStr}. `
      pdfPara2 += `What happened: Despite the challenges of this period, your withdrawal strategy proved sustainable. `
      pdfPara2 += 'See the Detailed Outcome section for a year-by-year breakdown.'
    }
  } else {
    // Standard Monte Carlo or partial historical
    pdfPara2 = `Success Rate: Your success rate of ${successRatePercent} means that in ${successRate !== null ? Math.round(successRate * 1000) : '—'} out of 1,000 simulated scenarios, your retirement savings lasted through your entire ${yearsInRetirement}-year retirement period. `
    if (successRateNum >= 90) {
      pdfPara2 += 'A success rate above 90% is generally considered comfortable for retirement planning.'
    } else if (successRateNum >= 80) {
      pdfPara2 += 'While reasonable, some advisors recommend targeting 90%+ for added peace of mind.'
    } else if (successRateNum >= 70) {
      pdfPara2 += `This suggests moderate risk—there's a ${riskPercent} chance you could outlive your savings.`
    } else {
      pdfPara2 += 'This indicates significant risk of running out of money. We recommend reviewing your plan.'
    }
    if (historicalInfo) {
      pdfPara2 += ` Because you selected a historical stress test, these results incorporate actual market returns from the ${historicalInfo.name} period.`
    }
  }
  drawParagraph(pdfPara2, { size: 10, spacingAfter: 8 })

  // Paragraph 3: Range of Outcomes
  drawParagraph(
    `Range of Outcomes: The 20th percentile (${p20Str}) represents a challenging scenario—only 20% of simulations ended with less. The median (${medianStr}) is your most likely outcome. The 80th percentile (${p80Str}) shows favorable conditions. The spread reflects market uncertainty over ${totalYears} years.`,
    { size: 10, spacingAfter: 8 }
  )

  // Paragraph 4: Key Factors
  let pdfPara4 = 'Key Factors: Your results depend on your withdrawal approach ('
  if (assumptions?.withdrawalType === 'percentage') {
    pdfPara4 += `${((assumptions?.withdrawalPercentage ?? 0.04) * 100).toFixed(1)}% of assets${assumptions?.guardrailBand > 0 ? ' with guardrails' : ''}`
  } else {
    pdfPara4 += `fixed ${formatCurrency(assumptions?.annualWithdrawal ?? 0)}/year`
  }
  pdfPara4 += `), asset allocation (${stockAlloc}/${bondAlloc} stocks/bonds), investment returns, and inflation. `
  if (successRateNum < 80) {
    pdfPara4 += 'Given your success rate, small changes could help—retiring later, reducing spending, or adjusting allocation. We recommend consulting an advisor.'
  } else if (successRateNum < 90) {
    pdfPara4 += 'To push toward 90%+, consider slightly reducing withdrawals or extending working years.'
  } else {
    pdfPara4 += 'Your plan appears on solid footing. Continue to monitor as circumstances change.'
  }
  if (historicalInfo) {
    pdfPara4 += ' Note: This stress test uses a historically difficult period—actual future results will differ.'
  }
  drawParagraph(pdfPara4, { size: 10, spacingAfter: 8 })

  // Paragraph 5: Historical Context (only for historical scenarios)
  if (historicalInfo) {
    drawParagraph(
      `Historical Context: ${historicalInfo.description} This stress test helps you understand whether your plan could withstand similar conditions.`,
      { size: 10, spacingAfter: 8 }
    )
  }

  // Contact info
  drawParagraph(
    'For a more personalized strategy, contact our advisory team at wealth@arcvest.com or 713-581-4550.',
    { size: 10, color: subtleColor, spacingAfter: 0 }
  )

  // ---- Page 2: Distribution Chart ----
  addPage(portraitSize, marginDefault)
  drawSectionHeading('Distribution of Final Balances')
  drawParagraph(
    'Percentage of simulations grouped by ending balance range. This illustrates the spread of possible outcomes across all Monte Carlo scenarios.',
    { size: 11, spacingAfter: 16 }
  )
  await drawChartImage(charts?.distribution ?? null, 'Distribution of Final Balances')

  // ---- Page 3: Assumptions ----
  addPage(portraitSize, marginDefault)
  drawSectionHeading('Simulation Assumptions')
  drawParagraph(
    'The following inputs were used for this simulation run. Adjusting these assumptions will change the projected outcomes.',
    { size: 11, spacingAfter: 16 }
  )
  drawAssumptionSectionTitle('Portfolio')
  drawAssumptionRow(
    'Starting Balance',
    formatCurrency(assumptions?.startingBalance ?? 0),
    'Starting Age',
    assumptions?.currentAge !== undefined ? String(assumptions.currentAge) : '—'
  )
  drawAssumptionSubheader('Asset Allocation')
  const allocationRows: Array<{ label: string; value: string }> = []
  if (stockAllocation !== null) {
    allocationRows.push({
      label: 'Stocks',
      value: formatPercent(stockAllocation, false, 0),
    })
  }
  if (bondAllocation !== null) {
    allocationRows.push({
      label: 'Bonds',
      value: formatPercent(bondAllocation, false, 0),
    })
  }
  otherAllocations.forEach(([ticker, percent]) => {
    const numeric =
      typeof percent === 'number' ? percent : Number.parseFloat(String(percent ?? ''))
    allocationRows.push({
      label: ticker,
      value: Number.isFinite(numeric) ? formatPercent(numeric as number, true, 0) : '—',
    })
  })
  if (!allocationRows.length) {
    allocationRows.push({ label: 'Allocation', value: '—' })
  }
  drawAllocationTable(allocationRows)
  drawAssumptionRow(
    'Investment Fees',
    formatPercent(assumptions?.investmentFee ?? 0, true, 2)
  )
  y -= 12

  drawAssumptionSectionTitle('Contributions')
  drawAssumptionRow(
    'Annual Contribution',
    formatCurrency(assumptions?.annualContribution ?? 0),
    'Growth Rate',
    formatPercent(assumptions?.contributionGrowth ?? 0, true)
  )
  drawAssumptionRow(
    'Years of Contributions',
    assumptions?.yearsContributing !== undefined ? String(assumptions.yearsContributing) : '—'
  )
  y -= 12

  drawAssumptionSectionTitle('Retirement')
  drawAssumptionRow(
    'Retirement Age',
    assumptions?.retirementAge !== undefined ? String(assumptions.retirementAge) : '—',
    'Years in Retirement',
    assumptions?.yearsInRetirement !== undefined ? String(assumptions.yearsInRetirement) : '—'
  )

  // Withdrawal strategy - show based on type
  const withdrawalType = assumptions?.withdrawalType ?? 'fixed'
  const hasGuardrails = withdrawalType === 'percentage' &&
    (assumptions?.guardrailBand > 0 || assumptions?.guardrailAdjustment > 0)

  if (withdrawalType === 'percentage') {
    // Percentage-based withdrawal
    const withdrawalPct = assumptions?.withdrawalPercentage ?? 0
    const strategyLabel = hasGuardrails ? '% of Assets (with Guardrails)' : '% of Assets'
    drawAssumptionRow(
      'Withdrawal Strategy',
      strategyLabel,
      'Withdrawal Rate',
      formatPercent(withdrawalPct, true, 1)
    )

    // Show guardrails if enabled
    if (hasGuardrails) {
      drawAssumptionRow(
        'Guardrail Band',
        formatPercent(assumptions?.guardrailBand ?? 0, true, 0),
        'Guardrail Adjustment',
        formatPercent(assumptions?.guardrailAdjustment ?? 0, true, 0)
      )
    }
  } else {
    // Fixed dollar withdrawal
    drawAssumptionRow(
      'Withdrawal Strategy',
      'Fixed Amount',
      'Annual Withdrawal',
      formatCurrency(assumptions?.annualWithdrawal ?? 0)
    )
  }

  drawAssumptionRow(
    'Withdrawal Inflation',
    formatPercent(assumptions?.withdrawalInflation ?? 0, true)
  )
  y -= 12

  drawAssumptionSectionTitle('Advanced')
  const simulationMode = assumptions?.simulationMode ?? 'simple'
  const simulationModeLabel = simulationMode === 'regime-switching'
    ? 'Regime-Switching (3-State Markov)'
    : 'Simple (Skewed-t Distribution)'

  drawAssumptionRow(
    'Simulation Count',
    assumptions?.simulationCount !== undefined ? String(assumptions.simulationCount) : '—',
    'Rebalancing',
    assumptions?.rebalancing ?? '—'
  )
  drawAssumptionRow(
    'Simulation Mode',
    simulationModeLabel
  )

  if (simulationMode === 'regime-switching') {
    // Regime-switching mode uses calibrated parameters
    drawAssumptionSubheader('Regime-Switching Model')
    drawParagraph(
      'Uses 3-state Markov model: Calm (85%), Crash (10%), Inflation (5%) with regime-specific returns, volatilities, and correlations.',
      { size: 9, font: italicFont, color: subtleColor, spacingAfter: 4 }
    )
  } else {
    // Simple mode uses user-provided parameters
    drawAssumptionSubheader('Expected Returns and Risk')
    drawAssumptionRow(
      'Stock Return (%/yr)',
      formatPercent(assumptions?.stockReturn ?? 0, true, 2),
      'Stock Volatility (%)',
      formatPercent(assumptions?.stockVolatility ?? 0, true, 2)
    )
    drawAssumptionRow(
      'Bond Return (%/yr)',
      formatPercent(assumptions?.bondReturn ?? 0, true, 2),
      'Bond Volatility (%)',
      formatPercent(assumptions?.bondVolatility ?? 0, true, 2)
    )
    drawAssumptionRow(
      'Correlation',
      assumptions?.correlation !== undefined ? assumptions.correlation.toFixed(2) : '—',
      'Degrees of Freedom',
      assumptions?.degreesOfFreedom !== undefined ? String(assumptions.degreesOfFreedom) : '—'
    )
  }
  y -= 8

  drawAssumptionSectionTitle('Taxes - impact of taxes on portfolio withdrawals')
  drawAssumptionRow(
    'Taxable portion',
    formatPercent(assumptions?.taxablePortion ?? 0, true),
    'Estimated Tax Rate',
    formatPercent(assumptions?.taxRate ?? 0, true)
  )
  drawParagraph('(taxable portion of withdrawals)', {
    size: 9,
    font: italicFont,
    color: subtleColor,
    spacingAfter: 8,
    indent: 4,
  })

  // ---- Detailed Outcomes ----
  if (detailRows.length) {
    startDetailPage(true)

    if (y - 28 < currentMargin) {
      startDetailPage(false)
    }

    detailRows.forEach((row) => {
      const rowHeight = 16
      if (y - rowHeight < currentMargin) {
        startDetailPage(false)
      }
      drawTableRow(row)
    })
  } else {
    addPage(landscapeSize, 40)
    drawSectionHeading('Year-by-Year Breakdown')
    drawParagraph('Detailed simulation data was not available for this run.', { size: 11 })
  }

  const footerText =
    'Disclosure - This is for informational and educational purposes only - not advice.'
  const footerSize = 9
  pdfDoc.getPages().forEach((pg) => {
    const footerWidth = boldFont.widthOfTextAtSize(footerText, footerSize)
    const footerX = (pg.getWidth() - footerWidth) / 2
    const footerY = marginDefault / 2
    pg.drawText(footerText, {
      x: footerX,
      y: footerY,
      size: footerSize,
      font: boldFont,
      color: textColor,
    })
  })

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

async function sendEmailWithMailerSend(contact: ContactInfo, pdfBuffer: Buffer) {
  const apiToken = process.env.MAILERSEND_API_TOKEN
  if (!apiToken) {
    throw new Error('MAILERSEND_API_TOKEN is not configured')
  }

  const fromEmail = process.env.PDF_FROM_EMAIL ?? 'wealth@arcvest.com'
  const fromName = process.env.PDF_FROM_NAME ?? 'ArcVest'

  const nextStepsText =
    'Thank you for exploring your retirement readiness with ArcVest. These results are designed to help you understand potential outcomes across thousands of market scenarios. For a more personalized strategy, schedule time with our advisory team. Email wealth@arcvest.com or call 713-581-4550 or sign-up for a time to talk on our website.'

  const htmlBody = `
    <p>Hi ${contact.name ?? 'there'},</p>
    <p>${nextStepsText}</p>
    <p><a href="https://arcvest.com">ArcVest.com</a></p>
    <p>Warmly,<br/>${fromName}</p>
  `

  const textBody = [
    `Hi ${contact.name ?? 'there'},`,
    '',
    nextStepsText,
    '',
    'https://arcvest.com',
    '',
    `Warmly,`,
    fromName,
  ].join('\n')

  const fullName = `${[contact.name, contact.lastName].filter(Boolean).join(' ')}`.trim()
  const payload = {
    from: {
      email: fromEmail,
      name: fromName,
    },
    to: [
      {
        email: contact.email,
        name: fullName || contact.email,
      },
    ],
    subject: 'ArcVest Retirement Simulator Results',
    text: textBody,
    html: htmlBody,
    attachments: [
      {
        filename: 'ArcVest-Retirement-Simulation.pdf',
        content: pdfBuffer.toString('base64'),
        disposition: 'attachment',
      },
    ],
  }

  const response = await fetch('https://api.mailersend.com/v1/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`MailerSend email error: ${response.status} ${errorText}`)
  }
}

function formatCurrency(value: number, allowSign = false) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return allowSign ? '$0' : '—'
  }

  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })

  return formatter.format(value)
}

