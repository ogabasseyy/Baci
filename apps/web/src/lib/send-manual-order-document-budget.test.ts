// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendEmail = vi.hoisted(() => vi.fn());
vi.mock('@/lib/receipt-html-to-pdf', () => ({
  renderHtmlToPdf: vi.fn(async (html: string) =>
    new TextEncoder().encode(`%PDF-TEST\n${html}`)
  ),
}));
vi.mock('@/env', () => ({ getRootDomain: () => 'usebaci.com' }));
vi.mock('@/lib/zeptomail', () => ({ sendEmail }));
vi.mock('@/lib/receipt-pdf-generator', async (importOriginal) => {
  const original: typeof import('@/lib/receipt-pdf-generator') =
    await importOriginal();
  return {
    ...original,
    resolveReceiptLogoDataUri: vi.fn().mockResolvedValue(null),
  };
});

import { database, row } from './manual-order-document.test-utils';
import { renderHtmlToPdf } from './receipt-html-to-pdf';
import { sendManualOrderDocument } from './send-manual-order-document';
import {
  ZEPTOMAIL_SEND_CUTOFF_BUFFER_MS,
  zeptomailSendAdmissionBudgetMs,
} from './zeptomail-send-budget';

describe('manual document email budget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendEmail.mockImplementation(async (message) => {
      await message.beforeTransportDispatch?.();
      return { success: true, messageId: 'message-1' };
    });
  });

  it('defers a late manual document before rendering or claiming a token', async () => {
    const db = database();
    const request = {
      supabase: db.client,
      row,
      invocationDeadline: Date.now() + 15_000,
    };
    await expect(sendManualOrderDocument(request)).resolves.toEqual({
      status: 'deferred',
    });
    expect(renderHtmlToPdf).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(
      db.rpc.mock.calls.some(
        ([fn]) => fn === 'create_manual_order_document_claim'
      )
    ).toBe(false);
  });

  it('defers an invoice when rendering consumes the remaining send budget', async () => {
    const db = database();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.mocked(renderHtmlToPdf).mockImplementationOnce(async () => {
      clock.mockReturnValue(now + 13_000);
      return new TextEncoder().encode('%PDF-TEST');
    });
    try {
      await expect(
        sendManualOrderDocument({
          supabase: db.client,
          row,
          invocationDeadline: now + 60_000,
        })
      ).resolves.toEqual({ status: 'deferred' });
      expect(renderHtmlToPdf).toHaveBeenCalledOnce();
      expect(sendEmail).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });

  it('defers when email preparation reaches the dispatch hook too late', async () => {
    const db = database();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    sendEmail.mockImplementationOnce(async (message) => {
      clock.mockReturnValue(now + 13_000);
      try {
        await message.beforeTransportDispatch();
      } catch {
        return { success: false, error: 'dispatch hook rejected' };
      }
      throw new Error('Expected dispatch admission to fail');
    });
    try {
      await expect(
        sendManualOrderDocument({
          supabase: db.client,
          row,
          invocationDeadline: now + 60_000,
        })
      ).resolves.toEqual({ status: 'deferred' });
      expect(
        db.rpc.mock.calls.some(
          ([fn]) => fn === 'mark_manual_document_dispatch_started_v2'
        )
      ).toBe(false);
    } finally {
      clock.mockRestore();
    }
  });

  it('keeps the attempt charged after the primary transport was started', async () => {
    const db = database();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    sendEmail.mockImplementationOnce(async (message) => {
      await message.beforeTransportDispatch();
      await message.resetTransportDispatch();
      clock.mockReturnValue(now + 13_000);
      try {
        await message.beforeTransportDispatch();
      } catch {
        return {
          success: false,
          error: 'provider rejected the primary sender',
        };
      }
      throw new Error('Expected fallback admission to fail');
    });
    try {
      await expect(
        sendManualOrderDocument({
          supabase: db.client,
          row,
          invocationDeadline: now + 60_000,
        })
      ).resolves.toMatchObject({ status: 'failed' });
      expect(
        db.rpc.mock.calls.filter(
          ([fn]) => fn === 'mark_manual_document_dispatch_started_v2'
        )
      ).toHaveLength(1);
    } finally {
      clock.mockRestore();
    }
  });

  it('uses one invocation deadline for rendering and email transport', async () => {
    const db = database();
    const invocationDeadline = Date.now() + 60_000;
    await sendManualOrderDocument({
      supabase: db.client,
      row,
      invocationDeadline,
    });
    expect(renderHtmlToPdf).toHaveBeenCalledWith(
      expect.any(String),
      invocationDeadline - zeptomailSendAdmissionBudgetMs(1)
    );
    expect(sendEmail.mock.calls[0][0].fallbackDeadlineMs).toBe(
      invocationDeadline - ZEPTOMAIL_SEND_CUTOFF_BUFFER_MS
    );
    expect(sendEmail.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });
});
