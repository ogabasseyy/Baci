import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('deploy runs the trusted dropped-reference gate after upload and before cleanup', () => {
  const workflow = readFileSync('.github/workflows/preview.yml', 'utf8');
  const deploy = workflow.slice(workflow.indexOf('\n  deploy:'));
  assert.ok(
    deploy.indexOf('id: deploy') < deploy.indexOf('preview-gate-cli.mjs')
  );
  assert.ok(
    deploy.indexOf('preview-gate-cli.mjs') <
      deploy.indexOf('Clean up Vercel secrets')
  );
  assert.match(
    deploy,
    /\.preview-refs-quarantine\/\.preview-refs-manifest\.json/
  );
  assert.match(deploy, /steps\.deploy\.outputs\.preview_url/);
});
