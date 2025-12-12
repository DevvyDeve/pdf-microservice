// index.js (replace existing)
import express from 'express';
import bodyParser from 'body-parser';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fetch from 'node-fetch'; // included by default in Node 18+; if not, add to package.json

const app = express();
app.use(bodyParser.json({ limit: '12mb' }));

const API_KEY = process.env.MICRO_PDF_KEY || "";
const PDFSHIFT_KEY = process.env.PDFSHIFT_KEY || "";

app.use((req, res, next) => {
  if (API_KEY) {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith("Bearer ") || auth.split(" ")[1] !== API_KEY) {
      return res.status(401).send("Unauthorized");
    }
  }
  next();
});

async function generatePdfWithChromium(html, options = {}) {
  const executablePath = await chromium.executablePath;
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  });

  const page = await browser.newPage();
  if (options.base_url) {
    await page.goto(options.base_url, { waitUntil: 'networkidle2' });
    await page.setContent(html, { waitUntil: 'networkidle0' });
  } else {
    await page.setContent(html, { waitUntil: 'networkidle0' });
  }

  const pdfBuffer = await page.pdf({
    format: options.paper || 'A4',
    printBackground: true,
    landscape: (options.orientation === 'landscape'),
    margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' }
  });

  await browser.close();
  return pdfBuffer;
}

async function generatePdfWithPdfShift(html, options = {}) {
  if (!process.env.PDFSHIFT_KEY) throw new Error('No PDFSHIFT_KEY configured');

  const apiUrl = 'https://api.pdfshift.io/v3/convert/pdf'; // <- updated endpoint
  const payload = {
    source: html,
    // PDFShift accepts many options; these are common ones:
    landscape: (options.orientation === 'landscape') || false,
    // page size
    page_size: options.paper || 'A4',
    // you can add margins if you want:
    margins: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
    // enable print background
    print_background: true
  };

  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // PDFShift uses Bearer token in newer endpoints; if yours needs different auth we'll adjust.
      'Authorization': 'Bearer ' + process.env.PDFSHIFT_KEY
    },
    body: JSON.stringify(payload),
    // node-fetch doesn't support timeout option here; Vercel lambda timeout is in function settings
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error('PDFShift error: ' + resp.status + ' ' + text);
  }

  const buffer = await resp.arrayBuffer();
  return Buffer.from(buffer);
}

app.post('/api/generate', async (req, res) => {
  try {
    const { html, paper = "A4", orientation = "portrait", base_url = "" } = req.body || {};
    if (!html) return res.status(400).send("Missing html");

    // Try Chromium first
    try {
      const pdfBuffer = await generatePdfWithChromium(html, { paper, orientation, base_url });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=document.pdf');
      return res.send(pdfBuffer);
    } catch (chromErr) {
      console.warn('Chromium failed, falling back to PDFShift:', chromErr && chromErr.message);
      // fall through to PDFShift
    }

    // Fallback: PDFShift
    try {
      const pdfBuffer = await generatePdfWithPdfShift(html, { paper, orientation });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=document.pdf');
      return res.send(pdfBuffer);
    } catch (psErr) {
      console.error('PDFShift fallback failed:', psErr);
      return res.status(500).send('PDF generation failed: ' + psErr.message);
    }

  } catch (err) {
    console.error('Unhandled PDF generation error:', err);
    return res.status(500).send('PDF generation error: ' + err.message);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('PDF microservice running on port', port));
