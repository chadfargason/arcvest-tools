import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'fs/promises';
import { join } from 'path';

interface ContactInfo {
  email: string;
  name?: string;
}

interface RequestReportBody {
  email: string;
  name?: string;
  analysis: any; // Analysis results from /analyze endpoint
}

let loraFontDataPromise:
  | Promise<{ regular: Uint8Array; bold: Uint8Array; italic: Uint8Array }>
  | null = null;

async function loadLoraFontData() {
  if (!loraFontDataPromise) {
    const basePath = join(process.cwd(), 'app', 'fonts', 'lora');
    loraFontDataPromise = Promise.all([
      readFile(join(basePath, 'Lora-Regular.ttf')),
      readFile(join(basePath, 'Lora-Bold.ttf')),
      readFile(join(basePath, 'Lora-Italic.ttf')),
    ]).then(([regular, bold, italic]) => ({
      regular: new Uint8Array(regular),
      bold: new Uint8Array(bold),
      italic: new Uint8Array(italic),
    }));
  }
  return loraFontDataPromise;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestReportBody;

    if (!body?.email) {
      return NextResponse.json(
        { error: 'Email address is required' },
        { status: 400 }
      );
    }

    if (!body?.analysis) {
      return NextResponse.json(
        { error: 'Analysis data is required' },
        { status: 400 }
      );
    }

    const hasMailerSendToken = Boolean(process.env.MAILERSEND_API_TOKEN);
    const shouldSendEmail = hasMailerSendToken;

    // Generate PDF
    const pdfBuffer = await buildPdfBuffer({
      contact: { email: body.email, name: body.name },
      analysis: body.analysis,
    });

    if (shouldSendEmail) {
      try {
        await sendEmailWithMailerSend(
          { email: body.email, name: body.name },
          pdfBuffer
        );

        return NextResponse.json({
          ok: true,
          message: 'Report sent successfully',
        });
      } catch (emailError) {
        console.error('Email failed, falling back to PDF download:', emailError);
        // Fall through to PDF download if email fails
      }
    }

    // If email not configured or failed, return PDF for download
    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="ArcVest-Portfolio-X-Ray.pdf"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Request report error:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function buildPdfBuffer({
  contact,
  analysis,
}: {
  contact: ContactInfo;
  analysis: any;
}) {
  const { PDFDocument } = await import('pdf-lib');
  const fonts = await loadLoraFontData();
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const normalFont = await pdfDoc.embedFont(fonts.regular);
  const boldFont = await pdfDoc.embedFont(fonts.bold);
  const italicFont = await pdfDoc.embedFont(fonts.italic);

  const pageSize: [number, number] = [612, 792];
  const margin = 50;
  let page = pdfDoc.addPage(pageSize);
  let y = page.getHeight() - margin;
  const contentWidth = page.getWidth() - margin * 2;

  const textColor = rgb(0.07, 0.09, 0.16);
  const accentColor = rgb(0.106, 0.58, 0.52);
  const subtleColor = rgb(0.44, 0.48, 0.55);

  const drawText = (text: string, size: number, options: { bold?: boolean; color?: any; x?: number } = {}) => {
    const font = options.bold ? boldFont : normalFont;
    const color = options.color || textColor;
    const x = options.x || margin;
    page.drawText(text, { x, y, size, font, color });
    y -= size * 1.4;
  };

  const formatPercent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value);
  };
  const formatDateToMMDDYYYY = (dateStr: string) => {
    const parts = dateStr.split('-');
    return `${parts[1]}-${parts[2]}-${parts[0]}`;
  };

  const drawNewPageIfNeeded = (spaceNeeded: number) => {
    if (y < margin + spaceNeeded) {
      page = pdfDoc.addPage(pageSize);
      y = page.getHeight() - margin;
    }
  };

  // Title
  drawText('Portfolio X-Ray Report', 24, { bold: true });
  if (contact.name) {
    drawText(`Prepared for ${contact.name}`, 12, { color: subtleColor });
  }
  y -= 20;

  // Summary Section
  drawText('Executive Summary', 18, { bold: true });
  y -= 10;

  const summary = analysis.summary || {};

  drawText(`Analysis Period: ${summary.startDate || 'N/A'} to ${summary.endDate || 'N/A'}`, 11);
  drawText(`Period: ${summary.periodMonths || 'N/A'} months`, 11);
  y -= 5;

  drawText(`Starting Value: ${formatCurrency(summary.startValue || 0)}`, 11);
  drawText(`Ending Value: ${formatCurrency(summary.endValue || 0)}`, 11);
  y -= 5;

  // Show only IRR (not annualized return)
  if (summary.irr != null) {
    drawText(`Portfolio IRR: ${formatPercent(summary.irr)}`, 11, { bold: true });
  } else {
    drawText(`Portfolio IRR: N/A`, 11, { bold: true });
  }

  if (summary.benchmarkIrr != null) {
    drawText(`Benchmark IRR: ${formatPercent(summary.benchmarkIrr)}`, 11);
  } else {
    drawText(`Benchmark IRR: N/A`, 11);
  }

  const outperformance = (summary.irr || 0) - (summary.benchmarkIrr || 0);
  drawText(`Outperformance: ${formatPercent(outperformance)}`, 11, {
    bold: true,
    color: outperformance >= 0 ? accentColor : rgb(0.82, 0.16, 0.16)
  });

  y -= 10;
  const fees = analysis.fees || {};
  drawText(`Explicit Fees: ${formatCurrency(fees.explicitFees || 0)}`, 10);
  drawText(`Implicit Fees (est): ${formatCurrency(fees.implicitFees || 0)}`, 10);
  drawText(`Total Fees Paid: ${formatCurrency(fees.totalFees || 0)}`, 11, { bold: true });

  y -= 20;

  // Current Holdings Section
  drawNewPageIfNeeded(200);
  drawText('Current Holdings', 18, { bold: true });
  y -= 10;

  const allocation = analysis.portfolioAllocation || {};
  const holdings = Object.entries(allocation)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 15); // Top 15 holdings

  for (const [ticker, weight] of holdings) {
    drawNewPageIfNeeded(20);
    drawText(`${ticker}: ${Number(weight).toFixed(2)}%`, 10);
  }

  y -= 20;

  // Benchmark Composition Section
  drawNewPageIfNeeded(200);
  drawText('Benchmark Composition', 18, { bold: true });
  y -= 10;

  const benchmarkWeights = analysis.benchmarkWeights || {};
  const benchmarks = Object.entries(benchmarkWeights)
    .sort((a, b) => Number(b[1]) - Number(a[1]));

  if (benchmarks.length > 0) {
    for (const [ticker, weight] of benchmarks) {
      drawNewPageIfNeeded(20);
      drawText(`${ticker}: ${Number(weight).toFixed(2)}%`, 10);
    }
  } else {
    drawText('No benchmark data available', 10);
  }

  y -= 20;

  // Monthly Performance Section
  if (analysis.debug?.accountResults?.[0]?.snapshotCount > 0) {
    drawNewPageIfNeeded(300);
    drawText('Monthly Portfolio Values', 18, { bold: true });
    y -= 10;

    drawText('Showing calculation methodology - portfolio values at end of each month:', 9, { color: subtleColor });
    y -= 10;

    // Get monthly data from debug info
    const monthlyAnalysis = analysis.monthlyAnalysis || [];

    if (monthlyAnalysis.length > 0) {
      // Show all months
      for (const month of monthlyAnalysis) {
        drawNewPageIfNeeded(30);
        const monthStr = month.month || 'N/A';
        const value = formatCurrency(month.portfolioValue || 0);
        drawText(`${monthStr}: ${value}`, 10);
      }
    } else {
      // Fallback: show start and end values
      drawText(`Start (${summary.startDate}): ${formatCurrency(summary.startValue || 0)}`, 10);
      drawText(`End (${summary.endDate}): ${formatCurrency(summary.endValue || 0)}`, 10);
    }

    y -= 10;
    drawText(`Note: Monthly values calculated from transactions + market returns`, 8, { color: subtleColor });
  }

  y -= 20;

  // IRR Cashflow Analysis Section
  const cashflowDetails = analysis.cashflowDetails || [];
  if (cashflowDetails.length > 0) {
    drawNewPageIfNeeded(300);
    drawText('IRR Calculation Cashflows', 18, { bold: true });
    y -= 10;

    drawText('These are the exact cashflows used in the IRR calculation:', 9, { color: subtleColor });
    y -= 10;

    for (const cf of cashflowDetails) {
      drawNewPageIfNeeded(20);
      const amountStr = cf.amount < 0
        ? `-${formatCurrency(Math.abs(cf.amount))}`
        : `+${formatCurrency(cf.amount)}`;
      const typeStr = cf.type.padEnd(14);
      drawText(`${formatDateToMMDDYYYY(cf.date)}  ${typeStr}  ${amountStr}`, 10);
    }

    y -= 10;
    drawText(`Portfolio IRR: ${formatPercent(summary.irr || 0)}`, 11, { bold: true });
  }

  y -= 20;

  // Benchmark IRR Analysis Section
  const benchmarkMonthlyDetails = analysis.benchmarkMonthlyDetails || [];
  if (benchmarkMonthlyDetails.length > 0 && summary.benchmarkEndValue) {
    drawNewPageIfNeeded(400);
    drawText('Benchmark Performance Detail', 18, { bold: true });
    y -= 10;

    drawText('Monthly benchmark evolution:', 9, { color: subtleColor });
    y -= 10;

    // Show benchmark weights
    const benchmarkWeights = analysis.benchmarkWeights || {};
    const benchmarks = Object.entries(benchmarkWeights).sort((a, b) => Number(b[1]) - Number(a[1]));
    if (benchmarks.length > 0) {
      drawText('Benchmark Composition:', 11, { bold: true });
      for (const [ticker, weight] of benchmarks) {
        drawNewPageIfNeeded(20);
        drawText(`  ${ticker}: ${Number(weight).toFixed(2)}%`, 10);
      }
      y -= 10;
    }

    drawText('Monthly Returns & Values:', 11, { bold: true });
    // Show first few and last few months to avoid overwhelming the PDF
    const monthsToShow = Math.min(12, benchmarkMonthlyDetails.length);
    const shownMonths = benchmarkMonthlyDetails.slice(0, monthsToShow);

    for (const month of shownMonths) {
      drawNewPageIfNeeded(20);
      const returnStr = `${month.return >= 0 ? '+' : ''}${month.return.toFixed(2)}%`;
      const cashflowStr = month.cashflow !== 0
        ? (month.cashflow < 0 ? ` -${formatCurrency(Math.abs(month.cashflow))}` : ` +${formatCurrency(month.cashflow)}`)
        : '';
      drawText(`${formatDateToMMDDYYYY(month.month)}: ${returnStr.padEnd(8)} ${formatCurrency(month.value)}${cashflowStr}`, 9);
    }

    if (benchmarkMonthlyDetails.length > monthsToShow) {
      y -= 5;
      drawText(`[${benchmarkMonthlyDetails.length - monthsToShow} more months not shown]`, 8, { color: subtleColor });
    }

    y -= 10;
    drawText(`Benchmark Start: ${formatCurrency(summary.startValue)}`, 10);
    drawText(`Benchmark End: ${formatCurrency(summary.benchmarkEndValue)}`, 10);
    drawText(`Benchmark IRR: ${formatPercent(summary.benchmarkIrr || 0)}`, 11, { bold: true });
  }

  y -= 20;

  // Transaction History Section
  const allTransactions = analysis.allTransactions || [];

  if (allTransactions.length > 0) {
    drawNewPageIfNeeded(300);
    drawText('Transaction History', 18, { bold: true });
    y -= 10;

    const totalTransactionCount = allTransactions.length;
    const maxTransactions = 300;
    const showingAllTransactions = totalTransactionCount <= maxTransactions;

    if (showingAllTransactions) {
      drawText(`Showing all ${totalTransactionCount} transactions:`, 9, { color: subtleColor });
    } else {
      drawText(`Showing first ${maxTransactions} of ${totalTransactionCount} transactions:`, 9, { color: subtleColor });
    }
    y -= 10;

    // Group transactions by account
    const txsByAccount = new Map<string, any[]>();
    for (const tx of allTransactions) {
      const accountId = tx.account_id || 'Unknown Account';
      if (!txsByAccount.has(accountId)) {
        txsByAccount.set(accountId, []);
      }
      txsByAccount.get(accountId)!.push(tx);
    }

    let txCount = 0;

    for (const [accountId, txs] of txsByAccount) {
      if (txCount >= maxTransactions) {
        drawNewPageIfNeeded(40);
        drawText(`[Remaining ${totalTransactionCount - maxTransactions} transactions not shown]`, 9, { color: subtleColor });
        break;
      }

      drawNewPageIfNeeded(100);
      y -= 5;
      drawText(`Account: ${accountId.substring(0, 20)}...`, 12, { bold: true });
      y -= 5;

      // Sort by date descending
      const sortedTxs = txs.sort((a, b) => b.date.localeCompare(a.date));

      for (const tx of sortedTxs) {
        if (txCount >= maxTransactions) break;

        drawNewPageIfNeeded(60);

        // Transaction details
        const date = tx.date || 'N/A';
        const type = tx.type || 'transaction';
        const subtype = tx.subtype ? ` (${tx.subtype})` : '';
        const security = tx.security || 'Cash/Other';
        const amount = tx.amount || 0;

        // Color code by transaction type
        let typeColor = textColor;
        if (type === 'buy') typeColor = accentColor;
        if (type === 'sell') typeColor = rgb(0.82, 0.16, 0.16);

        drawText(`${date} - ${type.toUpperCase()}${subtype}`, 9, { bold: true, color: typeColor });
        drawText(`  Security: ${security.substring(0, 45)}`, 8);

        if (tx.quantity != null && tx.quantity !== 0) {
          const qtyText = tx.quantity > 0 ? `+${tx.quantity.toFixed(4)}` : tx.quantity.toFixed(4);
          drawText(`  Quantity: ${qtyText} @ ${formatCurrency(tx.price || 0)}`, 8);
        }

        drawText(`  Amount: ${formatCurrency(Math.abs(amount))}`, 8);

        if (tx.fees && tx.fees > 0) {
          drawText(`  Fees: ${formatCurrency(tx.fees)}`, 8, { color: rgb(0.82, 0.16, 0.16) });
        }

        y -= 3;
        txCount++;
      }

      y -= 10;
    }
  }

  y -= 20;

  // Footer
  const footerText = 'Disclosure - This is for informational and educational purposes only - not advice.';
  pdfDoc.getPages().forEach((pg) => {
    const footerWidth = boldFont.widthOfTextAtSize(footerText, 9);
    const footerX = (pg.getWidth() - footerWidth) / 2;
    pg.drawText(footerText, {
      x: footerX,
      y: margin / 2,
      size: 9,
      font: boldFont,
      color: textColor,
    });
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

async function sendEmailWithMailerSend(contact: ContactInfo, pdfBuffer: Buffer) {
  const apiToken = process.env.MAILERSEND_API_TOKEN;
  if (!apiToken) {
    throw new Error('MAILERSEND_API_TOKEN is not configured');
  }

  const fromEmail = process.env.PDF_FROM_EMAIL ?? 'wealth@arcvest.com';
  const fromName = process.env.PDF_FROM_NAME ?? 'ArcVest';

  const emailBody =
    'Thank you for using the ArcVest Portfolio X-Ray tool. Your detailed portfolio analysis report is attached. For a more personalized strategy, schedule time with our advisory team. Email wealth@arcvest.com or call 713-581-4550.';

  const htmlBody = `
    <p>Hi ${contact.name ?? 'there'},</p>
    <p>${emailBody}</p>
    <p><a href="https://arcvest.com">ArcVest.com</a></p>
    <p>Warmly,<br/>${fromName}</p>
  `;

  const textBody = [
    `Hi ${contact.name ?? 'there'},`,
    '',
    emailBody,
    '',
    'https://arcvest.com',
    '',
    `Warmly,`,
    fromName,
  ].join('\n');

  const payload = {
    from: {
      email: fromEmail,
      name: fromName,
    },
    to: [
      {
        email: contact.email,
        name: contact.name || contact.email,
      },
    ],
    subject: 'ArcVest Portfolio X-Ray Report',
    text: textBody,
    html: htmlBody,
    attachments: [
      {
        filename: 'ArcVest-Portfolio-X-Ray.pdf',
        content: pdfBuffer.toString('base64'),
        disposition: 'attachment',
      },
    ],
  };

  const response = await fetch('https://api.mailersend.com/v1/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MailerSend email error: ${response.status} ${errorText}`);
  }
}

