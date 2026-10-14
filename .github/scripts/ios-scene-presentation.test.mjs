import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const native = (name, path) => readFileSync(join(root, 'node_modules', name, 'ios', path), 'utf8');

function declaration(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, marker);
  let depth = 0;
  let opened = false;
  for (let index = start; index < source.length; index++) {
    if (source[index] === '{') { depth++; opened = true; }
    if (source[index] === '}' && --depth === 0 && opened) return source.slice(start, index + 1);
  }
  assert.fail(`Unclosed declaration: ${marker}`);
}

const helper = () => declaration(native('expo-modules-core', 'Utilities/Utilities.swift'), 'public static func keyWindow()');

test('scene-aware presenters retain legacy windows only when no scene exists', { skip: process.platform !== 'darwin' }, () => {
  const folder = mkdtempSync(join(tmpdir(), 'baci-window-fallback-'));
  try {
    const body = helper().replace('#if os(iOS) || os(tvOS)', '#if true');
    writeFileSync(join(folder, 'main.swift'), `import Foundation
@MainActor final class UIWindow { var isKeyWindow = false }
@MainActor final class UIApplication {
  static let shared = UIApplication()
  var connectedScenes: Set<Int> = []
  var windows: [UIWindow] = []
}
@MainActor enum SceneGeometry {
  static var selected: UIWindow?
  static func keyWindow() -> UIWindow? { selected }
}
struct Utilities { @MainActor ${body} }
let legacy = UIWindow()
legacy.isKeyWindow = true
UIApplication.shared.windows = [UIWindow(), legacy]
precondition(Utilities.keyWindow() === legacy, "legacy admin window must remain available")
let scene = UIWindow()
UIApplication.shared.connectedScenes = [1]
SceneGeometry.selected = scene
precondition(Utilities.keyWindow() === scene, "scene must take precedence over legacy windows")
SceneGeometry.selected = nil
precondition(Utilities.keyWindow() == nil, "connected scenes must never use a legacy fallback")
UIApplication.shared.connectedScenes = []
UIApplication.shared.windows = []
precondition(Utilities.keyWindow() == nil, "missing windows must stay missing")
`);
    const build = spawnSync('xcrun', ['swiftc', '-swift-version', '6', join(folder, 'main.swift'), '-o', join(folder, 'probe')], { encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr);
    const run = spawnSync(join(folder, 'probe'), [], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('installed window helper and auth anchors compile against the actual iOS SDK', { skip: process.platform !== 'darwin' }, () => {
  const folder = mkdtempSync(join(tmpdir(), 'baci-scene-sdk-'));
  try {
    const scene = native('expo-modules-core', 'Utilities/SceneGeometry.swift');
    const apple = declaration(native('expo-apple-authentication', 'AppleAuthenticationRequest.swift'), 'func presentationAnchor(for controller:');
    const web = declaration(native('expo-web-browser', 'WebAuthSession.swift'), 'private class PresentationContextProvider:');
    writeFileSync(join(folder, 'presenters.swift'), `import UIKit
import AuthenticationServices
${scene}
public struct Utilities { @MainActor ${helper()} }
@MainActor final class AppleAnchorProbe: NSObject, ASAuthorizationControllerPresentationContextProviding { ${apple} }
${web}
`);
    const sdk = spawnSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'], { encoding: 'utf8' });
    assert.equal(sdk.status, 0, sdk.stderr);
    const build = spawnSync('xcrun', ['swiftc', '-typecheck', '-swift-version', '6', '-target', 'arm64-apple-ios16.4-simulator', '-sdk', sdk.stdout.trim(), join(folder, 'presenters.swift')], { encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
