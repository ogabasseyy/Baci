import type { SurfaceEvidenceError } from './agent-surface-evidence';

export function formatSurfaceEvidenceErrors(
  errors: readonly SurfaceEvidenceError[]
): string[] {
  return errors.map((error) => `${error.code}: ${error.message}`);
}
