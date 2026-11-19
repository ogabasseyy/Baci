import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveBenchmarkIdentity } from './android-benchmark-identity.mjs';
const source = "android: {\n    package: 'com.example.store',\n}";
const google = JSON.stringify({client: [{client_info: {android_client_info: {package_name: 'com.example.store'}}}]});
test('requires the isolated Firebase client for the default mode', () => {
  assert.throws(() => resolveBenchmarkIdentity(source, google, false), /com\.example\.store\.benchmark/);
});
test('allows the existing package only when explicitly requested', () => {
  assert.deepEqual(resolveBenchmarkIdentity(source, google, true), {targetPackage: 'com.example.store', suffix: ''});
});
test('accepts isolated client when present', () => {
  const isolated = JSON.stringify({client: [{client_info: {android_client_info: {package_name: 'com.example.store.benchmark'}}}]});
  assert.deepEqual(resolveBenchmarkIdentity(source, isolated, false), {targetPackage: 'com.example.store.benchmark', suffix: '.benchmark'});
});
test('rejects invalid or ambiguous app identity and malformed Firebase config', () => {
  assert.throws(() => resolveBenchmarkIdentity(source + source, google, true), /package/);
  assert.throws(() => resolveBenchmarkIdentity(source, '{sensitive', true), /Firebase/);
});
