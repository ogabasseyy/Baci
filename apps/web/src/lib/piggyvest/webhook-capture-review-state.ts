import 'server-only';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface CaptureReviewState {
  readLastPagedCount(): number;
  writeLastPagedCount(count: number): void;
}

const STATE_FILE = 'piggyvest-capture-review.json';

export function createCaptureReviewState(
  path = join(
    process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'),
    'baci',
    STATE_FILE
  )
): CaptureReviewState {
  return {
    readLastPagedCount() {
      try {
        const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
        if (
          typeof value === 'object' &&
          value !== null &&
          'version' in value &&
          value.version === 1 &&
          'lastPagedCount' in value &&
          typeof value.lastPagedCount === 'number' &&
          Number.isSafeInteger(value.lastPagedCount) &&
          value.lastPagedCount >= 0
        )
          return value.lastPagedCount;
      } catch {
        // Missing or unreadable state fails open so a new review still pages.
      }
      return 0;
    },
    writeLastPagedCount(count) {
      if (!Number.isSafeInteger(count) || count < 0) return;
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const temporaryPath = `${path}.${process.pid}.tmp`;
      writeFileSync(
        temporaryPath,
        `${JSON.stringify({ version: 1, lastPagedCount: count })}\n`,
        { mode: 0o600 }
      );
      renameSync(temporaryPath, path);
    },
  };
}
