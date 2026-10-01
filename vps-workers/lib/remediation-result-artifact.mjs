import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { remediationArtifactKeyFor } from './remediation-artifact-key.mjs';

export function writeRemediationResultArtifact({
  candidate,
  output,
  outputDir,
}) {
  if (!outputDir) {
    return undefined;
  }

  const artifactKey = remediationArtifactKeyFor(candidate);
  mkdirSync(outputDir, { recursive: true });
  const path = join(outputDir, `${artifactKey}.result.md`);
  writeFileSync(
    path,
    [
      `# Codex investigation ${artifactKey}`,
      '',
      String(output || '').trim(),
      '',
    ].join('\n'),
    { mode: 0o600 }
  );
  return path;
}
