import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  receiptPdfUnavailableResponse,
  renderHtmlToPdf,
} from './receipt-html-to-pdf';

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  close: vi.fn(),
  pdf: vi.fn(),
  setContent: vi.fn(),
  on: vi.fn(),
  setJavaScriptEnabled: vi.fn(),
  setRequestInterception: vi.fn(),
  executablePath: vi.fn().mockResolvedValue('/tmp/chromium'),
}));
vi.mock(import('node:fs/promises'), async (importOriginal) => ({
  ...(await importOriginal()),
  access: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@sparticuz/chromium', () => ({
  default: { args: ['--serverless'], executablePath: mocks.executablePath },
}));
vi.mock('puppeteer-core', () => ({ default: { launch: mocks.launch } }));

describe('invoice HTML PDF isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pdf.mockResolvedValue(new Uint8Array([1, 2]));
    mocks.close.mockReset().mockResolvedValue(undefined);
    mocks.launch.mockResolvedValue({
      close: mocks.close,
      newPage: async () => mocks,
    });
  });
  it('prints the supplied HTML with backgrounds and closes the browser', async () => {
    expect(await renderHtmlToPdf('<html>invoice</html>')).toEqual(
      new Uint8Array([1, 2])
    );
    expect(mocks.setContent).toHaveBeenCalledWith(
      '<html>invoice</html>',
      expect.any(Object)
    );
    expect(mocks.pdf).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
      })
    );
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('launches the packaged serverless Chromium binary on Linux', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    try {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });
      await renderHtmlToPdf('<html>invoice</html>');
      expect(mocks.executablePath).toHaveBeenCalledOnce();
      expect(mocks.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          executablePath: '/tmp/chromium',
          args: ['--serverless'],
          headless: 'shell',
        })
      );
    } finally {
      if (platform) Object.defineProperty(process, 'platform', platform);
    }
  });
  it('disables scripts and blocks network and file requests while allowing embedded logo bytes', async () => {
    await renderHtmlToPdf('<html>invoice</html>');
    expect(mocks.setJavaScriptEnabled).toHaveBeenCalledWith(false);
    const handle = mocks.on.mock.calls[0][1];
    for (const url of [
      'https://example.com/logo',
      'http://169.254.169.254/',
      'file:///etc/passwd',
    ]) {
      const request = {
        url: () => url,
        abort: vi.fn().mockResolvedValue(undefined),
        continue: vi.fn().mockResolvedValue(undefined),
      };
      handle(request);
      expect(request.abort).toHaveBeenCalledOnce();
    }
    const request = {
      url: () => 'data:image/png;base64,AQID',
      abort: vi.fn().mockResolvedValue(undefined),
      continue: vi.fn().mockResolvedValue(undefined),
    };
    handle(request);
    expect(request.continue).toHaveBeenCalledOnce();
  });
  it('rejects an invoice when a required external asset is blocked', async () => {
    mocks.setContent.mockImplementationOnce(async () => {
      const handler = mocks.on.mock.calls[0][1];
      await handler({
        url: () => 'https://example.com/logo.png',
        abort: vi.fn().mockResolvedValue(undefined),
      });
    });

    await expect(
      renderHtmlToPdf('<img src="https://example.com/logo.png">')
    ).rejects.toThrow('Invoice contains an unsupported external resource');
    expect(mocks.pdf).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('handles interception rejection when the browser closes the request', async () => {
    await renderHtmlToPdf('<html>invoice</html>');
    const handle = mocks.on.mock.calls[0][1];
    const request = {
      url: () => 'data:image/png;base64,AQID',
      continue: vi.fn().mockRejectedValue(new Error('Target closed')),
    };
    await expect(handle(request)).resolves.toBeUndefined();
  });

  it('serializes eight jobs, rejects a ninth, and recovers capacity', async () => {
    const held = Promise.withResolvers<Uint8Array>();
    mocks.pdf.mockReturnValueOnce(held.promise);
    const jobs = Array.from({ length: 8 }, () =>
      renderHtmlToPdf('<html>invoice</html>')
    );
    await vi.waitFor(() => expect(mocks.pdf).toHaveBeenCalledOnce());
    expect(mocks.launch).toHaveBeenCalledOnce();
    const unavailable = await renderHtmlToPdf('<html>overflow</html>').catch(
      receiptPdfUnavailableResponse
    );
    expect(unavailable).toBeInstanceOf(Response);
    if (unavailable instanceof Response) {
      expect(unavailable.status).toBe(503);
      expect(unavailable.headers.get('Retry-After')).toBe('5');
    }
    held.resolve(new Uint8Array([1, 2]));
    await Promise.all(jobs);
    expect(mocks.launch).toHaveBeenCalledTimes(8);
    await expect(renderHtmlToPdf('<html>recovered</html>')).resolves.toEqual(
      new Uint8Array([1, 2])
    );
  });

  it('rejects a queued render before the worker deadline and never launches it', async () => {
    vi.useFakeTimers();
    const started = Promise.withResolvers<void>();
    const held = Promise.withResolvers<Uint8Array>();
    mocks.pdf.mockImplementationOnce(() => {
      started.resolve();
      return held.promise;
    });
    const active = renderHtmlToPdf('<html>active</html>');
    try {
      await started.promise;
      const expired = renderHtmlToPdf('<html>expired</html>', Date.now() + 10);
      const rejected = expect(expired).rejects.toThrow('deadline');
      await vi.advanceTimersByTimeAsync(10);
      await rejected;
    } finally {
      held.resolve(new Uint8Array([1, 2]));
      await active;
      vi.useRealTimers();
    }
    await renderHtmlToPdf('<html>next</html>');
    expect(mocks.launch).toHaveBeenCalledTimes(2);
  });

  it('releases expired waiting jobs without waiting for the active renderer', async () => {
    vi.useFakeTimers();
    const started = Promise.withResolvers<void>();
    const held = Promise.withResolvers<Uint8Array>();
    mocks.pdf.mockImplementationOnce(() => {
      started.resolve();
      return held.promise;
    });
    const active = renderHtmlToPdf('<html>active</html>');
    try {
      await started.promise;
      const expired = Array.from({ length: 7 }, () =>
        expect(
          renderHtmlToPdf('<html>expired</html>', Date.now() + 10)
        ).rejects.toThrow('deadline')
      );
      await vi.advanceTimersByTimeAsync(10);
      await Promise.all(expired);
      const replacement = renderHtmlToPdf('<html>replacement</html>');
      const resolved = expect(replacement).resolves.toEqual(
        new Uint8Array([1, 2])
      );
      held.resolve(new Uint8Array([1, 2]));
      await resolved;
      expect(mocks.launch).toHaveBeenCalledTimes(2);
    } finally {
      held.resolve(new Uint8Array([1, 2]));
      await active;
      vi.useRealTimers();
    }
  });

  it('returns retryable 503 when the packaged Chromium executable is unavailable', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true,
    });
    try {
      mocks.executablePath.mockRejectedValueOnce(new Error('Corrupt archive'));
      const response = await renderHtmlToPdf('<html>invoice</html>').catch(
        receiptPdfUnavailableResponse
      );
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(503);
      expect((response as Response).headers.get('Retry-After')).toBe('5');
      expect(mocks.launch).not.toHaveBeenCalled();
    } finally {
      if (platform) Object.defineProperty(process, 'platform', platform);
    }
  });

  it('closes an active browser at the deadline before starting the next render', async () => {
    vi.useFakeTimers();
    const started = Promise.withResolvers<void>();
    const held = Promise.withResolvers<Uint8Array>();
    mocks.pdf.mockImplementationOnce(() => {
      started.resolve();
      return held.promise;
    });
    mocks.close.mockImplementationOnce(async () =>
      held.reject(new Error('Browser closed'))
    );
    const active = renderHtmlToPdf('<html>active</html>', Date.now() + 50);
    const rejected = expect(active).rejects.toThrow('deadline');
    try {
      await started.promise;
      const next = renderHtmlToPdf('<html>next</html>');
      await vi.advanceTimersByTimeAsync(50);
      await rejected;
      expect(mocks.close).toHaveBeenCalled();
      held.resolve(new Uint8Array([1, 2]));
      await next;
      expect(mocks.close.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.launch.mock.invocationCallOrder[1]
      );
    } finally {
      held.resolve(new Uint8Array([1, 2]));
      vi.useRealTimers();
    }
  });

  it('closes a failed browser and permits a subsequent export', async () => {
    mocks.pdf.mockRejectedValueOnce(new Error('Render failed'));
    await expect(renderHtmlToPdf('<html>bad</html>')).rejects.toThrow(
      'Render failed'
    );
    expect(mocks.close).toHaveBeenCalledOnce();
    await expect(renderHtmlToPdf('<html>next</html>')).resolves.toEqual(
      new Uint8Array([1, 2])
    );
  });
});
