import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHtmlToPdf } from './receipt-html-to-pdf';

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
      const request = { url: () => url, abort: vi.fn(), continue: vi.fn() };
      handle(request);
      expect(request.abort).toHaveBeenCalledOnce();
    }
    const request = {
      url: () => 'data:image/png;base64,AQID',
      abort: vi.fn(),
      continue: vi.fn(),
    };
    handle(request);
    expect(request.continue).toHaveBeenCalledOnce();
  });
  it('serializes eight jobs, rejects a ninth, and recovers capacity', async () => {
    const held = Promise.withResolvers<Uint8Array>();
    mocks.pdf.mockReturnValueOnce(held.promise);
    const jobs = Array.from({ length: 8 }, () =>
      renderHtmlToPdf('<html>invoice</html>')
    );
    await vi.waitFor(() => expect(mocks.pdf).toHaveBeenCalledOnce());
    expect(mocks.launch).toHaveBeenCalledOnce();
    await expect(renderHtmlToPdf('<html>overflow</html>')).rejects.toThrow(
      'busy'
    );
    held.resolve(new Uint8Array([1, 2]));
    await Promise.all(jobs);
    expect(mocks.launch).toHaveBeenCalledTimes(8);
    await expect(renderHtmlToPdf('<html>recovered</html>')).resolves.toEqual(
      new Uint8Array([1, 2])
    );
  });

  it('rejects a queued render before the worker deadline and never launches it', async () => {
    const held = Promise.withResolvers<Uint8Array>();
    mocks.pdf.mockReturnValueOnce(held.promise);
    const active = renderHtmlToPdf('<html>active</html>');
    try {
      await vi.waitFor(() => expect(mocks.pdf).toHaveBeenCalledOnce());
      const expired = renderHtmlToPdf('<html>expired</html>', Date.now() + 10);
      const outcome = await Promise.race([
        expired.catch((error: Error) => error.message),
        new Promise((resolve) => setTimeout(() => resolve('still queued'), 40)),
      ]);
      expect(outcome).toMatch(/deadline/);
    } finally {
      held.resolve(new Uint8Array([1, 2]));
      await active;
    }
    await renderHtmlToPdf('<html>next</html>');
    expect(mocks.launch).toHaveBeenCalledTimes(2);
  }, 1000);

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
