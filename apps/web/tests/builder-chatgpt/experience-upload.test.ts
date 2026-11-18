import { experienceDataFixture } from '../experience-authoring/data-fixture.test-support';
// @vitest-environment node

import { randomUUID } from 'node:crypto';
import type { ExperienceManifest } from '@baci/shared/experience';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { digestBytes } from '@/lib/experience/manifest-digest';
import { patchSource, readSource } from '@/lib/experience/source-service';
import {
  beginUpload,
  finalizeUpload,
  writeChunk,
} from '@/lib/experience/upload-service';

it('normal-auth DataAPI uploads exact512KiB, paginates source, preserves conflicting candidates and rejects tenant/revoked grant', async () => {
  const fixture = await experienceDataFixture();
  const f = fixture.db;
  const owner = fixture.owner;
  const other = fixture.other;
  const a = fixture.actorId;
  const m = fixture.merchantId;
  const connection = fixture.connectionId;
  try {
    const content = '🌍'.repeat(131072);
    const manifest: ExperienceManifest = {
      format: 'baci.experience/v2',
      runtime: 'react-browser-sandbox/v1',
      sdkVersion: 'commerce-bridge/v1',
      entry: 'app.tsx',
      files: [{ path: 'app.tsx', content: '' }],
      packages: [],
      routes: [{ path: '/', view: 'home' }],
      assets: [],
      capabilities: [],
    };
    const u = await beginUpload(owner, {
      manifest,
      files: {
        files: [
          {
            path: 'app.tsx',
            bytes: Buffer.byteLength(content),
            digest: digestBytes(content),
          },
        ],
      },
    });
    const bytes = Buffer.from(content);
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      const chunk = bytes.subarray(offset, offset + 32768);
      await writeChunk(owner, {
        uploadId: u.uploadId,
        path: 'app.tsx',
        offset,
        bytes: chunk,
        chunkDigest: digestBytes(chunk),
      });
    }
    await expect(finalizeUpload(other, u)).rejects.toThrow('NOT_FOUND');
    const art = await finalizeUpload(owner, u);
    let offset = 0;
    let out = '';
    do {
      const page = await readSource(owner, {
        artifactId: art.artifactId,
        path: 'app.tsx',
        byteOffset: offset,
        maxBytes: 32768,
      });
      out += page.content;
      offset = page.nextCursor ?? 0;
    } while (offset);
    expect(out).toBe(content);
    await expect(
      readSource(other, {
        artifactId: art.artifactId,
        path: 'app.tsx',
        byteOffset: 0,
        maxBytes: 32768,
      })
    ).rejects.toThrow('NOT_FOUND');
    const first = await patchSource(owner, {
      baseDigest: art.sourceDigest,
      expectedVersion: 0,
      files: [{ path: 'app.tsx', content: 'first' }],
      idempotencyKey: randomUUID(),
    });
    expect(first.conflict).toBe(false);
    const stale = await patchSource(owner, {
      baseDigest: art.sourceDigest,
      expectedVersion: 0,
      files: [{ path: 'app.tsx', content: 'second' }],
      idempotencyKey: randomUUID(),
    });
    expect(stale.conflict).toBe(true);
    expect(
      (
        await readSource(owner, {
          artifactId: stale.artifactId,
          path: 'app.tsx',
          byteOffset: 0,
          maxBytes: 10,
        })
      ).content
    ).toBe('second');
    const linked = {
      ...owner,
      identity: {
        actorUserId: a,
        connectionId: connection,
        grantVersion: 1,
        scopes: new Set(['storefront.read', 'storefront.write'] as const),
        allowedMerchantIds: [m],
        allowCreateStore: false,
      },
    };
    await beginUpload(linked, {
      manifest,
      files: {
        files: [{ path: 'app.tsx', bytes: 1, digest: digestBytes('x') }],
      },
    });
    await f.providerPool.query(
      "UPDATE builder_authorization.connections SET status='revoked',revoked_at=now() WHERE id=$1",
      [connection]
    );
    await expect(
      beginUpload(linked, {
        manifest,
        files: {
          files: [{ path: 'app.tsx', bytes: 1, digest: digestBytes('x') }],
        },
      })
    ).rejects.toThrow('NOT_FOUND');
  } finally {
    await fixture.close();
  }
}, 60000);
