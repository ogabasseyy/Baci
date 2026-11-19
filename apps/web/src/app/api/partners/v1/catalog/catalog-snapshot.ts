import { loadCrossRemCatalog } from './catalog-service';
import {
  bodyEtag,
  createSnapshotCache,
  matchesValidator,
  uncachedBody,
} from './catalog-snapshot-cache';
import { readCrossRemCatalogVersion } from './catalog-version';

async function assertCurrentVersion(version: string) {
  if ((await readCrossRemCatalogVersion()) !== version) {
    throw new Error('CrossRem catalog changed during snapshot validation');
  }
}

async function buildSnapshot(version: string) {
  const body = JSON.stringify(await loadCrossRemCatalog());
  await assertCurrentVersion(version);
  return { etag: bodyEtag(body), body };
}

const localBuilds = new Map<string, ReturnType<typeof buildSnapshot>>();

async function buildWithoutRedis(version: string) {
  const existing = localBuilds.get(version);
  if (existing) {
    const snapshot = await existing;
    await assertCurrentVersion(version);
    return snapshot;
  }
  const pending = buildSnapshot(version);
  localBuilds.set(version, pending);
  try {
    return await pending;
  } finally {
    localBuilds.delete(version);
  }
}

export async function getVersionedCrossRemCatalog(validator: string | null) {
  const version = await readCrossRemCatalogVersion();
  const cache = createSnapshotCache();
  const cached = await cache?.read(version, validator);
  if (cached && cached !== uncachedBody) {
    await assertCurrentVersion(version);
    return cached;
  }

  const lease = await cache?.acquire();
  if (!cache || !lease || lease.status === 'unavailable') {
    const { etag, body } = await buildWithoutRedis(version);
    return { etag, body: matchesValidator(validator, etag) ? null : body };
  }

  if (lease.status === 'busy') {
    const published = await cache.wait(version, validator);
    if (!published || published === uncachedBody) {
      throw new Error(
        'CrossRem full snapshot unavailable from concurrent rebuild'
      );
    }
    await assertCurrentVersion(version);
    return published;
  }

  let published = false;
  try {
    // The previous owner may have finished between our first read and lock.
    const ready = await cache.read(version, validator);
    if (ready && ready !== uncachedBody) {
      await assertCurrentVersion(version);
      return ready;
    }
    const { etag, body } = await buildSnapshot(version);
    published = await cache.publish(lease.token, version, etag, body);
    await assertCurrentVersion(version);
    return { etag, body: matchesValidator(validator, etag) ? null : body };
  } finally {
    if (!published) await cache.release(lease.token);
  }
}
