const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

jest.mock('@expo/config-plugins', () => ({
  withDangerousMod: (config, [, action]) =>
    action({
      ...config,
      modRequest: { projectRoot: config.modRequest.projectRoot },
    }),
}));

const withFirebaseModularHeaders = require('./withFirebaseModularHeaders');

describe('withFirebaseModularHeaders', () => {
  let projectRoot;
  let podfilePath;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'baci-ios-pods-'));
    podfilePath = path.join(projectRoot, 'ios', 'Podfile');
    fs.mkdirSync(path.dirname(podfilePath), { recursive: true });
    fs.writeFileSync(
      podfilePath,
      'platform :ios, "15.1"\npost_install do |installer|\nend\n'
    );
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { force: true, recursive: true });
  });

  it('adds ReactCommon headers to splash-motion Nitro pod targets', () => {
    withFirebaseModularHeaders({ modRequest: { projectRoot } });

    const podfile = fs.readFileSync(podfilePath, 'utf8');
    expect(podfile).toContain(
      "['NitroModules', 'NitroMmkv', 'RNSplashMotion'].include?(target.name)"
    );
    expect(podfile).toContain(
      "react_native_common_path = File.expand_path(File.join(config[:reactNativePath], 'ReactCommon'), __dir__)"
    );
    expect(podfile).toContain('"#{react_native_common_path}"');
    expect(podfile).not.toContain(
      '$(PODS_ROOT)/../../node_modules/react-native/ReactCommon'
    );
  });

  it('does not duplicate the post-install configuration on repeated prebuilds', () => {
    const config = { modRequest: { projectRoot } };
    withFirebaseModularHeaders(config);
    withFirebaseModularHeaders(config);

    const podfile = fs.readFileSync(podfilePath, 'utf8');
    expect(podfile.match(/Added by withFirebaseModularHeaders/g)).toHaveLength(
      1
    );
  });
});
