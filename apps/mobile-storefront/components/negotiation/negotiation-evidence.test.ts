import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  extractNegotiationFileExtension,
  isRemoteEvidenceUrl,
  MAX_NEGOTIATION_EVIDENCE_BYTES,
  uploadNegotiationEvidence,
} from './negotiation-evidence';

jest.mock('@/env', () => ({
  EXPO_PUBLIC_API_URL: 'https://usebaci.com',
}));

type UploadToSignedUrlResult = {
  data: { path: string } | null;
  error: { message: string } | null;
};

const mockUploadToSignedUrl = jest.fn() as jest.Mock<
  (...args: unknown[]) => Promise<UploadToSignedUrlResult>
>;

jest.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        uploadToSignedUrl: mockUploadToSignedUrl,
      }),
    },
  },
}));

const createFileResponse = ({
  bytes = new Uint8Array([1, 2, 3]),
  contentLength = bytes.byteLength,
  contentType = 'image/png',
  ok = true,
  status = 200,
}: {
  bytes?: Uint8Array;
  contentLength?: number | null;
  contentType?: string;
  ok?: boolean;
  status?: number;
} = {}) => {
  const arrayBuffer = jest.fn(async () =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  );
  return {
    arrayBuffer,
    headers: {
      get: jest.fn((name: string) => {
        const normalizedName = name.toLowerCase();
        if (normalizedName === 'content-type') {
          return contentType;
        }
        if (normalizedName === 'content-length' && contentLength !== null) {
          return String(contentLength);
        }
        return null;
      }),
    },
    ok,
    status,
  };
};

const createApiResponse = ({
  body = {
    evidencePath: 'merchant-1/server-proof.png',
    uploadToken: 'upload-token',
  },
  ok = true,
}: {
  body?: unknown;
  ok?: boolean;
} = {}) => ({
  json: async () => body,
  ok,
});

describe('negotiation evidence helpers', () => {
  it('detects remote evidence URLs', () => {
    expect(isRemoteEvidenceUrl('https://example.com/proof.png')).toBe(true);
    expect(isRemoteEvidenceUrl('http://example.com/proof.png')).toBe(true);
    expect(isRemoteEvidenceUrl('file:///tmp/proof.png')).toBe(false);
  });

  it('prefers content-type extension and falls back to URI extension', () => {
    expect(
      extractNegotiationFileExtension('file:///tmp/proof', 'image/png')
    ).toBe('png');
    expect(
      extractNegotiationFileExtension(
        'file:///tmp/proof.jpeg?token=abc',
        'application/octet-stream'
      )
    ).toBe('jpeg');
    expect(
      extractNegotiationFileExtension(
        'file:///tmp/proof',
        'application/octet-stream'
      )
    ).toBe('jpg');
  });
});

describe('uploadNegotiationEvidence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUploadToSignedUrl.mockResolvedValue({
      data: { path: 'merchant-1/server-proof.png' },
      error: null,
    });
    globalThis.fetch = jest.fn((input: RequestInfo | URL) => {
      if (String(input).startsWith('file://')) {
        return createFileResponse();
      }

      return createApiResponse();
    }) as unknown as typeof fetch;
  });

  it('returns remote URLs unchanged without uploading', async () => {
    await expect(
      uploadNegotiationEvidence('https://example.com/proof.png', null)
    ).resolves.toBe('https://example.com/proof.png');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws when a local file is provided without a merchant id', async () => {
    await expect(
      uploadNegotiationEvidence('file:///tmp/proof.png', null)
    ).rejects.toThrow('Missing merchant id');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('uploads local image evidence through the evidence API and returns the durable storage path', async () => {
    await expect(
      uploadNegotiationEvidence('file:///tmp/proof.png', 'merchant-1')
    ).resolves.toBe('merchant-1/server-proof.png');

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'file:///tmp/proof.png',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://usebaci.com/api/storefront/negotiation-evidence',
      expect.objectContaining({
        body: JSON.stringify({
          contentType: 'image/png',
          fileName: 'negotiation-evidence.png',
          fileSize: 3,
          merchantId: 'merchant-1',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
    );
    expect(mockUploadToSignedUrl).toHaveBeenCalledWith(
      'merchant-1/server-proof.png',
      'upload-token',
      expect.any(ArrayBuffer),
      { contentType: 'image/png', upsert: false }
    );
  });

  it('infers image content type from the local file extension when blob type is empty', async () => {
    globalThis.fetch = jest.fn((input: RequestInfo | URL) => {
      if (String(input).startsWith('file://')) {
        return createFileResponse({ contentType: '' });
      }

      return createApiResponse({
        body: {
          evidencePath: 'merchant-1/server-proof.webp',
          uploadToken: 'upload-token',
        },
      });
    }) as unknown as typeof fetch;

    await uploadNegotiationEvidence('file:///tmp/proof.webp', 'merchant-1');

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://usebaci.com/api/storefront/negotiation-evidence',
      expect.objectContaining({
        body: JSON.stringify({
          contentType: 'image/webp',
          fileName: 'negotiation-evidence.webp',
          fileSize: 3,
          merchantId: 'merchant-1',
        }),
        method: 'POST',
      })
    );
  });

  it('infers image content type from the local file extension when the response is octet-stream', async () => {
    globalThis.fetch = jest.fn((input: RequestInfo | URL) => {
      if (String(input).startsWith('file://')) {
        return createFileResponse({ contentType: 'application/octet-stream' });
      }

      return createApiResponse();
    }) as unknown as typeof fetch;

    await uploadNegotiationEvidence('file:///tmp/proof.heic', 'merchant-1');

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://usebaci.com/api/storefront/negotiation-evidence',
      expect.objectContaining({
        body: JSON.stringify({
          contentType: 'image/heic',
          fileName: 'negotiation-evidence.heic',
          fileSize: 3,
          merchantId: 'merchant-1',
        }),
        method: 'POST',
      })
    );
  });

  it('throws when the local file cannot be read', async () => {
    globalThis.fetch = jest.fn(() =>
      createFileResponse({ ok: false, status: 404 })
    ) as unknown as typeof fetch;

    await expect(
      uploadNegotiationEvidence('file:///tmp/missing.png', 'merchant-1')
    ).rejects.toThrow('Failed to read evidence file: 404');

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects non-image evidence before reading bytes', async () => {
    const fileResponse = createFileResponse({ contentType: 'application/pdf' });
    globalThis.fetch = jest.fn(() => ({
      ...fileResponse,
    })) as unknown as typeof fetch;

    await expect(
      uploadNegotiationEvidence('file:///tmp/proof.pdf', 'merchant-1')
    ).rejects.toThrow('Only image evidence is supported');

    expect(fileResponse.arrayBuffer).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized evidence before initializing upload', async () => {
    const fileResponse = createFileResponse({
      contentLength: MAX_NEGOTIATION_EVIDENCE_BYTES + 1,
    });
    globalThis.fetch = jest.fn(() => ({
      ...fileResponse,
    })) as unknown as typeof fetch;

    await expect(
      uploadNegotiationEvidence('file:///tmp/huge.png', 'merchant-1')
    ).rejects.toThrow('Evidence image is too large');

    expect(fileResponse.arrayBuffer).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized evidence after reading bytes when content-length is missing', async () => {
    const fileResponse = createFileResponse({
      bytes: new Uint8Array(MAX_NEGOTIATION_EVIDENCE_BYTES + 1),
      contentLength: null,
    });
    globalThis.fetch = jest.fn(() => ({
      ...fileResponse,
    })) as unknown as typeof fetch;

    await expect(
      uploadNegotiationEvidence('file:///tmp/huge.png', 'merchant-1')
    ).rejects.toThrow('Evidence image is too large');

    expect(fileResponse.arrayBuffer).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('times out stalled evidence fetches', async () => {
    jest.useFakeTimers();
    globalThis.fetch = jest.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      }
    ) as unknown as typeof fetch;

    const uploadPromise = uploadNegotiationEvidence(
      'file:///tmp/proof.png',
      'merchant-1'
    );
    const expectation = expect(uploadPromise).rejects.toThrow(
      'Evidence upload took too long. Please try again.'
    );

    try {
      jest.advanceTimersByTime(30_000);
      await expectation;
      expect(mockUploadToSignedUrl).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('throws when evidence API upload fails', async () => {
    globalThis.fetch = jest.fn((input: RequestInfo | URL) => {
      if (String(input).startsWith('file://')) {
        return createFileResponse();
      }

      return createApiResponse({
        body: { error: 'upload failed' },
        ok: false,
      });
    }) as unknown as typeof fetch;
    await expect(
      uploadNegotiationEvidence('file:///tmp/proof.png', 'merchant-1')
    ).rejects.toThrow('upload failed');
    expect(mockUploadToSignedUrl).not.toHaveBeenCalled();
  });

  it('throws when signed storage upload fails', async () => {
    mockUploadToSignedUrl.mockResolvedValueOnce({
      data: null,
      error: { message: 'signed upload failed' },
    });

    await expect(
      uploadNegotiationEvidence('file:///tmp/proof.png', 'merchant-1')
    ).rejects.toThrow('signed upload failed');
  });
});
