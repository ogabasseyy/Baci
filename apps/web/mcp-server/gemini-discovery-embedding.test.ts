import { describe, expect, it, vi } from 'vitest';
import { embedDiscoveryText } from './gemini-discovery-embedding';

describe('Gemini discovery embeddings', () => {
  it('requests a 768-dimensional search embedding with the documented query prefix', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      embedding: { values: Array(768).fill(0.1) },
    }), { status: 200 })) as unknown as typeof fetch;
    const embedding = await embedDiscoveryText({
      apiKey: 'test-key', fetchImpl, kind: 'query', text: 'gaming laptop',
    });
    expect(embedding).toHaveLength(768);
    const [url, options] = vi.mocked(fetchImpl).mock.calls[0];
    expect(url).toContain('/models/gemini-embedding-2:embedContent');
    expect(JSON.parse(String(options?.body))).toMatchObject({
      content: { parts: [{ text: 'task: search result | query: gaming laptop' }] },
      output_dimensionality: 768,
    });
  });

  it('uses a document title and rejects malformed provider vectors', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      embedding: { values: [1, 2] },
    }), { status: 200 })) as unknown as typeof fetch;
    await expect(embedDiscoveryText({
      apiKey: 'test-key', fetchImpl, kind: 'document', title: 'Redmi 15', text: 'Smartphone',
    })).rejects.toThrow('invalid vector');
    expect(JSON.parse(String(vi.mocked(fetchImpl).mock.calls[0][1]?.body))).toMatchObject({
      content: { parts: [{ text: 'title: Redmi 15 | text: Smartphone' }] },
    });
  });
});
