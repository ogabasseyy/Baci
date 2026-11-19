import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { logger } from '@/lib/logger';
import { getRedis } from '@/lib/redis';
import { crossRemCatalogConfig } from './catalog-bindings';
import { loadCrossRemCatalog } from './catalog-service';
import { readCrossRemCatalogVersion } from './catalog-version';

const snapshotScope = createHash('sha256')
  .update(JSON.stringify(crossRemCatalogConfig))
  .update(process.env.VERCEL_DEPLOYMENT_ID ?? randomUUID())
  .digest('hex');
const snapshotTtlSeconds = 60 * 60;
const maxBodyBytes = 8 * 1024 * 1024;
const maxCompressedBytes = 1024 * 1024;
const etagPattern = /^"[a-f0-9]{64}"$/;

function bodyEtag(body: string) {
  return `"${createHash('sha256').update(body).digest('hex')}"`;
}

function matchesValidator(value: string | null, etag: string) {
  return (
    value?.trim() === '*' ||
    (value
      ?.split(',')
      .some((candidate) => candidate.trim().replace(/^W\//, '') === etag) ??
      false)
  );
}

async function readSnapshotCache(
  redis: NonNullable<ReturnType<typeof getRedis>>,
  key: string,
  version: string,
  validator: string | null
) {
  try {
    const metadata = await redis.get<{ version: string; etag: string }>(
      `${key}:etag`
    );
    if (
      metadata?.version !== version ||
      typeof metadata.etag !== 'string' ||
      !etagPattern.test(metadata.etag)
    ) {
      return null;
    }
    const { etag } = metadata;
    if (matchesValidator(validator, etag)) return { etag, body: null };

    const packed = await redis.get<string>(`${key}:body`);
    if (typeof packed !== 'string' || packed.length > maxCompressedBytes * 2) {
      return null;
    }
    const body = gunzipSync(Buffer.from(packed, 'base64'), {
      maxOutputLength: maxBodyBytes,
    }).toString('utf8');
    return bodyEtag(body) === etag ? { etag, body } : null;
  } catch {
    logger.warn({ message: 'CrossRem snapshot cache read failed' });
    return null;
  }
}

async function storeSnapshot(
  redis: NonNullable<ReturnType<typeof getRedis>>,
  key: string,
  version: string,
  etag: string,
  body: string
) {
  try {
    if (Buffer.byteLength(body) <= maxBodyBytes) {
      const packed = gzipSync(body);
      if (packed.byteLength <= maxCompressedBytes) {
        await redis.set(`${key}:body`, packed.toString('base64'), {
          ex: snapshotTtlSeconds,
        });
      }
    }
    await redis.set(
      `${key}:etag`,
      { version, etag },
      {
        ex: snapshotTtlSeconds,
      }
    );
  } catch {
    logger.warn({ message: 'CrossRem snapshot cache write failed' });
  }
}

export async function getVersionedCrossRemCatalog(validator: string | null) {
  const version = await readCrossRemCatalogVersion();
  const redis = getRedis();
  // New bindings or a new deployment must validate independently of an old
  // representation, even when the database catalog has not changed.
  // Keep a bounded cache per deployment. An old writer may replace the cache
  // during a race, but its version will never match the newer database row.
  const key = `crossrem:snapshot:v1:${snapshotScope}`;
  const cached =
    redis && (await readSnapshotCache(redis, key, version, validator));
  if (cached) return cached;

  const body = JSON.stringify(await loadCrossRemCatalog());
  if ((await readCrossRemCatalogVersion()) !== version) {
    throw new Error('CrossRem catalog changed during snapshot validation');
  }

  const etag = bodyEtag(body);
  if (redis) await storeSnapshot(redis, key, version, etag, body);
  return { etag, body: matchesValidator(validator, etag) ? null : body };
}
