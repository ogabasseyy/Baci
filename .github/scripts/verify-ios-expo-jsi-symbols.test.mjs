import assert from 'node:assert/strict';
import { test } from 'node:test';
import { missingExpoJsiSymbols } from './verify-ios-expo-jsi-symbols.mjs';

const withValue = '_$s14ExpoModulesJSI13JavaScriptRefCAARi_zrlE9withValueyqd__SgAExSgKXEKRi_d__lF';

test('rejects the build575 Core import absent from the shipped JSI library', () => {
  const binaries = [
    { name: 'ExpoModulesCore', undefinedSymbols: [withValue], definedSymbols: [] },
    { name: 'ExpoModulesJSI', undefinedSymbols: [], definedSymbols: ['_$s14ExpoModulesJSI8unrelated'] },
  ];
  const missing = missingExpoJsiSymbols(binaries);
  assert.deepEqual(missing, [`ExpoModulesCore: ${withValue.slice(1)}`]);
});

test('accepts the same Core import when its exact symbol is packaged', () => {
  const binaries = [
    { name: 'ExpoModulesCore', undefinedSymbols: [withValue], definedSymbols: [] },
    { name: 'ExpoModulesJSI', undefinedSymbols: [], definedSymbols: [withValue] },
  ];
  assert.deepEqual(missingExpoJsiSymbols(binaries), []);
});

test('normalizes nm leading underscores and checks consumers other than Core', () => {
  const binaries = [{ name: 'ExpoImage', undefinedSymbols: [withValue.slice(1)], definedSymbols: [] }];
  assert.deepEqual(missingExpoJsiSymbols(binaries), [`ExpoImage: ${withValue.slice(1)}`]);
});

test('accepts statically resolved JSI and ignores external system imports', () => {
  const binaries = [{ name: 'Ogabassey', undefinedSymbols: ['_objc_msgSend'], definedSymbols: [withValue] }];
  assert.deepEqual(missingExpoJsiSymbols(binaries), []);
});
