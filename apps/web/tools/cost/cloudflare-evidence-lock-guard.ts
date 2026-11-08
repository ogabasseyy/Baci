import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, rm } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

type GuardRecord = Readonly<{
  pid: number;
  processStartTime: string;
  token: string;
}>;
type OwnerRecordHandle = Readonly<{
  writeFile(value: string): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}>;
type OwnerRecordIo = Readonly<{
  open(path: string, flags: number, mode: number): Promise<OwnerRecordHandle>;
  remove(path: string): Promise<void>;
}>;

const GUARD_TIMEOUT_MS = 60_000;
const guardPath = (path: string) => `${path}.reclaim-guard`;
const guardOwnerPath = (path: string) => `${guardPath(path)}/owner`;
const ownerPrefix = (path: string) => `${basename(path)}.reclaim-owner-`;
const ownerPath = (path: string, token: string) =>
  `${path}.reclaim-owner-${process.pid}-${token}`;

function processStartTime(pid: number) {
  try {
    return (
      execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8',
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

function currentProcessStartTime() {
  const value = processStartTime(process.pid);
  if (!value)
    throw new Error('evidence lock guard owner identity is unavailable');
  return value;
}

function parseRecord(value: string): GuardRecord {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === 'object' &&
      Number.isInteger((parsed as { pid?: unknown }).pid) &&
      typeof (parsed as { processStartTime?: unknown }).processStartTime ===
        'string' &&
      typeof (parsed as { token?: unknown }).token === 'string'
    )
      return parsed as GuardRecord;
  } catch {
    // Treat malformed owner metadata as an authority failure below.
  }
  throw new Error('evidence lock guard owner metadata is invalid');
}

function isProcessLive(record: GuardRecord) {
  if (record.pid <= 0) return false;
  try {
    process.kill(record.pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') return false;
  }
  const observed = processStartTime(record.pid);
  return observed === undefined || observed === record.processStartTime;
}

const ownerRecordIo: OwnerRecordIo = {
  open,
  remove: (path) => rm(path, { force: true }),
};

async function writeOwnerRecord(
  path: string,
  record: GuardRecord,
  io: OwnerRecordIo
) {
  let handle: OwnerRecordHandle | undefined;
  try {
    handle = await io.open(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600
    );
    await handle.writeFile(`${JSON.stringify(record)}\n`);
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined);
      await io.remove(path).catch(() => undefined);
    }
    throw error;
  }
}

function isPidLive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function readOwnerRecords(path: string) {
  const directory = dirname(path);
  const entries = await readdir(directory, { withFileTypes: true });
  const records: Array<{ path: string; record: GuardRecord }> = [];
  for (const entry of entries) {
    if (!entry.name.startsWith(ownerPrefix(path))) continue;
    const recordPath = `${directory}/${entry.name}`;
    let stat: Awaited<ReturnType<typeof lstat>>;
    try {
      stat = await lstat(recordPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0)
      throw new Error('evidence lock guard owner metadata is not private');
    let contents: string;
    try {
      contents = await readFile(recordPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    try {
      records.push({ path: recordPath, record: parseRecord(contents) });
    } catch (error) {
      const suffix = entry.name.slice(ownerPrefix(path).length);
      const filenamePid = Number(suffix.slice(0, suffix.indexOf('-')));
      if (isPidLive(filenamePid)) throw error;
      await rm(recordPath, { force: true });
    }
  }
  return records;
}

async function readGuardOwner(path: string) {
  const directoryPath = guardPath(path);
  const stat = await lstat(directoryPath);
  if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o077) !== 0)
    throw new Error('evidence lock guard is not a private directory');
  const entries = await readdir(directoryPath, { withFileTypes: true });
  if (entries.some((entry) => entry.name !== 'owner'))
    throw new Error('evidence lock guard contains unexpected entries');
  if (entries.length === 0) return undefined;
  const ownerStat = await lstat(guardOwnerPath(path));
  if (
    ownerStat.isSymbolicLink() ||
    !ownerStat.isFile() ||
    (ownerStat.mode & 0o077) !== 0
  )
    throw new Error('evidence lock guard owner metadata is not private');
  return parseRecord(await readFile(guardOwnerPath(path), 'utf8'));
}

async function removeOwnedGuard(path: string, record: GuardRecord) {
  try {
    const owner = await readGuardOwner(path);
    if (
      owner &&
      (owner.pid !== record.pid ||
        owner.processStartTime !== record.processStartTime ||
        owner.token !== record.token)
    )
      throw new Error('evidence lock guard owner changed during release');
    await rm(guardPath(path), { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

const waitForGuard = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 5));

/** Serializes lock-path mutation and lock acquisition across processes. */
export async function withEvidenceLockPathGuard<T>(
  path: string,
  operation: () => Promise<T>,
  io: OwnerRecordIo = ownerRecordIo
) {
  const token = randomUUID();
  const record = Object.freeze({
    pid: process.pid,
    processStartTime: currentProcessStartTime(),
    token,
  });
  const metadataPath = ownerPath(path, token);
  await writeOwnerRecord(metadataPath, record, io);
  const deadline = Date.now() + GUARD_TIMEOUT_MS;
  let acquired = false;
  try {
    while (!acquired) {
      if (Date.now() >= deadline)
        throw new Error('evidence lock guard wait timed out');
      const records = await readOwnerRecords(path);
      const liveRecords = records.filter(({ record }) => isProcessLive(record));
      const hasDeadRecord = liveRecords.length !== records.length;
      const firstLiveRecord = [...liveRecords].sort((left, right) =>
        left.path.localeCompare(right.path)
      )[0];
      if (firstLiveRecord?.path !== metadataPath) {
        await waitForGuard();
        continue;
      }
      for (const { path: recordPath, record } of records)
        if (recordPath !== metadataPath && !isProcessLive(record))
          await rm(recordPath, { force: true });
      let guardCreated = false;
      try {
        await mkdir(guardPath(path), { mode: 0o700 });
        guardCreated = true;
        await writeOwnerRecord(guardOwnerPath(path), record, io);
        acquired = true;
      } catch (error) {
        if (guardCreated) {
          await rm(guardPath(path), { recursive: true, force: true });
          throw error;
        }
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        let owner: GuardRecord | undefined;
        try {
          owner = await readGuardOwner(path);
        } catch (readError) {
          if ((readError as NodeJS.ErrnoException).code !== 'ENOENT')
            throw readError;
        }
        if (owner && isProcessLive(owner)) {
          await waitForGuard();
          continue;
        }
        if (
          !owner &&
          liveRecords.some(
            ({ path: recordPath }) => recordPath !== metadataPath
          ) &&
          !hasDeadRecord
        ) {
          await waitForGuard();
          continue;
        }
        await rm(guardPath(path), { recursive: true, force: true });
        await waitForGuard();
      }
    }
    return await operation();
  } finally {
    if (acquired) {
      try {
        await removeOwnedGuard(path, record);
      } finally {
        await rm(metadataPath, { force: true });
      }
    } else {
      await rm(metadataPath, { force: true });
    }
  }
}

/** Creates a lock record under the same guard used by stale-owner reclaim. */
export function tryCreateEvidenceLock(path: string, contents: string) {
  return withEvidenceLockPathGuard(path, async () => {
    try {
      const handle = await open(path, 'wx', 0o600);
      try {
        await handle.writeFile(contents);
        await handle.sync();
      } finally {
        await handle.close();
      }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  });
}
