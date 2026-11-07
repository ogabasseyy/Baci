import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const RENDER_TIMEOUT_MS = 30_000;
// Bound browser memory per worker. Each job closes its isolated browser even on failure.
let renderQueue: Promise<unknown> = Promise.resolve();
let pendingRenders = 0;
const MAX_PENDING_RENDERS = 8;

export async function renderHtmlToPdf(html: string): Promise<Uint8Array> {
  if (pendingRenders >= MAX_PENDING_RENDERS) {
    throw new Error('Invoice PDF renderer is busy');
  }
  pendingRenders += 1;
  const result = renderQueue.then(() => renderDocument(html));
  renderQueue = result.catch(() => undefined);
  try {
    return await result;
  } finally {
    pendingRenders -= 1;
  }
}

async function renderDocument(html: string): Promise<Uint8Array> {
  const isLinux = process.platform === 'linux';
  const browser = await puppeteer.launch({
    executablePath: isLinux
      ? await chromium.executablePath()
      : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: isLinux ? chromium.args : [],
    headless: isLinux ? 'shell' : true,
    timeout: RENDER_TIMEOUT_MS,
  });
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      // No network or file access: logo bytes were validated and embedded by
      // receipt-logo. This also blocks merchant-controlled URL redirects.
      if (/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(request.url())) {
        void request.continue();
      } else {
        void request.abort();
      }
    });
    await page.setContent(html, {
      waitUntil: 'load',
      timeout: RENDER_TIMEOUT_MS,
    });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      timeout: RENDER_TIMEOUT_MS,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
  } finally {
    await browser.close();
  }
}
