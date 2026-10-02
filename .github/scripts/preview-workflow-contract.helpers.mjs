import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../workflows/preview.yml', import.meta.url),
  'utf8'
);

// Guard comments name the forbidden tokens; enforce against executable lines.
const executable = workflow
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

function jobBlock(name) {
  const block = executable.match(
    new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  \\w+:\\n|$)`)
  )?.[1];
  assert.ok(block, `${name} job must remain extractable`);
  return block;
}

// Deploy shell extracted to a helper script (300-line rule); contracts
// that used to read the deploy run block read this instead.
const previewDeployScript = readFileSync(
  new URL('./preview-deploy-run.sh', import.meta.url),
  'utf8'
);

// Exposure-control data files: the enforcer allowlist and the redaction
// patterns must stay disjoint (a key is either safe-real or blanked).
const previewEnvAllowlist = readFileSync(
  new URL('./preview-env-allowlist.txt', import.meta.url),
  'utf8'
);
const previewEnvRedact = readFileSync(
  new URL('./preview-env-redact.sed', import.meta.url),
  'utf8'
);

// Single primary export per the repo modularity rule: one cohesive
// fixture object for the contract suites, not a utility module.
export const previewWorkflowContract = {
  executable,
  jobBlock,
  previewDeployScript,
  previewEnvAllowlist,
  previewEnvRedact,
  workflow,
};
