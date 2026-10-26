import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const swift = spawnSync('swiftc', ['--version'], { encoding: 'utf8' });

test('native SavingsLiveActivity queue serializes track, clear, account switch, and await races', async (t) => {
  if (process.platform !== 'darwin')
    return t.skip('requires macOS Swift Objective-C interoperability');
  if (swift.error || swift.status !== 0)
    return t.skip('requires swiftc on PATH');

  const root = await mkdtemp(path.join(os.tmpdir(), 'baci-savings-activity-'));
  try {
    const modules = path.join(root, 'modules');
    const app = path.join(root, 'Harness.app', 'Contents');
    const binary = path.join(app, 'MacOS');
    await mkdir(modules, { recursive: true });
    await mkdir(binary, { recursive: true });
    await writeFile(
      path.join(app, 'Info.plist'),
      `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.ogabassey.staging</string><key>CFBundleExecutable</key><string>harness</string></dict></plist>`
    );

    await writeFile(path.join(root, 'ActivityKit.swift'), activityKitStub);
    await writeFile(
      path.join(root, 'React.swift'),
      'public struct ReactModuleMarker {}\n'
    );
    for (const module of ['ActivityKit', 'React']) {
      const built = spawnSync(
        'swiftc',
        [
          '-emit-module',
          '-emit-library',
          '-module-name',
          module,
          path.join(root, `${module}.swift`),
          '-emit-module-path',
          path.join(modules, `${module}.swiftmodule`),
          '-o',
          path.join(modules, `lib${module}.dylib`),
        ],
        { encoding: 'utf8' }
      );
      assert.equal(
        built.status,
        0,
        `could not build ${module} mock:\n${built.stderr}`
      );
    }

    const harness = path.join(root, 'Harness.swift');
    await writeFile(harness, behavioralHarness);
    const executable = path.join(binary, 'harness');
    const compiled = spawnSync(
      'swiftc',
      [
        '-I',
        modules,
        '-L',
        modules,
        '-lActivityKit',
        '-lReact',
        path.join(here, 'SavingsLiveActivity.swift'),
        harness,
        '-o',
        executable,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(
      compiled.status,
      0,
      `could not compile the actual native source:\n${compiled.stderr}`
    );
    const run = spawnSync(executable, [], {
      encoding: 'utf8',
      timeout: 30_000,
      env: { PATH: process.env.PATH, DYLD_LIBRARY_PATH: modules },
    });
    assert.notEqual(
      run.error?.code,
      'ETIMEDOUT',
      'native queue behavior exceeded the 30 second process timeout'
    );
    assert.equal(
      run.status,
      0,
      `native queue behavior failed:\n${run.stdout}\n${run.stderr}`
    );
    assert.match(run.stdout, /SavingsLiveActivity behavioral scenarios passed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const activityKitStub = `
import Foundation
public struct ActivityContent<State> { public var state: State; public init(state: State, staleDate: Date?) { self.state = state } }
public protocol ActivityAttributes { associatedtype ContentState }
public struct ActivityDismissalPolicy { public static let immediate = Self(); public static func after(_ date: Date) -> Self { Self() } }
private enum Registry { static var items: [AnyObject] = []; static let lock = NSLock() }
public enum TestEvents {
  private static var continuation: AsyncStream<String>.Continuation?
  public static let stream: AsyncStream<String> = {
    let pair = AsyncStream<String>.makeStream()
    continuation = pair.continuation
    return pair.stream
  }()
  public static func emit(_ event: String) { continuation?.yield(event) }
}
public struct ActivityAuthorizationInfo { public init() {}; public var areActivitiesEnabled: Bool { true } }
@MainActor public final class Activity<Attributes: ActivityAttributes> {
  public let attributes: Attributes
  public static var activities: [Activity<Attributes>] { Registry.lock.lock(); defer { Registry.lock.unlock() }; return Registry.items.compactMap { $0 as? Activity<Attributes> }.filter { !$0.ended } }
  public var content: ActivityContent<Attributes.ContentState> { ActivityContent(state: state, staleDate: nil) }
  public var ended = false
  public var state: Attributes.ContentState
  public init(attributes: Attributes, state: Attributes.ContentState) { self.attributes = attributes; self.state = state; Registry.lock.lock(); Registry.items.append(self); Registry.lock.unlock() }
  public func update(_ content: ActivityContent<Attributes.ContentState>) async { state = content.state; TestEvents.emit("update"); await TestGate.pauseIfRequested() }
  public func end(_ content: ActivityContent<Attributes.ContentState>?, dismissalPolicy: ActivityDismissalPolicy) async { ended = true; TestEvents.emit("end"); await TestGate.pauseIfRequested() }
  public static func request(attributes: Attributes, content: ActivityContent<Attributes.ContentState>, pushType: Never?) throws -> Activity<Attributes> { TestEvents.emit("request"); return Activity(attributes: attributes, state: content.state) }
}
public enum TestGate {
  public static var shouldPause = false
  private static var continuation: CheckedContinuation<Void, Never>?
  private static var entered: CheckedContinuation<Void, Never>?
  public static func waitUntilEntered() async { if continuation != nil { return }; await withCheckedContinuation { entered = $0 } }
  public static func pauseIfRequested() async { guard shouldPause else { return }; shouldPause = false; await withCheckedContinuation { continuation = $0; entered?.resume(); entered = nil } }
  public static func release() { continuation?.resume(); continuation = nil }
}
`;

const behavioralHarness = String.raw`
import ActivityKit
import Foundation

struct SavingsAttributes: ActivityAttributes {
  struct ContentState { var saved: Double; var target: Double; var updatedAt: Date; var phase: String }
  var goalId: String; var title: String; var sandbox: Bool
}
@main struct Harness {
  @MainActor static func main() async {
    prepareEvents()
    let bridge = SavingsLiveActivity()
    let a = "11111111-1111-4111-8111-111111111111"
    let b = "22222222-2222-4222-8222-222222222222"
    bridge.track(a, title: "Plan A", saved: 10, target: 100, phase: "pending")
    await waitFor("request")
    precondition(Activity<SavingsAttributes>.activities.count == 1)
    precondition(Activity<SavingsAttributes>.activities[0].attributes.goalId == a)

    bridge.track(b, title: "Plan B", saved: 20, target: 200, phase: "pending")
    await waitFor("end")
    await waitFor("request")
    precondition(Activity<SavingsAttributes>.activities.count == 1)
    precondition(Activity<SavingsAttributes>.activities[0].attributes.goalId == b, "account/goal switch must retire prior activity")

    TestGate.shouldPause = true
    bridge.sync(b, title: "Plan B", saved: 25, target: 200)
    await waitFor("update")
    await TestGate.waitUntilEntered()
    bridge.track(a, title: "stale", saved: 1, target: 10, phase: "pending")
    bridge.clear()
    TestGate.release()
    await waitFor("end")
    precondition(Activity<SavingsAttributes>.activities.isEmpty, "clear generation must fence a queued older track")

    bridge.track(a, title: "Plan A", saved: 10, target: 100, phase: "pending")
    await waitFor("request")
    let recreated = Activity<SavingsAttributes>.activities[0]
    TestGate.shouldPause = true
    bridge.track(a, title: "Plan A", saved: 15, target: 100, phase: "pending")
    await waitFor("update")
    await TestGate.waitUntilEntered()
    bridge.clear()
    TestGate.release()
    await waitFor("end")
    precondition(recreated.ended, "clear queued during an awaited update must still end the activity")
    precondition(Activity<SavingsAttributes>.activities.isEmpty)

    bridge.track(a, title: "Old owner", saved: 10, target: 100, phase: "pending")
    await waitFor("request")
    bridge.clear()
    bridge.track(b, title: "New owner", saved: 20, target: 200, phase: "pending")
    await waitFor("end")
    await waitFor("request")
    precondition(Activity<SavingsAttributes>.activities.count == 1)
    precondition(Activity<SavingsAttributes>.activities[0].attributes.goalId == b, "old-owner cleanup must not erase the new owner's activity")
    print("SavingsLiveActivity behavioral scenarios passed")
  }
  static var events = TestEvents.stream.makeAsyncIterator()
  static func prepareEvents() { _ = events }
  static func waitFor(_ expected: String) async {
    while let event = await events.next() { if event == expected { return } }
    preconditionFailure("event stream ended while waiting for \(expected)")
  }
}
`;
