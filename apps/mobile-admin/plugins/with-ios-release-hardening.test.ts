import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import Module, { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const tempRoots: string[] = [];
interface PluginConfig {
  modRequest: {
    projectRoot: string;
  };
}

type DangerousModCallback = (config: PluginConfig) => PluginConfig;
type ModuleLoad = (
  request: string,
  parent: unknown,
  isMain: boolean
) => unknown;

interface ModuleWithLoad {
  _load: ModuleLoad;
}

const moduleWithLoad = Module as unknown as ModuleWithLoad;

function fixturePodfile() {
  return `platform :ios, '16.0'

target 'BaciTheEcommerceBuilder' do
  use_frameworks!
end

post_install do |installer|
  react_native_post_install(installer)
end
`;
}

function runPlugin(projectRoot: string) {
  const pluginPath = require.resolve('./with-ios-release-hardening.js');
  delete require.cache[pluginPath];

  const originalLoad = moduleWithLoad._load;
  moduleWithLoad._load = function mockedLoad(
    this: unknown,
    request: string,
    parent: unknown,
    isMain: boolean
  ): unknown {
    if (request === 'expo/config-plugins') {
      return {
        withDangerousMod: (
          config: PluginConfig,
          mod: ['ios', DangerousModCallback]
        ) => mod[1](config),
        withEntitlementsPlist: (config: PluginConfig) => config,
        withInfoPlist: (config: PluginConfig) => config,
        withXcodeProject: (config: PluginConfig) => config,
      };
    }

    return Reflect.apply(originalLoad, this, [request, parent, isMain]);
  };

  try {
    const withIosReleaseHardening = require(pluginPath) as (
      config: PluginConfig
    ) => PluginConfig;

    return withIosReleaseHardening({
      modRequest: { projectRoot },
    });
  } finally {
    moduleWithLoad._load = originalLoad;
    delete require.cache[pluginPath];
  }
}

function createIosProject() {
  const root = mkdtempSync(path.join(tmpdir(), 'baci-ios-hardening-'));
  tempRoots.push(root);
  mkdirSync(path.join(root, 'ios'), { recursive: true });
  writeFileSync(path.join(root, 'ios', 'Podfile'), fixturePodfile());
  return root;
}

function readPodfile(projectRoot: string) {
  return readFileSync(path.join(projectRoot, 'ios', 'Podfile'), 'utf-8');
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('with-ios-release-hardening ExpoModulesCore concurrency', () => {
  it('injects minimal Swift concurrency checking for ExpoModulesCore', () => {
    const projectRoot = createIosProject();
    runPlugin(projectRoot);
    const podfile = readPodfile(projectRoot);

    expect(podfile).toContain("if target.name == 'ExpoModulesCore'");
    expect(podfile).toContain(
      "config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'minimal'"
    );
    expect(podfile).toContain('react_native_post_install(installer)');
  });

  it('is idempotent across repeated prebuilds', () => {
    const projectRoot = createIosProject();
    runPlugin(projectRoot);
    const once = readPodfile(projectRoot);
    runPlugin(projectRoot);
    const twice = readPodfile(projectRoot);

    expect(twice).toBe(once);
    expect(
      twice.match(
        /config\.build_settings\['SWIFT_STRICT_CONCURRENCY'\] = 'minimal'/g
      ) ?? []
    ).toHaveLength(1);
  });
});
