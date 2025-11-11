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

  const drawSectionHeading = (text: string) => {
    const headingHeight = 36
    ensureSpace(headingHeight)
    drawTextLine(text, { font: boldFont, size: 18, color: textColor, lineHeight: 24 })
    drawTextLine('----------------------------------------', {
      font: normalFont,
      size: 12,
      color: accentColor,
      lineHeight: 16,
    })
    y -= 6
  }

  const drawSubheading = (text: string) => {
    ensureSpace(20)
    drawTextLine(text, { font: boldFont, size: 14, color: textColor, lineHeight: 18 })
    y -= 4
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
          labelY - valueSize - 4
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
    { key: 'returns', title: 'Total\nReturns', width: 0.08, align: 'right' },
    { key: 'contributions', title: 'Contributions', width: 0.08, align: 'right' },
    { key: 'withdrawalGross', title: 'Withdrawal\n(Gross)', width: 0.1, align: 'right' },
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
  y -= 12

  drawSectionHeading('Simulation Results')
  drawSummaryCards(summaryCardsPrimary, {
    columns: 4,
    cardHeight: 36,
    valueSize: 12,
    labelSize: 7,
    gutter: 12,
    spacingAfter: 12,
  })

  if (summaryCardsSecondary.some((card) => card.value !== 'N/A')) {
    drawSubheading('Annualized Return Distributions')
    drawSummaryCards(summaryCardsSecondary, {
      columns: 4,
      cardHeight: 32,
      valueSize: 10.5,
      labelSize: 7,
      gutter: 12,
      spacingAfter: 16,
    })
  }

  // -- Portfolio Chart & Next Steps (keep on summary page when possible) --
  await drawChartImage(charts?.portfolio ?? null, 'Portfolio Balance Over Time', {
    maxHeight: 240,
    spacingAfter: 18,
  })
  drawSectionHeading('Next Steps')
  drawParagraph(
    'Thank you for exploring your retirement readiness with ArcVest. These results are designed to help you understand potential outcomes across thousands of market scenarios. For a more personalized strategy, schedule time with our advisory team. Email wealth@arcvest.com or call 713-581-4550 or sign-up for a time to talk on our website.',
    { size: 11, spacingAfter: 0 }
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
  drawAssumptionRow(
    'Annual Withdrawal',
    formatCurrency(assumptions?.annualWithdrawal ?? 0),
    'Withdrawal Inflation',
    formatPercent(assumptions?.withdrawalInflation ?? 0, true)
  )
  y -= 12

  drawAssumptionSectionTitle('Advanced')
  drawAssumptionRow(
    'Simulation Count',
    assumptions?.simulationCount !== undefined ? String(assumptions.simulationCount) : '—',
    'Rebalancing',
    assumptions?.rebalancing ?? '—'
  )
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

