import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Conflict-free replay registry. Each change adds its own
 * `replay-registry/<YYYYMMDDHHMMSS>_<slug>/` folder instead of editing a
 * shared aggregator, and the aggregators discover every folder at runtime in
 * sorted (code-unit) folder order. Plain-text lists keep discovery
 * synchronous and identical under vitest, tsx, and the CI replay tools.
 * Anything that does not follow the layout fails loudly; nothing is skipped.
 * See `replay-registry/README.md` for the authoring guide.
 */
const REPLAY_REGISTRY_DIRECTORY = path.join(
  import.meta.dirname,
  'replay-registry'
);

const REPLAY_REGISTRY_LISTS = [
  'expected-pending-sources.txt',
  'pending-sources.txt',
  'sql-checks.txt',
] as const;
type ReplayRegistryList = (typeof REPLAY_REGISTRY_LISTS)[number];
type ReplayRegistrySourceList = Exclude<ReplayRegistryList, 'sql-checks.txt'>;
type ReplayRegistryLine = {
  /** `<folder>/<list>:<line>` for error messages. */
  readonly location: string;
  readonly value: string;
};

const FOLDER_NAME = /^\d{14}_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const SOURCE_ROW = /^[0-9a-f]{64} \d{14}_[a-z0-9_]+\.sql$/;
const isRegistryList = (name: string): name is ReplayRegistryList =>
  (REPLAY_REGISTRY_LISTS as readonly string[]).includes(name);
// Finder metadata is never a registry entry; every other name is validated.
const isFinderMetadata = (name: string) => name === '.DS_Store';

function replayRegistryError(message: string): Error {
  return new Error(
    `Replay registry: ${message} (see apps/web/tools/db/replay-registry/README.md)`
  );
}

function listRegistryFolders(directory: string): string[] {
  const folders: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (isFinderMetadata(entry.name)) continue;
    if (entry.name === 'README.md' && entry.isFile()) continue;
    if (!entry.isDirectory() || !FOLDER_NAME.test(entry.name)) {
      throw replayRegistryError(
        `unexpected entry "${entry.name}"; expected <YYYYMMDDHHMMSS>_<slug>/ folders`
      );
    }
    folders.push(entry.name);
  }
  return folders.sort();
}

function listFolderLists(directory: string, folder: string): string[] {
  const lists: string[] = [];
  for (const entry of readdirSync(path.join(directory, folder), {
    withFileTypes: true,
  })) {
    if (isFinderMetadata(entry.name)) continue;
    if (!entry.isFile() || !isRegistryList(entry.name)) {
      throw replayRegistryError(
        `unexpected entry "${folder}/${entry.name}"; expected ${REPLAY_REGISTRY_LISTS.join(', ')}`
      );
    }
    lists.push(entry.name);
  }
  if (lists.length === 0) throw replayRegistryError(`"${folder}" is empty`);
  return lists;
}

function readListLines(filePath: string, label: string): ReplayRegistryLine[] {
  const body = readFileSync(filePath, 'utf8');
  if (!body.endsWith('\n')) {
    throw replayRegistryError(`${label} must end with a newline`);
  }
  const lines: ReplayRegistryLine[] = [];
  for (const [index, value] of body.slice(0, -1).split('\n').entries()) {
    const location = `${label}:${index + 1}`;
    if (value.startsWith('#')) continue;
    if (value.trim().length === 0) {
      throw replayRegistryError(`${location} is blank`);
    }
    if (value !== value.trim()) {
      throw replayRegistryError(`${location} has surrounding whitespace`);
    }
    lines.push({ location, value });
  }
  if (lines.length === 0) {
    throw replayRegistryError(`${label} lists no entries`);
  }
  return lines;
}

/**
 * Every non-comment line of `list` across all registry folders, in sorted
 * folder order then file order. The whole folder layout is validated on each
 * read, so a misnamed folder or file fails every registry consumer.
 */
function readReplayRegistryList(
  list: ReplayRegistryList,
  directory: string = REPLAY_REGISTRY_DIRECTORY
): ReplayRegistryLine[] {
  const lines: ReplayRegistryLine[] = [];
  for (const folder of listRegistryFolders(directory)) {
    if (!listFolderLists(directory, folder).includes(list)) continue;
    const label = `${folder}/${list}`;
    lines.push(...readListLines(path.join(directory, folder, list), label));
  }
  return lines;
}

/**
 * `<sha256> <migration filename>` rows, the exact row format the replay
 * manifest parses. Each migration may be registered once per list.
 */
function readReplayRegistrySourceRows(
  list: ReplayRegistrySourceList,
  directory: string = REPLAY_REGISTRY_DIRECTORY
): string[] {
  const registeredAt = new Map<string, string>();
  return readReplayRegistryList(list, directory).map(({ location, value }) => {
    if (!SOURCE_ROW.test(value)) {
      throw replayRegistryError(
        `${location} must be "<sha256> <YYYYMMDDHHMMSS>_<name>.sql"`
      );
    }
    const filename = value.slice(65);
    const previous = registeredAt.get(filename);
    if (previous) {
      throw replayRegistryError(
        `${location} registers ${filename} again (first at ${previous})`
      );
    }
    registeredAt.set(filename, location);
    return value;
  });
}

export const replayRegistry = {
  directory: REPLAY_REGISTRY_DIRECTORY,
  error: replayRegistryError,
  readList: readReplayRegistryList,
  readSourceRows: readReplayRegistrySourceRows,
};
