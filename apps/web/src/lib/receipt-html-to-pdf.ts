import { access } from 'node:fs/promises';
import { join } from 'node:path';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const RENDER_TIMEOUT_MS = 30_000;
// Bound browser memory per worker. Each job closes its isolated browser even on failure.
let renderQueue: Promise<unknown> = Promise.resolve();
let pendingRenders = 0;
const MAX_PENDING_RENDERS = 8;

function remainingTime(deadline: number) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Invoice PDF render deadline exceeded');
  return remaining;
}

async function localChromePath() {
  const configured = process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = configured
    ? [configured]
    : process.platform === 'win32'
      ? [
          process.env.LOCALAPPDATA,
          process.env.ProgramFiles,
          process.env['ProgramFiles(x86)'],
        ].flatMap((root) =>
          root
            ? [join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')]
            : []
        )
      : ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  for (const path of candidates) {
    try {
      await access(path);
      return path;
    } catch {
      // Try the next standard installation path.
    }
  }
  throw new Error(
    'Chrome executable unavailable. Set PUPPETEER_EXECUTABLE_PATH.'
  );
}

/** Limit both queue wait and rendering so an outbox caller can release its lease. */
export async function renderHtmlToPdf(
  html: string,
  workerDeadline?: number
): Promise<Uint8Array> {
  const deadline = Math.min(
    Date.now() + RENDER_TIMEOUT_MS,
    workerDeadline ?? Number.POSITIVE_INFINITY
  );
  const timeout = remainingTime(deadline);
  if (pendingRenders >= MAX_PENDING_RENDERS)
    throw new Error('Invoice PDF renderer is busy');
  pendingRenders += 1;
  const result = renderQueue
    .then(() => {
      remainingTime(deadline);
      return renderDocument(html, deadline);
    })
    .finally(() => {
      pendingRenders -= 1;
    });
  renderQueue = result.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      result,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Invoice PDF render deadline exceeded')),
          timeout
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function renderDocument(
  html: string,
  deadline: number
): Promise<Uint8Array> {
  const isLinux = process.platform === 'linux';
  const executablePath = isLinux
    ? await chromium.executablePath()
    : await localChromePath();
  const browser = await puppeteer.launch({
    executablePath,
    args: isLinux ? chromium.args : [],
    headless: isLinux ? 'shell' : true,
    timeout: remainingTime(deadline),
    protocolTimeout: remainingTime(deadline),
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
      timeout: remainingTime(deadline),
    });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      timeout: remainingTime(deadline),
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
  } finally {
    await browser.close();
  }
}
