// @vitest-environment node
import { expect, it } from 'vitest';
import { createPreviewHtml } from './build.mjs';

it('builds a bounded self-contained standard widget without editor, Next, DB or tenant fixtures', async () => {
  const bundle = await createPreviewHtml();
  expect(bundle.raw).toBeLessThan(3 * 1024 * 1024);
  expect(bundle.gzip).toBeLessThan(1024 * 1024);
  expect(bundle.inputs.join('\n')).not.toMatch(
    /next\/|supabase\/|components\/builder\/|builder-preview-spike\/|fixtures/
  );
  expect(bundle.html).not.toMatch(
    /localStorage|sessionStorage|window\.openai|fixture-camera/
  );
  expect(bundle.html).toContain('id="root"');
});
