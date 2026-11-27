// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const fastlaneDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../fastlane'
);

// Calls the real github_api with Net::HTTP answering `status` and `body`.
function runGithubRead(status: string, body: string) {
  const script = `
    module UI
      def self.user_error!(message); puts "FAIL #{message}"; exit 0; end
    end
    require ${JSON.stringify(resolve(fastlaneDir, 'main_release_runs'))}
    Reply = Struct.new(:code, :body)
    class Net::HTTP
      def self.start(host, port, use_ssl:)
        raise "must use TLS to api.github.com" unless use_ssl && host == "api.github.com"
        http = Object.new
        def http.request(request)
          puts "authorised=#{request['Authorization'] == 'Bearer test-token'}"
          # Net::HTTP hands bodies over as raw bytes.
          Reply.new(ENV.fetch("STATUS"), ENV.fetch("BODY").dup.force_encoding("BINARY"))
        end
        yield http
      end
    end
    puts "title=#{github_api("actions/runs/1/jobs")["title"].bytesize}"
  `;
  return execFileSync('ruby', ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      LC_ALL: 'C',
      STATUS: status,
      BODY: body,
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_TOKEN: 'test-token',
    },
  });
}

describe('admin iOS catch-up: reading GitHub', () => {
  it('reads a reply with non-ASCII commit titles', () => {
    // An em dash is three bytes, as in many commit titles.
    const output = runGithubRead('200', '{"title":"a \u2014 b"}');
    expect(output).toContain('title=7');
  });

  it('reports a refused request without printing the token', () => {
    const output = runGithubRead('403', 'secret body');
    expect(output).toContain('authorised=true');
    expect(output).toContain(
      'FAIL GitHub returned 403 for actions/runs/1/jobs'
    );
    expect(output).not.toContain('test-token');
    expect(output).not.toContain('secret body');
  });
});
