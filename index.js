const express = require('express');
const bodyParser = require('body-parser');
const chromium = require('chrome-aws-lambda');
const app = express();
app.use(bodyParser.json({ limit: '10mb' }));

const API_KEY = process.env.MICRO_PDF_KEY || '';

app.use((req, res, next) => {
  if (API_KEY) {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ') || auth.split(' ')[1] !== API_KEY) {
      return res.status(401).send('Unauthorized');
    }
  }
  next();
});

app.post('/api/generate', async (req, res) => {
  try {
    const { html, paper = 'A4', orientation = 'portrait', base_url = '' } = req.body || {};
    if (!html) return res.status(400).send('Missing html');

    const executablePath = await chromium.executablePath;
    const browser = await chromium.puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    if (base_url) {
      await page.goto(base_url, { waitUntil: 'networkidle2' });
      await page.setContent(html, { waitUntil: 'networkidle0' });
    } else {
      await page.setContent(html, { waitUntil: 'networkidle0' });
    }

    const pdfBuffer = await page.pdf({
      format: paper,
      printBackground: true,
      landscape: orientation === 'landscape',
      margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' }
    });

    await browser.close();

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'attachment; filename=\"document.pdf\"");
    res.send(pdfBuffer);

  } catch (err) {
    console.error('Error generating PDF:', err);
    res.status(500).send('PDF generation error: ' + err.message);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('PDF microservice running on', port));
