import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { verifyCompiledCandidate } from '../../src/lib/experience/compiled-candidate';
import type {
  LocalPrerenderArtifacts,
  PrerenderBinding,
} from './prerender-artifacts';

/** Owned local storage only. Every caller still resolves current authority under RLS. */
export function createDurablePrerenderArtifacts(
  directory: string,
  limits: { maxEntries?: number; maxBytes?: number } = {}
): LocalPrerenderArtifacts {
  const root = resolve(directory);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const dir = lstatSync(root);
  if (
    !dir.isDirectory() ||
    dir.isSymbolicLink() ||
    (dir.mode & 0o077) !== 0 ||
    (process.getuid && dir.uid !== process.getuid())
  )
    throw Error('BUILD_FAILED');
  const maxEntries = limits.maxEntries ?? 256;
  const maxBytes = limits.maxBytes ?? 536870912;
  if (
    !Number.isInteger(maxEntries) ||
    maxEntries < 1 ||
    maxEntries > 256 ||
    !Number.isInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 536870912
  )
    throw Error('INVALID_REQUEST');
  const read = (name: string, max: number) => {
    let fd: number | undefined;
    try {
      fd = openSync(
        join(root, name),
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.size > max ||
        (stat.mode & 0o077) !== 0 ||
        (process.getuid && stat.uid !== process.getuid())
      )
        throw Error('BUILD_FAILED');
      return readFileSync(fd);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  };
  const immutableWrite = (name: string, bytes: Buffer) => {
    const temp = join(root, `.tmp-${randomUUID()}`);
    const fd = openSync(temp, 'wx', 0o600);
    try {
      try {
        writeFileSync(fd, bytes);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      linkSync(temp, join(root, name));
      const directoryFd = openSync(root, constants.O_RDONLY);
      try {
        fsyncSync(directoryFd);
      } finally {
        closeSync(directoryFd);
      }
    } finally {
      unlinkSync(temp);
    }
  };
  if (!existsSync(join(root, 'integrity.key'))) {
    try {
      immutableWrite('integrity.key', randomBytes(32));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  const key = read('integrity.key', 32);
  if (key.length !== 32) throw Error('BUILD_FAILED');
  const identifier = (v: PrerenderBinding) =>
    `${createHash('sha256')
      .update(
        JSON.stringify([v.merchantId, v.buildId, v.buildDigest, v.sourceDigest])
      )
      .digest('hex')}.json`;
  const signature = (payload: string) =>
    createHmac('sha256', key).update(payload).digest('hex');
  const usage = () => {
    let entries = 0;
    let bytes = 0;
    for (const file of readdirSync(root)) {
      if (!/^[a-f0-9]{64}\.json$/.test(file) && !file.startsWith('.tmp-'))
        continue;
      const stat = lstatSync(join(root, file));
      if (!stat.isFile() || stat.isSymbolicLink()) throw Error('BUILD_FAILED');
      entries++;
      bytes += stat.size;
    }
    return { entries, bytes };
  };
  const load = (binding: PrerenderBinding) => {
    try {
      const record = JSON.parse(
        read(identifier(binding), 33554432).toString('utf8')
      ) as { payload?: unknown; signature?: unknown };
      if (
        typeof record.payload !== 'string' ||
        typeof record.signature !== 'string' ||
        !/^[a-f0-9]{64}$/.test(record.signature) ||
        !timingSafeEqual(
          Buffer.from(record.signature, 'hex'),
          Buffer.from(signature(record.payload), 'hex')
        )
      )
        throw Error('BUILD_FAILED');
      const value = JSON.parse(record.payload) as {
        format?: unknown;
        binding?: PrerenderBinding;
        renderer?: unknown;
      };
      if (
        value.format !== 'baci.durable-prerender/v1' ||
        !value.binding ||
        ['merchantId', 'buildId', 'buildDigest', 'sourceDigest'].some(
          (k) =>
            value.binding?.[k as keyof PrerenderBinding] !==
            binding[k as keyof PrerenderBinding]
        )
      )
        throw Error('BUILD_FAILED');
      return verifyCompiledCandidate(value.renderer);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw Error('OUTPUT_NOT_RETAINED');
      throw Error('BUILD_FAILED');
    }
  };
  return {
    read: load,
    retain(input) {
      const renderer = verifyCompiledCandidate(input.renderer);
      const binding = {
        merchantId: input.merchantId,
        buildId: input.buildId,
        buildDigest: input.buildDigest,
        sourceDigest: input.sourceDigest,
      };
      const name = identifier(binding);
      if (existsSync(join(root, name))) {
        if (JSON.stringify(load(binding)) !== JSON.stringify(renderer))
          throw Error('BUILD_FAILED');
        return;
      }
      const payload = JSON.stringify({
        format: 'baci.durable-prerender/v1',
        binding,
        renderer,
      });
      const bytes = Buffer.from(
        JSON.stringify({ payload, signature: signature(payload) })
      );
      const before = usage();
      if (
        before.entries >= maxEntries ||
        before.bytes + bytes.length > maxBytes
      )
        throw Error('QUOTA_EXCEEDED');
      try {
        immutableWrite(name, bytes);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (JSON.stringify(load(binding)) !== JSON.stringify(renderer))
          throw Error('BUILD_FAILED');
        return;
      }
      const after = usage();
      if (after.entries > maxEntries || after.bytes > maxBytes) {
        unlinkSync(join(root, name));
        throw Error('QUOTA_EXCEEDED');
      }
    },
  };
}
