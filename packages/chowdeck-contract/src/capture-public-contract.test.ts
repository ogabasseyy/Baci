import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sourceManifest from '../config/public-document-sources.json';
import {
  CAPTURE_LIMITS,
  capturePublicContract,
} from './capture-public-contract';

it('keeps capture safety limits bounded', () => {
  expect(CAPTURE_LIMITS).toEqual({
    aggregateBytes: 5_242_880,
    documentBytes: 1_048_576,
    maxDepth: 32,
    parsedNodes: 20_000,
    parsedTextBytes: 524_288,
    timeoutMilliseconds: 10_000,
  });
});

const OFFICIAL_URLS = [
  'https://chowdeck-api.readme.io/docs/getting-started.md',
  'https://chowdeck-api.readme.io/reference/authentication-1.md',
  'https://chowdeck-api.readme.io/reference/get-merchant-profile.md',
  'https://chowdeck-api.readme.io/docs/managing-your-menu.md',
  'https://chowdeck-api.readme.io/reference/create-menu-category.md',
  'https://chowdeck-api.readme.io/reference/list-menu-categories.md',
  'https://chowdeck-api.readme.io/reference/create-menu-item.md',
  'https://chowdeck-api.readme.io/reference/list-menu-items.md',
  'https://chowdeck-api.readme.io/reference/get-menu-item.md',
] as const;
const POSTMAN_URL =
  'https://documenter.getpostman.com/view/19177886/2s8Ysrytto';
const TOOL_DIGEST = `sha256:${'a'.repeat(64)}`;

function response(body: string, contentType = 'text/markdown'): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-length': String(Buffer.byteLength(body)),
      'content-type': contentType,
    },
  });
}

function safeBody(url: string): string {
  if (url.endsWith('/authentication-1.md')) {
    return `# Authentication

Authorization scheme: Bearer.

Discarded bait: Authorization: Bearer not-retained, person@example.com,
http://127.0.0.1/private, headers, body, token, password.
`;
  }
  return `# Public documentation\n\nNo recognized safe claim for ${new URL(url).pathname}.`;
}

async function missing(path: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch {
    return true;
  }
}

describe('bounded public contract capture', () => {
  it('orders receipt claims independently of the host locale', async () => {
    const locale = vi
      .spyOn(String.prototype, 'localeCompare')
      .mockReturnValue(-1);
    try {
      const receipt = await capturePublicContract({
        sources: sourceManifest,
        capturedAt: '2026-09-05T12:00:00.000Z',
        captureToolDigest: TOOL_DIGEST,
        fetchImpl: async (url: string) => response(safeBody(url)),
      });
      expect(receipt.claims.map((claim) => claim.sourceUrl)).toEqual(
        [...OFFICIAL_URLS].sort()
      );
    } finally {
      locale.mockRestore();
    }
  });
  it('discards unsafe source text and produces deterministic sorted safe metadata', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchImpl = async (input: string, init?: RequestInit) => {
      calls.push({ input, init });
      return response(safeBody(input));
    };

    const first = await capturePublicContract({
      sources: sourceManifest,
      capturedAt: '2026-09-05T12:00:00.000Z',
      captureToolDigest: TOOL_DIGEST,
      fetchImpl,
    });
    const second = await capturePublicContract({
      sources: sourceManifest,
      capturedAt: '2026-09-06T12:00:00.000Z',
      captureToolDigest: TOOL_DIGEST,
      fetchImpl,
    });
    const serialized = JSON.stringify(first);

    expect(calls).toHaveLength(OFFICIAL_URLS.length * 2);
    expect(calls.some(({ input }) => input === POSTMAN_URL)).toBe(false);
    expect(calls.every(({ init }) => init?.redirect === 'manual')).toBe(true);
    expect(
      calls.every(
        ({ init }) =>
          new Headers(init?.headers).get('accept-encoding') === 'identity'
      )
    ).toBe(true);
    expect(first.claims.map(({ sourceUrl }) => sourceUrl)).toEqual(
      [...OFFICIAL_URLS].sort()
    );
    expect(
      first.claims.find(({ capability }) => capability === 'authentication')
        ?.status
    ).toBe('documented');
    expect(
      first.claims.find(({ capability }) => capability === 'authentication')
    ).toMatchObject({
      authScheme: 'bearer',
      operation: { status: 'not_applicable' },
      responseFields: [],
      status: 'documented',
    });
    expect(first.sanitizedProjectionDigest).toBe(
      second.sanitizedProjectionDigest
    );
    expect(first.digest).not.toBe(second.digest);
    expect(serialized).not.toMatch(
      /not-retained|person@example|127\.0\.0\.1|authorization|password|rawSourceDigest/i
    );
    expect(calls.every(({ init }) => init?.signal instanceof AbortSignal)).toBe(
      true
    );
  });

  it.each([
    ['redirect', () => new Response(null, { status: 302 })],
    [
      'encoded response',
      () =>
        new Response('encoded', {
          headers: {
            'content-encoding': 'gzip',
            'content-type': 'text/markdown',
          },
        }),
    ],
    ['wrong media type', () => response('html', 'text/html')],
    [
      'oversized document',
      () => response('x'.repeat(CAPTURE_LIMITS.documentBytes + 1)),
    ],
  ])('fails closed without output for a %s', async (_label, makeResponse) => {
    const directory = await mkdtemp(join(tmpdir(), 'chowdeck-contract-'));
    const outputPath = join(directory, 'receipt.json');

    await expect(
      capturePublicContract({
        sources: sourceManifest,
        capturedAt: '2026-09-05T12:00:00.000Z',
        captureToolDigest: TOOL_DIGEST,
        outputPath,
        fetchImpl: async () => makeResponse(),
      })
    ).rejects.toThrow('Public contract capture failed');
    expect(await missing(outputPath)).toBe(true);
  });

  it.each([
    [
      'streamed bytes',
      () =>
        new Response('x'.repeat(CAPTURE_LIMITS.documentBytes + 1), {
          headers: { 'content-type': 'text/markdown' },
        }),
    ],
    [
      'parsed Markdown text',
      () => response('x'.repeat(CAPTURE_LIMITS.parsedTextBytes + 1)),
    ],
    [
      'parsed JSON nodes',
      () =>
        response(
          JSON.stringify(
            Array.from({ length: CAPTURE_LIMITS.parsedNodes + 1 }, () => null)
          ),
          'application/json'
        ),
    ],
    [
      'parsed JSON depth',
      () =>
        response(
          `${'['.repeat(CAPTURE_LIMITS.maxDepth + 1)}0${']'.repeat(CAPTURE_LIMITS.maxDepth + 1)}`,
          'application/json'
        ),
    ],
  ])('enforces the %s ceiling', async (_label, makeResponse) => {
    await expect(
      capturePublicContract({
        sources: sourceManifest,
        capturedAt: '2026-09-05T12:00:00.000Z',
        captureToolDigest: TOOL_DIGEST,
        fetchImpl: async () => makeResponse(),
      })
    ).rejects.toThrow('Public contract capture failed');
  });

  it('enforces the aggregate transfer ceiling across bounded documents', async () => {
    const body = `${' '.repeat(600_000)}null`;

    await expect(
      capturePublicContract({
        sources: sourceManifest,
        capturedAt: '2026-09-05T12:00:00.000Z',
        captureToolDigest: TOOL_DIGEST,
        fetchImpl: async () => response(body, 'application/json'),
      })
    ).rejects.toThrow('Public contract capture failed');
  });

  it('keeps an OpenAPI claim unproven when the request shape has an unreviewed field', async () => {
    const tainted = `\`\`\`json
{"openapi":"3.1.0","paths":{"/merchant/{merchantReference}/menucategory":{"post":{"requestBody":{"content":{"application/json":{"schema":{"properties":{"email":{"type":"string"},"name":{"type":"string"},"reference":{"type":"string"}},"required":["email","name","reference"],"type":"object"}}}}}}}}
\`\`\``;

    const result = await capturePublicContract({
      sources: sourceManifest,
      capturedAt: '2026-09-05T12:00:00.000Z',
      captureToolDigest: TOOL_DIGEST,
      fetchImpl: async (input) =>
        response(
          input.endsWith('/create-menu-category.md') ? tainted : safeBody(input)
        ),
    });

    expect(
      result.claims.find(
        ({ capability }) => capability === 'menu.category.create'
      )
    ).toMatchObject({ status: 'unproven', requestFields: [] });
    expect(JSON.stringify(result)).not.toContain('email');
  });

  it('accepts bounded JSON while enforcing parsed node and depth ceilings', async () => {
    const json = JSON.stringify({
      openapi: '3.1.0',
      paths: {},
    });
    const result = await capturePublicContract({
      sources: sourceManifest,
      capturedAt: '2026-09-05T12:00:00.000Z',
      captureToolDigest: TOOL_DIGEST,
      fetchImpl: async (input) =>
        input.endsWith('/authentication-1.md')
          ? response(json, 'application/json')
          : response(safeBody(input)),
    });

    expect(
      result.claims.find(({ capability }) => capability === 'authentication')
    ).toMatchObject({ sourceKind: 'official_json', status: 'unproven' });
    expect(result.runMetrics.parsedNodes).toBeGreaterThan(0);
  });

  it('rejects duplicate JSON keys before selecting a safe claim', async () => {
    const duplicate = '{"openapi":"3.0.0","openapi":"3.1.0"}';

    await expect(
      capturePublicContract({
        sources: sourceManifest,
        capturedAt: '2026-09-05T12:00:00.000Z',
        captureToolDigest: TOOL_DIGEST,
        fetchImpl: async (input) =>
          response(
            input.endsWith('/authentication-1.md') ? duplicate : '{}',
            'application/json'
          ),
      })
    ).rejects.toThrow('Public contract capture failed');
  });
});
