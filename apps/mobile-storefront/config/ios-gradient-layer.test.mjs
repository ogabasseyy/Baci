import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '../../..');
const packagePath = require.resolve('expo-linear-gradient/package.json');

test('installed iOS gradients retain the composition fix for main-thread bitmap hangs', () => {
  const version = JSON.parse(readFileSync(packagePath, 'utf8')).version;
  assert.equal(version, '57.0.1');
  const workspace = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8');
  assert.match(
    workspace,
    /expo-linear-gradient@57\.0\.1.*patches\/expo-linear-gradient@57\.0\.1\.patch/
  );
  const lockfile = readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8');
  assert.match(lockfile, /expo-linear-gradient@57\.0\.1: [a-f0-9]{64}/);
  const source = readFileSync(
    resolve(dirname(packagePath), 'ios/LinearGradientLayer.swift'),
    'utf8'
  );
  assert.match(source, /class LinearGradientLayer: CAGradientLayer/);
  assert.doesNotMatch(source, /UIGraphics|drawLinearGradient|CGContext/);
});
