import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Supabase replay CLI installation', () => {
  it('verifies the archive before installing both co-located executables', () => {
    const workflow = readFileSync(
      path.resolve(process.cwd(), '../../.github/workflows/ci.yml'),
      'utf8'
    );
    const verify = workflow.indexOf(
      `echo "\${SUPABASE_CLI_SHA256}  \${SUPABASE_ARCHIVE}" | sha256sum --check`
    );
    const extract = workflow.indexOf(
      `sudo tar -xz -f "\${SUPABASE_ARCHIVE}" -C /usr/local/bin supabase supabase-go`
    );
    const chmod = workflow.indexOf(
      'sudo chmod 0755 /usr/local/bin/supabase /usr/local/bin/supabase-go'
    );
    const check = workflow.indexOf('test -x /usr/local/bin/supabase-go');
    expect(verify).toBeGreaterThanOrEqual(0);
    expect(extract).toBeGreaterThan(verify);
    expect(chmod).toBeGreaterThan(extract);
    expect(check).toBeGreaterThan(chmod);
  });
});
