import { join } from 'node:path';
import type {
  PilotInventoryBinding,
  PilotManifest,
} from '@/schemas/merchant-image-variant-pilot';
import { parsePilotManifest } from '@/schemas/merchant-image-variant-pilot';
import { readBoundedLabJson } from './lab-bounded-json';
import {
  LabGenerationConfinementError,
  resolveLabGenerationDir,
} from './lab-generation-dir';
import type { PilotBindingStatusCode } from './lab-index';

const GENERATION_ID_PATTERN = /^[0-9a-f]{64}$/;

export type BindingManifestLoad =
  | { manifest: PilotManifest; ok: true }
  | {
      detail?: string;
      generationId?: string;
      ok: false;
      status: PilotBindingStatusCode;
    };

// Confined manifest load for one binding: unsafe ids, escaped generation
// entries, missing/unreadable manifests, and schema-invalid manifests map
// to loader statuses; only a parsed manifest returns ok.
export async function loadBindingManifest(input: {
  binding: PilotInventoryBinding;
  generationId: string;
  outputRoot: string;
}): Promise<BindingManifestLoad> {
  if (!GENERATION_ID_PATTERN.test(input.generationId)) {
    return {
      detail: 'acceptance references an unsafe generation id',
      ok: false,
      status: 'invalid-manifest',
    };
  }
  // Confine before reading: a symlinked generations/<id> entry must
  // never serve a manifest from outside the configured output tree.
  try {
    await resolveLabGenerationDir(input.outputRoot, input.generationId);
  } catch (error) {
    if (
      error instanceof LabGenerationConfinementError &&
      error.code === 'generation-escape'
    ) {
      return {
        detail: 'generation entry escapes the output root',
        generationId: input.generationId,
        ok: false,
        status: 'invalid-manifest',
      };
    }
    return {
      generationId: input.generationId,
      ok: false,
      status: 'missing-manifest',
    };
  }
  let manifestText: string;
  try {
    manifestText = await readBoundedLabJson(
      join(
        input.outputRoot,
        'generations',
        input.generationId,
        'manifest.json'
      ),
      256 * 1024
    );
  } catch {
    return {
      generationId: input.generationId,
      ok: false,
      status: 'missing-manifest',
    };
  }
  try {
    const parsed = parsePilotManifest(JSON.parse(manifestText));
    if (!parsed.ok) {
      return {
        detail: parsed.issues.join('; '),
        generationId: input.generationId,
        ok: false,
        status: 'invalid-manifest',
      };
    }
    return { manifest: parsed.manifest, ok: true };
  } catch {
    return {
      generationId: input.generationId,
      ok: false,
      status: 'invalid-manifest',
    };
  }
}
