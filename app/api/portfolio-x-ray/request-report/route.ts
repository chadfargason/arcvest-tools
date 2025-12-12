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
      await sendEmailWithMailerSend(
        { email: body.email, name: body.name },
        pdfBuffer
      );

      return NextResponse.json({
        ok: true,
        message: 'Report sent successfully',
      });
    }

    // If email not configured, return PDF for download
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
  drawText(`Portfolio Annualized Return: ${formatPercent(summary.portfolioAnnualizedReturn || 0)}`, 11, { bold: true });
  drawText(`Benchmark Annualized Return: ${formatPercent(summary.benchmarkAnnualizedReturn || 0)}`, 11);
  drawText(`Outperformance: ${formatPercent(summary.outperformance || 0)}`, 11, { 
    bold: true,
    color: (summary.outperformance || 0) >= 0 ? accentColor : rgb(0.82, 0.16, 0.16)
  });

  const fees = analysis.fees || {};
  drawText(`Total Fees Paid: ${formatCurrency(fees.totalFees || 0)}`, 11);
  
  y -= 20;

  // Holdings Section
  drawText('Current Holdings', 18, { bold: true });
  y -= 10;

  const allocation = analysis.portfolioAllocation || {};
  const holdings = Object.entries(allocation).slice(0, 10); // Top 10 holdings
  
  for (const [ticker, weight] of holdings) {
    drawText(`${ticker}: ${Number(weight).toFixed(2)}%`, 10);
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

