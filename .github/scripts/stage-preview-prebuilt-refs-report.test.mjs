import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { writeReport } from './stage-preview-prebuilt-refs-report.mjs';

function capture(fn) {
  const lines = { out: [], err: [] };
  const origLog = console.log;
  const origErr = console.error;
  console.log = (m) => lines.out.push(String(m));
  console.error = (m) => lines.err.push(String(m));
  try {
    fn();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return lines;
}

test('writes manifest counts without warnings when nothing dropped', () => {
  const stage = mkdtempSync(join(tmpdir(), 'preview-refs-report-'));
  try {
    const lines = capture(() =>
      writeReport({ stage, staged: ['b.js', 'a.js'], skipped: [], missingCount: 0 })
    );
    assert.deepEqual(lines.err, []);
    assert.match(lines.out.join('\n'), /staged 2 referenced file\(s\), skipped 0/);
    const manifest = JSON.parse(readFileSync(join(stage, '.preview-refs-manifest.json'), 'utf8'));
    assert.deepEqual(manifest, { refs: ['a.js', 'b.js'], skipped: [] });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
});

test('warns and annotates dangling and guarded drops', () => {
  const stage = mkdtempSync(join(tmpdir(), 'preview-refs-report-'));
  try {
    const lines = capture(() =>
      writeReport({
        stage,
        staged: ['ok.js'],
        skipped: [
          { value: 'gone.js', reason: 'missing' },
          { value: 'link.js', reason: 'escaped-link' },
          { value: 'trusted-ops/x', reason: 'protected-path' },
          { value: '/n.js=42', reason: 'invalid' },
        ],
        missingCount: 2,
      })
    );
    const err = lines.err.join('\n');
    assert.match(err, /WARNING: dropped 2 dangling reference/);
    assert.match(err, /::warning::Dropped 2 dangling/);
    assert.match(err, /WARNING: dropped 1 protected-path and 1 invalid entries/);
    assert.match(err, /::warning::Dropped 1 protected-path and 1 invalid/);
    assert.match(err, /do not trust READY alone/);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
});

test('summarizes counts and sanitizes values', () => {
  const stage = mkdtempSync(join(tmpdir(), 'preview-refs-report-'));
  const prev = process.env.GITHUB_STEP_SUMMARY;
  try {
    const summary = join(stage, 'summary.md');
    writeFileSync(summary, '');
    process.env.GITHUB_STEP_SUMMARY = summary;
    capture(() =>
      writeReport({
        stage,
        staged: ['ok.js'],
        skipped: [{ value: 'a\nb\x1b[31mc', reason: 'missing' }],
        missingCount: 1,
      })
    );
    const text = readFileSync(summary, 'utf8');
    assert.match(text, /\(1 dangling\)/);
    assert.ok(!text.includes('\x1b'));
    assert.match(text, /`ab\[31mc`/);
  } finally {
    if (prev === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = prev;
    rmSync(stage, { recursive: true, force: true });
  }
});

test('tolerates an unwritable summary without throwing', () => {
  const stage = mkdtempSync(join(tmpdir(), 'preview-refs-report-'));
  const prev = process.env.GITHUB_STEP_SUMMARY;
  process.env.GITHUB_STEP_SUMMARY = stage;
  try {
    const lines = capture(() =>
      writeReport({ stage, staged: [], skipped: [], missingCount: 0 })
    );
    assert.match(lines.err.join('\n'), /WARNING: could not write step summary/);
  } finally {
    if (prev === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = prev;
    rmSync(stage, { recursive: true, force: true });
  }
});
