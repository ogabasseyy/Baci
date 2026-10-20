// Regression test: restored production SAST coverage must stay restored.
//
// A future .semgrepignore edit that reintroduces a directory wildcard over a
// runtime tree would silently drop scheduled/manual `semgrep ci` coverage.
// This suite uses the same git check-ignore proxy as
// security-analysis-diagnostics.test.mjs: representative production files in
// the restored trees must NOT be ignored, while the documented fixture
// exclusions must remain ignored.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Representative production/operational files across every tree this PR
// restored to scanning. Each must stay visible to `semgrep ci`.
const SCANNED = [
  'apps/web/tools/connector-gateway/server.ts',
  'apps/web/tools/connector-http.ts',
  'apps/web/tools/db/create-supabase-management-read-only-executor.ts',
  'apps/web/tools/db/run-replay-command.ts',
  'apps/web/tools/events/event-pipeline-production-surface.ts',
  'apps/web/mcp-server/docker-compose.yml',
  'apps/web/mcp-server/agentic-checkout-client.ts',
  'tools/staging/interest-bridge/test-plan/read_empty_wallet.py',
  'tools/staging/prefunded-card/treasury-owner.py',
  'tools/staging/prefunded-card/launch-public.ts',
  'vps-workers/bin/verify-cache-invalidation-drain-installed.sh',
  'infra/cwv-runner',
  'ci_scripts/ci_pre_xcodebuild.sh',
];

// Documented fixture exclusions: sampled from the per-file entries in
// .semgrepignore. Each must remain ignored.
const IGNORED = [
  'tools/staging/replay-complete-cutover-owner/financial_report.test.py',
  'apps/web/tools/db/canonical-replay-fixture-json.test.ts',
  'apps/mobile-storefront/__tests__/config/quiz-ads-release-workflow.test.ts',
];

function checkIgnore(root, path) {
  const r = spawnSync('git', ['check-ignore', '--no-index', path], {
    cwd: root,
    encoding: 'utf8',
  });
  return r.status === 0;
}

test('restored production files stay visible to semgrep', () => {
  const root = mkdtempSync(join(tmpdir(), 'baci-semgrep-coverage-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(join(root, '.git', 'info', 'exclude'), readFileSync(join(REPO, '.semgrepignore'), 'utf8'));
    for (const path of SCANNED) {
      assert.equal(checkIgnore(root, path), false, `${path} must stay scanned`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('documented fixture exclusions remain ignored', () => {
  const root = mkdtempSync(join(tmpdir(), 'baci-semgrep-coverage-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(join(root, '.git', 'info', 'exclude'), readFileSync(join(REPO, '.semgrepignore'), 'utf8'));
    const entries = readFileSync(join(REPO, '.semgrepignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('/') && !l.endsWith('/'));
    assert.ok(entries.length > 0, 'expected per-file ignore entries');
    for (const entry of [...entries.slice(0, 40), ...IGNORED.map((p) => `/${p}`)]) {
      assert.equal(checkIgnore(root, entry.slice(1)), true, `${entry} must stay ignored`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
