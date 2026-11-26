import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const fastlaneDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../fastlane'
);
const code = readFileSync(resolve(fastlaneDir, 'Fastfile'), 'utf8').replace(
  /^\s*#.*$/gm,
  ''
);
const submitLane = code.slice(code.indexOf('lane :submit do'));

// Runs the real Ruby guard against a stubbed App Store Connect.
function runGuard(state: string | null) {
  const script = `
    module UI
      def self.user_error!(message); puts "FAIL #{message}"; exit 0; end
      def self.important(message); puts message; end
    end
    module Spaceship
      module ConnectAPI
        module Platform; IOS = "IOS"; end
        Submission = Struct.new(:state)
        class App
          def self.find(_id); new; end
          def get_in_progress_review_submission(platform:)
            state = ${state ? `"${state}"` : 'nil'}
            state && Submission.new(state)
          end
        end
      end
    end
    require ${JSON.stringify(resolve(fastlaneDir, 'pending_review_guard'))}
    puts "blocked=#{pending_review_blocks_submission?(app_id: "id")}"
  `;
  return execFileSync('ruby', ['-e', script], { encoding: 'utf8' });
}

describe('admin iOS submit lane', () => {
  it('bugfix: never withdraws the submission already with App Review', () => {
    expect(submitLane).toContain('reject_if_possible: false');
    expect(code).not.toContain('reject_if_possible: true');
  });

  it('checks for an open submission before editing the store version', () => {
    const guard = submitLane.indexOf(
      'next if pending_review_blocks_submission?'
    );
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(submitLane.indexOf('set_changelog('));
  });

  it('submits when nothing is waiting on Apple', () => {
    expect(runGuard(null)).toContain('blocked=false');
  });

  it.each([
    'WAITING_FOR_REVIEW',
    'IN_REVIEW',
  ])('skips with a visible warning while a version is %s', (state) => {
    const output = runGuard(state);
    expect(output).toContain('::warning title=Not submitted to App Review::');
    expect(output).toContain('blocked=true');
  });

  it('fails the run when Apple rejected the last submission', () => {
    expect(runGuard('UNRESOLVED_ISSUES')).toContain(
      'FAIL Apple rejected the last submission'
    );
  });
});
