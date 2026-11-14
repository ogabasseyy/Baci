import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createCaptureReviewState } from './webhook-capture-review-state';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

function stateFile() {
  const directory = mkdtempSync(join(tmpdir(), 'piggyvest-review-state-'));
  temporaryDirectories.push(directory);
  return join(directory, 'state.json');
}

it('persists the last paged count across state-store instances', () => {
  const path = stateFile();
  expect(createCaptureReviewState(path).readLastPagedCount()).toBe(0);
  createCaptureReviewState(path).writeLastPagedCount(3);
  expect(createCaptureReviewState(path).readLastPagedCount()).toBe(3);
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
    version: 1,
    lastPagedCount: 3,
  });
});

it('treats malformed state as unpaged and ignores invalid counts', () => {
  const path = stateFile();
  createCaptureReviewState(path).writeLastPagedCount(-1);
  expect(createCaptureReviewState(path).readLastPagedCount()).toBe(0);
  writeFileSync(path, '{bad json');
  expect(createCaptureReviewState(path).readLastPagedCount()).toBe(0);
});
