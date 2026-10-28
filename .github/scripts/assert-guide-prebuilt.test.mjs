import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { assertGuidePrebuilt } from './assert-guide-prebuilt.mjs';

const rootFiles = [
  'ad-platforms/meta-settings.jpg',
  'chatgpt-ads/nested/diagram.svg',
  'chatgpt-ads/nested/animated.gif',
  'chatgpt-ads/unusual-format.avif',
];

function createFixture(files = rootFiles) {
  const root = mkdtempSync(join(tmpdir(), 'guide-prebuilt-'));
  for (const file of files) {
    for (const prefix of [
      'apps/web/public/guides',
      'public/guides',
      '.vercel/output/static/guides',
    ]) {
      const path = join(root, prefix, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `bytes for ${file}`);
    }
  }
  return root;
}

test('checks parity and prebuilt bytes for every regular guide file', () => {
  const root = createFixture();
  try {
    assert.doesNotThrow(() => assertGuidePrebuilt(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails when an app guide file has no repository-root counterpart', () => {
  const root = createFixture();
  try {
    const appOnly = join(root, 'apps/web/public/guides/new-guide/diagram.svg');
    mkdirSync(dirname(appOnly), { recursive: true });
    writeFileSync(appOnly, 'app-only guide');
    assert.throws(() => assertGuidePrebuilt(root), /directories differ.*missing from public\/guides: new-guide\/diagram\.svg/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails when a repository-root guide file has no app counterpart', () => {
  const root = createFixture();
  try {
    const rootOnly = join(root, 'public/guides/new-guide/diagram.svg');
    mkdirSync(dirname(rootOnly), { recursive: true });
    writeFileSync(rootOnly, 'root-only guide');
    assert.throws(() => assertGuidePrebuilt(root), /directories differ.*missing from apps\/web\/public\/guides: new-guide\/diagram\.svg/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails when matching app and root files differ', () => {
  const root = createFixture();
  try {
    writeFileSync(join(root, 'apps/web/public/guides/chatgpt-ads/nested/diagram.svg'), 'changed app copy');
    assert.throws(() => assertGuidePrebuilt(root), /Guide asset copies differ: chatgpt-ads\/nested\/diagram\.svg/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails when any prebuilt guide file is missing or has different bytes', () => {
  const root = createFixture();
  try {
    const missing = join(root, '.vercel/output/static/guides/chatgpt-ads/unusual-format.avif');
    rmSync(missing);
    assert.throws(() => assertGuidePrebuilt(root), /Prebuilt guide file is missing: chatgpt-ads\/unusual-format\.avif/);

    writeFileSync(missing, 'restored');
    assert.throws(() => assertGuidePrebuilt(root), /Prebuilt guide file differs: chatgpt-ads\/unusual-format\.avif/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed when a required guide directory is absent or empty', () => {
  const missingApp = createFixture();
  try {
    rmSync(join(missingApp, 'apps/web/public/guides'), { recursive: true });
    assert.throws(() => assertGuidePrebuilt(missingApp), /Required guide directory is missing: apps\/web\/public\/guides/);
  } finally {
    rmSync(missingApp, { recursive: true, force: true });
  }

  const empty = mkdtempSync(join(tmpdir(), 'guide-prebuilt-empty-'));
  try {
    for (const directory of ['apps/web/public/guides', 'public/guides']) {
      mkdirSync(join(empty, directory), { recursive: true });
    }
    assert.throws(() => assertGuidePrebuilt(empty), /No guide files found/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});
