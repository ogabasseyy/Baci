import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readBoundedJson } from './posthog-bounded-json.mjs';

const LABEL = 'Test response';

describe('bounded JSON responses', () => {
  it('parses a body within the byte cap', async () => {
    const payload = await readBoundedJson(new Response('{"ok":true}'), {
      label: LABEL,
      maxBytes: 100,
    });

    assert.deepEqual(payload, { ok: true });
  });

  it('aborts a chunked body past the cap without a content-length', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"data":"'));
        controller.enqueue(new TextEncoder().encode('x'.repeat(200)));
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      },
    });

    await assert.rejects(
      readBoundedJson(new Response(stream), {
        label: LABEL,
        maxBytes: 100,
      }),
      /Test response exceeded the 100-byte body cap/
    );
  });

  it('reports invalid JSON without leaking the body', async () => {
    await assert.rejects(
      readBoundedJson(new Response('<html>proxy-secret</html>'), {
        label: LABEL,
        maxBytes: 100,
      }),
      /Test response was invalid JSON/
    );
  });

  it('fails closed when no readable body exists', async () => {
    await assert.rejects(
      readBoundedJson(
        { body: null },
        { label: LABEL, maxBytes: 100 }
      ),
      /Test response had no readable response body/
    );
  });
});
