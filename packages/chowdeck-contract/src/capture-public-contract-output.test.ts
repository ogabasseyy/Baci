import { mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sourceManifest from '../config/public-document-sources.json';
import { capturePublicContract } from './capture-public-contract';

const TOOL_DIGEST = `sha256:${'a'.repeat(64)}`;

function response(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/markdown' },
  });
}

async function missing(path: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch {
    return true;
  }
}

describe('public contract capture output', () => {
  it('atomically writes only the validated canonical receipt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chowdeck-contract-'));
    const outputPath = join(directory, 'receipt.json');
    const result = await capturePublicContract({
      sources: sourceManifest,
      capturedAt: '2026-09-05T12:00:00.000Z',
      captureToolDigest: TOOL_DIGEST,
      outputPath,
      fetchImpl: async () => response('# Synthetic public documentation'),
    });

    expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual(result);
    expect(await readdir(directory)).toEqual(['receipt.json']);
  });

  it('writes zero output when fenced OpenAPI exceeds parsed-node limits', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chowdeck-contract-'));
    const outputPath = join(directory, 'receipt.json');
    const discarded = new Array(20_001).fill('null').join(',');
    const oversized = `\`\`\`json
{"openapi":"3.1.0","paths":{"/merchant/{merchantReference}/menucategory":{"post":{"discarded":[${discarded}],"requestBody":{"content":{"application/json":{"schema":{"properties":{"name":{"type":"string"},"reference":{"type":"string"}},"required":["name","reference"],"type":"object"}}}}}}}}
\`\`\``;

    await expect(
      capturePublicContract({
        sources: sourceManifest,
        capturedAt: '2026-09-05T12:00:00.000Z',
        captureToolDigest: TOOL_DIGEST,
        outputPath,
        fetchImpl: async (input) =>
          response(
            input.endsWith('/create-menu-category.md')
              ? oversized
              : '# Synthetic public documentation'
          ),
      })
    ).rejects.toThrow('Public contract capture failed');

    expect(await missing(outputPath)).toBe(true);
  });
});
