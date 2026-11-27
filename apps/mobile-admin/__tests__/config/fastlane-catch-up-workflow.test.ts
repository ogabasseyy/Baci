// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const fastlaneDir = resolve(here, '../../fastlane');
const workflowsDir = resolve(here, '../../../../.github/workflows');

// Comments describe what the code must not do, so they are ignored.
const withoutComments = (text: string) => text.replace(/^\s*#.*$/gm, '');
const read = (path: string) => withoutComments(readFileSync(path, 'utf8'));

const fastfile = read(resolve(fastlaneDir, 'Fastfile'));
const catchUp = read(resolve(workflowsDir, 'ios-admin-catch-up.yml'));
const release = read(resolve(workflowsDir, 'ios-release.yml'));

const catchUpLane = read(resolve(fastlaneDir, 'catch_up_lane.rb'));

// The shell script of one named workflow step.
function script(workflow: string, step: string) {
  const start = workflow.indexOf(`- name: ${step}\n`);
  expect(start).toBeGreaterThan(-1);
  const body = workflow.slice(start).split(/\n {6}- name: /)[0];
  return body.slice(body.indexOf('run: |')).trim();
}

const value = (workflow: string, key: string) =>
  workflow.match(new RegExp(`^ {2}${key}: '(.+)'$`, 'm'))?.[1];

describe('admin iOS catch-up lane', () => {
  it('loads its helpers with fastlane import', () => {
    expect(fastfile).toContain('import("main_release_runs.rb")');
    expect(fastfile).toContain('import("catch_up_candidate.rb")');
    expect(fastfile).toContain('import("catch_up_lane.rb")');
  });

  it('stops quietly on a held slot before choosing anything', () => {
    const guard = catchUpLane.indexOf(
      'next if pending_review_blocks_submission?(app_id: BUNDLE_ID, announce: false)'
    );
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(catchUpLane.indexOf('catch_up_candidate('));
  });

  it('sends through the normal submit lane, so notes are handled the same', () => {
    expect(catchUpLane).toContain(
      'ENV["SUBMIT_BUILD_NUMBER"] = build.build_number'
    );
    expect(catchUpLane).toContain(
      'ENV["SUBMIT_APP_VERSION"] = build.app_version'
    );
    expect(catchUpLane).toMatch(/^\s*submit$/m);
    expect(catchUpLane).not.toContain('deliver(');
    expect(catchUpLane).not.toContain('build_app');
  });

  it('never withdraws or cancels anything', () => {
    const sources = readdirSync(fastlaneDir).filter((file) =>
      /^Fastfile$|\.rb$/.test(file)
    );
    expect(sources).toContain('catch_up_lane.rb');
    for (const file of sources) {
      const code = read(resolve(fastlaneDir, file));
      expect(code).not.toMatch(
        /reject_if_possible: true|cancel_submission|reject_version|\.reject!/
      );
    }
  });
});

describe('admin iOS catch-up workflow', () => {
  it('runs on a schedule or by hand, and never builds', () => {
    expect(catchUp).toMatch(/^ {2}schedule:\n {4}- cron: '/m);
    expect(catchUp).toContain('workflow_dispatch:');
    expect(catchUp).not.toMatch(/^ {2}(push|pull_request):/m);
    expect(catchUp).toContain('bundle exec fastlane ios catch_up');
    expect(catchUp).not.toMatch(
      /expo prebuild|pod install|fastlane ios release|pnpm|upload-app/
    );
  });

  it('holds the App Store key only for code on main', () => {
    expect(catchUp).toContain("if: github.ref == 'refs/heads/main'");
    expect(catchUp).toContain('persist-credentials: false');
    expect(catchUp).toContain('bundler-cache: false');
    expect(catchUp).toMatch(
      /^permissions:\n {2}contents: read\n {2}actions: read$/m
    );
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub expression
    expect(catchUp).toContain('GITHUB_TOKEN: ${{ github.token }}');
  });

  it('cannot cancel or be cancelled by a release build', () => {
    expect(catchUp).toMatch(
      /^concurrency:\n {2}group: ios-admin-catch-up\n {2}cancel-in-progress: false$/m
    );
    expect(release).toContain('group: ios-release-');
  });

  it('writes the same release notes as a normal release', () => {
    expect(script(catchUp, 'Resolve release notes')).toBe(
      script(release, 'Resolve release notes')
    );
    expect(catchUp).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub expression
      'WORKFLOW_NOTES: ${{ vars.IOS_ADMIN_RELEASE_NOTES }}'
    );
    // Neither overrides the review notes, so both use the Fastfile default.
    expect(catchUp).not.toContain('IOS_REVIEW_NOTES');
    expect(release).not.toContain('IOS_REVIEW_NOTES');
  });

  it('maps build numbers to runs the way the release workflow numbers them', () => {
    expect(value(catchUp, 'BUILD_NUMBER_BASE')).toBe(
      value(release, 'BUILD_NUMBER_BASE')
    );
    expect(release).toContain(
      'BUILD_NUMBER=$(( GH_RUN_NUMBER + BUILD_NUMBER_BASE ))'
    );
    // The version a build is matched on, beside its number.
    expect(release).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell variables
      'echo "IOS_APP_VERSION=${APP_VERSION_MAJOR_MINOR}.$BUILD_NUMBER"'
    );
    // The step whose success proves a main run uploaded its build.
    const uploadStep = read(resolve(fastlaneDir, 'main_release_runs.rb')).match(
      /RELEASE_UPLOAD_STEP = "(.+)"/
    )?.[1];
    expect(uploadStep).toBeDefined();
    expect(release).toContain(`- name: ${uploadStep}\n`);
  });
});
