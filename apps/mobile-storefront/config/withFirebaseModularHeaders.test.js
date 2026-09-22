const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

jest.mock(
  '@expo/config-plugins',
  () => ({
    withDangerousMod: (config, [, callback]) => {
      globalThis.__capturedPodfileMod = callback;
      return config;
    },
  }),
  { virtual: false }
);

const withFirebaseModularHeaders = require('./withFirebaseModularHeaders.js');

const tempRoots = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

function fixturePodfile() {
  return `platform :ios, '16.0'

target 'Ogabassey' do
  use_frameworks!
end

post_install do |installer|
  react_native_post_install(installer)
end
`;
}

function runPlugin(projectRoot) {
  withFirebaseModularHeaders({ modRequest: { projectRoot } });
  const callback = globalThis.__capturedPodfileMod;
  expect(typeof callback).toBe('function');
  callback({ modRequest: { projectRoot } });
  return fs.readFileSync(path.join(projectRoot, 'ios', 'Podfile'), 'utf8');
}

function createIosProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baci-firebase-headers-'));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, 'ios'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ios', 'Podfile'), fixturePodfile());
  return root;
}

describe('withFirebaseModularHeaders ExpoModulesCore concurrency', () => {
  it('injects minimal Swift concurrency checking for ExpoModulesCore', () => {
    const projectRoot = createIosProject();
    const podfile = runPlugin(projectRoot);

    expect(podfile).toContain("if target.name == 'ExpoModulesCore'");
    expect(podfile).toContain(
      "config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'minimal'"
    );
    expect(podfile).toContain(
      "config.build_settings['DEFINES_MODULE'] = 'YES'"
    );
  });

  it('keeps the override inside the regenerated surgical block', () => {
    // A separate post_install block would be stripped by this plugin's own
    // cleanup on the next prebuild; the setting must ride the surgical block
    // the plugin regenerates every run.
    const projectRoot = createIosProject();
    const podfile = runPlugin(projectRoot);
    const marker = podfile.indexOf('Added by withFirebaseModularHeaders');
    const setting = podfile.indexOf(
      "config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'minimal'"
    );

    expect(marker).toBeGreaterThanOrEqual(0);
    expect(setting).toBeGreaterThan(marker);
  });
});
