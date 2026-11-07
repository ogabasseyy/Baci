// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('prepares a safe handoff in Node without ambient browser globals', () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-release-test-'));
  const input = join(directory, 'handoff.json');
  const output = join(directory, 'payload.json');
  try {
    const origin = 'https://cdn.ogabassey.com';
    writeFileSync(
      input,
      JSON.stringify({
        schema_version: 'baci-blog-review-handoff/v1',
        title: 'Baci comparison',
        slug: 'baci-comparison',
        content_html: '<p>Reviewed article</p><script>alert(1)</script>',
        featured_image: {
          url: `${origin}/media/platform/blog/cover.webp`,
          alt: 'Reviewed illustration',
          width: 1200,
          height: 675,
          variants: {
            landscape_16x9: `${origin}/media/platform/blog/cover/landscape_16x9.webp`,
          },
        },
      })
    );
    const require = createRequire(import.meta.url);
    execFileSync(
      process.execPath,
      [
        require.resolve('tsx/cli'),
        fileURLToPath(
          new URL('./prepare-platform-blog-release-cli.ts', import.meta.url)
        ),
        input,
        output,
      ],
      { cwd: fileURLToPath(new URL('../../', import.meta.url)) }
    );
    const payload = JSON.parse(readFileSync(output, 'utf8'));
    expect(payload.status).toBe('published');
    expect(payload.content).toBe('<p>Reviewed article</p>');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
