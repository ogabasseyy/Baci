import { access } from 'node:fs/promises';
import { join } from 'node:path';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { resolvePackagedChromiumDirectory } from './receipt-chromium-directory';

const RENDER_TIMEOUT_MS = 30_000;
const MAX_PENDING_RENDERS = 8;
const waitingRenders: Array<() => Promise<void>> = [];
let rendering = false;

function drainQueue() {
  const next = waitingRenders.shift();
  if (!next) return;
  rendering = true;
  void next().finally(() => {
    rendering = false;
    drainQueue();
  });
}

class ReceiptPdfUnavailableError extends Error {}

export function receiptPdfUnavailableResponse(error: unknown) {
  if (!(error instanceof ReceiptPdfUnavailableError)) return null;
  return Response.json(
    { error: 'PDF generation is temporarily unavailable. Try again shortly.' },
    {
      status: 503,
      headers: { 'Retry-After': '5', 'Cache-Control': 'no-store' },
    }
  );
}

function remainingTime(deadline: number) {
  const remaining = deadline - Date.now();
  if (remaining <= 0)
    throw new ReceiptPdfUnavailableError(
      'Invoice PDF render deadline exceeded'
    );
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
export function renderHtmlToPdf(
  html: string,
  workerDeadline?: number
): Promise<Uint8Array> {
  const deadline = Math.min(
    Date.now() + RENDER_TIMEOUT_MS,
    workerDeadline ?? Number.POSITIVE_INFINITY
  );
  return new Promise((resolve, reject) => {
    const timeout = remainingTime(deadline);
    if (waitingRenders.length + Number(rendering) >= MAX_PENDING_RENDERS) {
      reject(new ReceiptPdfUnavailableError('Invoice PDF renderer is busy'));
      return;
    }
    const controller = new AbortController();
    const run = async () => {
      try {
        remainingTime(deadline);
        resolve(await renderDocument(html, deadline, controller.signal));
      } catch (error) {
        reject(error);
      } finally {
        clearTimeout(timer);
      }
    };
    const timer = setTimeout(() => {
      const index = waitingRenders.indexOf(run);
      if (index >= 0) waitingRenders.splice(index, 1);
      const error = new ReceiptPdfUnavailableError(
        'Invoice PDF render deadline exceeded'
      );
      reject(error);
      controller.abort(error);
    }, timeout);
    waitingRenders.push(run);
    if (!rendering) drainQueue();
  });
}

async function launchReceiptBrowser(deadline: number, signal: AbortSignal) {
  const isLinux = process.platform === 'linux';
  try {
    const executablePath = isLinux
      ? await chromium.executablePath(resolvePackagedChromiumDirectory())
      : await localChromePath();
    signal.throwIfAborted();
    return await puppeteer.launch({
      signal,
      executablePath,
      args: isLinux ? chromium.args : [],
      // Sparticuz packages chrome-headless-shell, while local Chrome uses
      // the regular headless browser. CI smoke-tests the packaged Linux path.
      headless: isLinux ? 'shell' : true,
      timeout: remainingTime(deadline),
      protocolTimeout: remainingTime(deadline),
    });
  } catch (error) {
    if (error instanceof ReceiptPdfUnavailableError) throw error;
    throw new ReceiptPdfUnavailableError('Invoice PDF browser unavailable', {
      cause: error,
    });
  }
}

async function renderDocument(
  html: string,
  deadline: number,
  signal: AbortSignal
): Promise<Uint8Array> {
  const browser = await launchReceiptBrowser(deadline, signal);
  let closing: Promise<void> | undefined;
  const close = () => (closing ??= browser.close());
  const onAbort = () => {
    void close().catch(() => {
      // The launch signal also terminates the browser process.
    });
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    signal.throwIfAborted();
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    let blockedResource = false;
    page.on('request', (request) => {
      // No network or file access: logo bytes were validated and embedded by
      // receipt-logo. This also blocks merchant-controlled URL redirects.
      const allowed = /^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(
        request.url()
      );
      if (!allowed) blockedResource = true;
      const decision = allowed ? request.continue() : request.abort();
      // Browser shutdown can race with this decision after a render expires.
      return decision.catch(() => undefined);
    });
    await page.setContent(html, {
      waitUntil: 'load',
      timeout: remainingTime(deadline),
    });
    if (blockedResource) {
      throw new Error('Invoice contains an unsupported external resource');
    }
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      timeout: remainingTime(deadline),
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
  } finally {
    signal.removeEventListener('abort', onAbort);
    await close().catch((error: unknown) => {
      if (!signal.aborted) throw error;
    });
  }
}
