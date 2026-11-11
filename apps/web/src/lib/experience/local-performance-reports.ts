import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { experiencePerformanceReport } from '@/schemas/experience-performance';
import type { PerformanceBinding } from './performance-read';

const FORMAT = 'baci.local-performance-report/v1';
const SIGNATURE_CONTEXT = 'baci.experience.performance-report\0v1\0';
const MAX_REPORT_BYTES = 524288;
const MAX_ENTRIES = 64;

export type LocalPerformanceReportBinding = PerformanceBinding;

interface StoredEnvelope {
  payload: string;
  signature: string;
}

interface StoredPayload {
  format: typeof FORMAT;
  binding: LocalPerformanceReportBinding;
  report: unknown;
}

function validateBinding(binding: LocalPerformanceReportBinding) {
  if (
    !binding ||
    typeof binding.merchantId !== 'string' ||
    binding.merchantId.length < 1 ||
    binding.merchantId.length > 128 ||
    typeof binding.buildId !== 'string' ||
    binding.buildId.length < 1 ||
    binding.buildId.length > 128 ||
    !/^[a-f0-9]{64}$/.test(binding.buildDigest) ||
    !/^[a-f0-9]{64}$/.test(binding.sourceDigest)
  )
    throw Error('BUILD_FAILED');
}

/** Signed local report storage; callers remain responsible for RLS authorization. */
export function createLocalPerformanceReports(
  inputKey: Uint8Array,
  directory?: string
) {
  let key: Buffer;
  try {
    key = Buffer.from(inputKey);
  } catch {
    throw Error('INVALID_REQUEST');
  }
  if (key.byteLength !== 32) throw Error('INVALID_REQUEST');
  const memory = new Map<string, string>();
  const root = directory ? resolve(directory) : undefined;

  if (root) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const metadata = lstatSync(root);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o077) !== 0 ||
      (process.getuid && metadata.uid !== process.getuid())
    )
      throw Error('BUILD_FAILED');
  }

  const filename = (binding: LocalPerformanceReportBinding) =>
    `${createHash('sha256')
      .update(
        JSON.stringify([
          binding.merchantId,
          binding.buildId,
          binding.buildDigest,
          binding.sourceDigest,
        ])
      )
      .digest('hex')}.json`;
  const signature = (payload: string) =>
    createHmac('sha256', key)
      .update(SIGNATURE_CONTEXT)
      .update(payload)
      .digest('hex');
  const canonicalBinding = (binding: LocalPerformanceReportBinding) =>
    JSON.stringify([
      binding.merchantId,
      binding.buildId,
      binding.buildDigest,
      binding.sourceDigest,
    ]);

  const readFile = (name: string): Buffer | undefined => {
    if (!root) return undefined;
    let fd: number | undefined;
    try {
      fd = openSync(
        join(root, name),
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      const metadata = fstatSync(fd);
      if (
        !metadata.isFile() ||
        metadata.size > MAX_REPORT_BYTES ||
        (metadata.mode & 0o077) !== 0 ||
        (process.getuid && metadata.uid !== process.getuid())
      )
        throw Error('BUILD_FAILED');
      return readFileSync(fd);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw Error('BUILD_FAILED');
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  };

  const decode = (
    envelope: StoredEnvelope,
    expected: LocalPerformanceReportBinding
  ) => {
    if (
      typeof envelope.payload !== 'string' ||
      typeof envelope.signature !== 'string' ||
      !/^[a-f0-9]{64}$/.test(envelope.signature) ||
      !timingSafeEqual(
        Buffer.from(envelope.signature, 'hex'),
        Buffer.from(signature(envelope.payload), 'hex')
      )
    )
      throw Error('BUILD_FAILED');
    const payload = JSON.parse(envelope.payload) as StoredPayload;
    if (
      payload.format !== FORMAT ||
      !payload.binding ||
      canonicalBinding(payload.binding) !== canonicalBinding(expected)
    )
      throw Error('BUILD_FAILED');
    const report = experiencePerformanceReport.safeParse(payload.report);
    if (
      !report.success ||
      report.data.buildDigest !== expected.buildDigest ||
      report.data.sourceDigest !== expected.sourceDigest
    )
      throw Error('BUILD_FAILED');
    return report.data;
  };

  const read = (binding: LocalPerformanceReportBinding) => {
    validateBinding(binding);
    const name = filename(binding);
    if (!root) {
      const stored = memory.get(name);
      return stored
        ? decode(JSON.parse(stored) as StoredEnvelope, binding)
        : undefined;
    }
    const bytes = readFile(name);
    if (!bytes) return undefined;
    try {
      return decode(
        JSON.parse(bytes.toString('utf8')) as StoredEnvelope,
        binding
      );
    } catch {
      throw Error('BUILD_FAILED');
    }
  };

  const writeImmutable = (name: string, bytes: Buffer) => {
    if (!root) return;
    const temporary = join(root, `.tmp-${randomUUID()}`);
    let fd: number | undefined;
    try {
      fd = openSync(temporary, 'wx', 0o600);
      writeFileSync(fd, bytes);
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      linkSync(temporary, join(root, name));
      const dir = openSync(root, constants.O_RDONLY);
      try {
        fsyncSync(dir);
      } finally {
        closeSync(dir);
      }
    } finally {
      if (fd !== undefined) closeSync(fd);
      rmSync(temporary, { force: true });
    }
  };

  const boundUsage = () => {
    if (!root) return;
    const entries = readdirSync(root)
      .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .map((name) => {
        const path = join(root, name);
        const metadata = lstatSync(path);
        if (
          !metadata.isFile() ||
          metadata.isSymbolicLink() ||
          (metadata.mode & 0o077) !== 0 ||
          (process.getuid && metadata.uid !== process.getuid())
        )
          throw Error('BUILD_FAILED');
        return { name, path, modified: metadata.mtimeMs };
      })
      .sort((a, b) => a.modified - b.modified);
    while (entries.length >= MAX_ENTRIES) {
      const old = entries.shift();
      if (old) rmSync(old.path, { force: true });
    }
  };

  return {
    retain(binding: LocalPerformanceReportBinding, input: unknown) {
      validateBinding(binding);
      const parsed = experiencePerformanceReport.safeParse(input);
      if (
        !parsed.success ||
        parsed.data.buildDigest !== binding.buildDigest ||
        parsed.data.sourceDigest !== binding.sourceDigest
      )
        throw Error('BUILD_FAILED');
      const payload = JSON.stringify({
        format: FORMAT,
        binding,
        report: parsed.data,
      } satisfies StoredPayload);
      const envelope = JSON.stringify({
        payload,
        signature: signature(payload),
      });
      const bytes = Buffer.from(envelope);
      if (bytes.byteLength > MAX_REPORT_BYTES) throw Error('QUOTA_EXCEEDED');
      const name = filename(binding);
      if (!root) {
        const previous = memory.get(name);
        if (previous && previous !== envelope) throw Error('BUILD_FAILED');
        if (!previous) {
          while (memory.size >= MAX_ENTRIES) {
            const oldest = memory.keys().next().value;
            if (oldest === undefined) break;
            memory.delete(oldest);
          }
        }
        memory.set(name, envelope);
        return;
      }
      const previous = readFile(name);
      if (previous) {
        const existing = decode(
          JSON.parse(previous.toString('utf8')) as StoredEnvelope,
          binding
        );
        if (JSON.stringify(existing) !== JSON.stringify(parsed.data))
          throw Error('BUILD_FAILED');
        return;
      }
      boundUsage();
      try {
        writeImmutable(name, bytes);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
          throw Error('BUILD_FAILED');
        const raced = read(binding);
        if (JSON.stringify(raced) !== JSON.stringify(parsed.data))
          throw Error('BUILD_FAILED');
      }
    },
    read,
  };
}
