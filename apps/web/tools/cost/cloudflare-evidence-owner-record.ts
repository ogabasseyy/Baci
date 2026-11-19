import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, open, rm } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

export type GuardRecord = Readonly<{
  pid: number;
  processStartTime: string;
  token: string;
}>;
type OwnerRecordHandle = Readonly<{
  writeFile(value: string): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}>;
export type OwnerRecordIo = Readonly<{
  open(path: string, flags: number, mode: number): Promise<OwnerRecordHandle>;
  remove(path: string): Promise<void>;
  link(source: string, destination: string): Promise<void>;
}>;

export const ownerRecordIo: OwnerRecordIo = {
  open,
  link,
  remove: (path) => rm(path, { force: true }),
};

export async function writeOwnerRecord(
  path: string,
  record: GuardRecord,
  io: OwnerRecordIo
) {
  // Keep incomplete files outside both the arbitration prefix and the guard
  // directory; readers must only observe complete, exclusively published JSON.
  const parent =
    basename(path) === 'owner' ? dirname(dirname(path)) : dirname(path);
  const temporaryPath = `${parent}/.baci-owner-pending-${randomUUID()}`;
  let handle: OwnerRecordHandle | undefined;
  let created = false;
  let published = false;
  try {
    handle = await io.open(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600
    );
    created = true;
    await handle.writeFile(`${JSON.stringify(record)}\n`);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await io.link(temporaryPath, path);
    published = true;
    await io.remove(temporaryPath);
    created = false;
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    if (published) await io.remove(path).catch(() => undefined);
    if (created) await io.remove(temporaryPath).catch(() => undefined);
    throw error;
  }
}
