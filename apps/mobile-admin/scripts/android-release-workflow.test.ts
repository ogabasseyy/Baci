import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// This test intentionally lives in the admin Vitest project because `.github`
// is not a package and has no test runner of its own.
const workflowPath = resolve(
  process.cwd(),
  '../../.github/workflows/android-release.yml'
);

function getWorkflowStep(workflow: string, name: string): string {
  const stepStart = workflow.indexOf(`- name: ${name}`);
  if (stepStart === -1) {
    return '';
  }

  const nextStep = workflow.indexOf('\n      - name:', stepStart + 1);
  return workflow.slice(stepStart, nextStep === -1 ? undefined : nextStep);
}

describe('Android admin release workflow', () => {
  it('installs the patched React Native native-build toolchain', async () => {
    const workflow = await readFile(workflowPath, 'utf8');
    const setupAndroidStep = getWorkflowStep(workflow, 'Setup Android SDK');

    expect(setupAndroidStep).toContain('packages:');
    expect(setupAndroidStep).toContain('cmake;3.30.5');
  });

  it('verifies the release AAB before publishing it', async () => {
    const workflow = await readFile(workflowPath, 'utf8');
    const verificationStep = workflow.indexOf(
      'name: Verify Android release recommendations'
    );
    const buildStep = workflow.indexOf('name: Build Android App Bundle');
    const artifactUploadStep = workflow.indexOf('name: Upload AAB artifact');
    const playUploadStep = workflow.indexOf('name: Upload to Google Play');
    const verification = getWorkflowStep(
      workflow,
      'Verify Android release recommendations'
    );
    const build = getWorkflowStep(workflow, 'Build Android App Bundle');

    expect(verificationStep).toBeGreaterThan(-1);
    expect(buildStep).toBeGreaterThan(-1);
    expect(artifactUploadStep).toBeGreaterThan(-1);
    expect(playUploadStep).toBeGreaterThan(-1);
    expect(verificationStep).toBeGreaterThan(buildStep);
    expect(verificationStep).toBeLessThan(artifactUploadStep);
    expect(verificationStep).toBeLessThan(playUploadStep);
    expect(verification).toContain("BUNDLETOOL_VERSION: '1.18.3'");
    expect(verification).toContain(
      'BUNDLETOOL_SHA256: a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29'
    );
    expect(verification).toContain('--connect-timeout 10 --max-time 180');
    expect(verification).toContain('sha256sum --check');
    expect(verification).toContain('verify-android-release-aab.mjs');
    expect(verification).toContain(
      '--aab apps/mobile-admin/android/app/build/outputs/bundle/release/app-release.aab'
    );
    expect(verification).toContain(
      '--mapping apps/mobile-admin/android/app/build/outputs/mapping/release/mapping.txt'
    );
    expect(verification).toContain('--bundletool "${BUNDLETOOL_JAR}"');
    expect(build).toContain('-PreactNativeArchitectures=arm64-v8a');
  });

  it('runs when its own release configuration changes', async () => {
    const workflow = await readFile(workflowPath, 'utf8');

    expect(workflow).toContain("- '.github/workflows/android-release.yml'");
  });
});
