import { createHash, randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { logger } from '@/lib/logger';
import { getRedis } from '@/lib/redis';
import { crossRemCatalogConfig } from './catalog-bindings';

const configFingerprint = createHash('sha256')
  .update(JSON.stringify(crossRemCatalogConfig))
  .digest('hex');
const snapshotTtlSeconds = 60 * 60;
const leaseTtlSeconds = 30;
const waitIntervalsMs = [100, 250, 500, 1000, 1500, 1650];
const maxBodyBytes = 8 * 1024 * 1024;
const maxCompressedBytes = 1024 * 1024;
const etagPattern = /^"[a-f0-9]{64}"$/;

const publishUnderLease = `
  if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
  if ARGV[3] == '' then
    redis.call('DEL', KEYS[3])
  else
    redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[4])
  end
  redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[4])
  redis.call('DEL', KEYS[1])
  return 1
`;
const releaseLease = `
  if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
  return redis.call('DEL', KEYS[1])
`;

export type Snapshot = { etag: string; body: string | null };

export function bodyEtag(body: string) {
  return `"${createHash('sha256').update(body).digest('hex')}"`;
}

export function matchesValidator(value: string | null, etag: string) {
  return (
    value?.trim() === '*' ||
    (value
      ?.split(',')
      .some((candidate) => candidate.trim().replace(/^W\//, '') === etag) ??
      false)
  );
}

export function createSnapshotCache() {
  const deploymentId =
    process.env.VERCEL_DEPLOYMENT_ID?.trim() ||
    process.env.CROSSREM_CATALOG_CACHE_DEPLOYMENT_ID?.trim();
  if (!deploymentId) return null;
  const client = getRedis();
  if (!client) return null;
  const redis = client;

  const scope = createHash('sha256')
    .update(configFingerprint)
    .update(deploymentId)
    .digest('hex');
  const key = `crossrem:snapshot:v2:{${scope}}`;
  const leaseKey = `${key}:lease`;
  const metadataKey = `${key}:etag`;
  const bodyKey = `${key}:body`;

  async function read(
    version: string,
    validator: string | null
  ): Promise<Snapshot | null> {
    try {
      const metadata = await redis.get<{ version: string; etag: string }>(
        metadataKey
      );
      if (
        metadata?.version !== version ||
        typeof metadata.etag !== 'string' ||
        !etagPattern.test(metadata.etag)
      )
        return null;

      const { etag } = metadata;
      if (matchesValidator(validator, etag)) return { etag, body: null };
      const packed = await redis.get<string>(bodyKey);
      if (
        typeof packed !== 'string' ||
        packed.length > Math.ceil(maxCompressedBytes / 3) * 4
      )
        return null;

      const body = gunzipSync(Buffer.from(packed, 'base64'), {
        maxOutputLength: maxBodyBytes,
      }).toString('utf8');
      return bodyEtag(body) === etag ? { etag, body } : null;
    } catch {
      logger.warn({ message: 'CrossRem snapshot cache read failed' });
      return null;
    }
  }

  return {
    read,
    async wait(version: string, validator: string | null) {
      for (const interval of waitIntervalsMs) {
        await setTimeout(interval);
        const result = await read(version, validator);
        if (result) return result;
      }
      return null;
    },
    async acquire() {
      const token = randomUUID();
      try {
        return (await redis.set(leaseKey, token, {
          nx: true,
          ex: leaseTtlSeconds,
        }))
          ? { status: 'acquired' as const, token }
          : { status: 'busy' as const };
      } catch {
        logger.warn({ message: 'CrossRem snapshot cache lease unavailable' });
        return { status: 'unavailable' as const };
      }
    },
    async publish(token: string, version: string, etag: string, body: string) {
      try {
        const bytes = Buffer.byteLength(body);
        const packed = bytes <= maxBodyBytes ? gzipSync(body) : null;
        const cacheBody = packed && packed.byteLength <= maxCompressedBytes;
        if (!cacheBody) {
          logger.warn({
            message: 'CrossRem snapshot body exceeds cache budget',
            bytes,
          });
        }
        return (
          (await redis.eval(
            publishUnderLease,
            [leaseKey, metadataKey, bodyKey],
            [
              token,
              JSON.stringify({ version, etag }),
              cacheBody ? packed.toString('base64') : '',
              snapshotTtlSeconds,
            ]
          )) === 1
        );
      } catch {
        logger.warn({ message: 'CrossRem snapshot cache write failed' });
        return false;
      }
    },
    async release(token: string) {
      try {
        await redis.eval(releaseLease, [leaseKey], [token]);
      } catch {
        logger.warn({
          message: 'CrossRem snapshot cache lease release failed',
        });
      }
    },
  };
}
