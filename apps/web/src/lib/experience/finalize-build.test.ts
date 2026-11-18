import { expect, it } from 'vitest';
import { verifyIndependentBuilds } from './finalize-build';

it('requires independent matching outputs and rendered proof before promotion', () => {
  const a = { javascript: 'export{}', css: '', digest: 'x', imports: [] };
  expect(() =>
    verifyIndependentBuilds(a, { ...a, css: 'changed' }, { status: 'passed' })
  ).toThrow('BUILD_FAILED');
  expect(() => verifyIndependentBuilds(a, a, { success: true })).toThrow(
    'BUILD_FAILED'
  );
});
