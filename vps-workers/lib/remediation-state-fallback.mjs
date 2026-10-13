import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import {
  remediationObservationFor,
  remediationStateKeyFor,
} from './remediation-state-key.mjs';

const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export function createRemediationFallbackStore(path) {
  const markerDirectory = `${path}.handled-fallback`;
  const markerPath = (candidate) => {
    const key = createHash('sha256')
      .update(remediationStateKeyFor(candidate))
      .digest('hex');
    return `${markerDirectory}/${key}.json`;
  };
  const prune = (recordedAt) => {
    let files;
    try {
      files = readdirSync(markerDirectory);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    const cutoff = Date.parse(recordedAt) - RETENTION_MS;
    if (!Number.isFinite(cutoff)) return;
    for (const file of files) {
      const markerPath = `${markerDirectory}/${file}`;
      if (file.endsWith('.tmp')) {
        try {
          if (statSync(markerPath).mtimeMs < cutoff) unlinkSync(markerPath);
        } catch {
          // A concurrent writer may have finished or replaced its temporary file.
        }
        continue;
      }
      if (!file.endsWith('.json')) continue;
      try {
        const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
        const markedAt = Date.parse(marker?.recordedAt);
        if (!Number.isFinite(markedAt) || markedAt < cutoff) {
          unlinkSync(markerPath);
        }
      } catch {
        // Preserve unreadable markers for explicit candidate reconciliation.
      }
    }
  };
  return {
    clear(candidate) {
      try {
        unlinkSync(markerPath(candidate));
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    },
    persist(candidate, recordedAt) {
      const target = markerPath(candidate);
      mkdirSync(dirname(target), { recursive: true });
      const temporaryPath = `${target}.${process.pid}.tmp`;
      writeFileSync(
        temporaryPath,
        `${JSON.stringify({
          observation: remediationObservationFor(candidate),
          recordedAt,
        })}\n`,
        { mode: 0o600 }
      );
      renameSync(temporaryPath, target);
    },
    reconcile(state, candidates, recordedAt) {
      prune(recordedAt);
      const reconciled = [];
      for (const candidate of candidates) {
        let content;
        try {
          content = readFileSync(markerPath(candidate), 'utf8');
        } catch (error) {
          if (error?.code === 'ENOENT') continue;
          throw error;
        }
        const observation = JSON.parse(content)?.observation;
        if (typeof observation !== 'string') continue;
        const key = remediationStateKeyFor(candidate);
        state.handled[key] = { observation, recordedAt };
        delete state.reservations[key];
        reconciled.push(candidate);
      }
      return reconciled;
    },
  };
}
