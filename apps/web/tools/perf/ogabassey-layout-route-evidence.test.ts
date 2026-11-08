import { expect, it } from 'vitest';
import { assertNegativeRouteEvidence } from './ogabassey-layout-route-evidence';

it('requires independent nonempty route evidence in the captured HTML', () => {
  const evidence = {
    category: 'Phones category',
    pdp: 'Fixture product',
    blog: 'Fixture article',
    generic: 'Other shop',
  };
  expect(() =>
    assertNegativeRouteEvidence(
      'category',
      '<h1>Phones category</h1>',
      evidence
    )
  ).not.toThrow();
  expect(() =>
    assertNegativeRouteEvidence('pdp', '<h1>404</h1>', evidence)
  ).toThrow(/pdp.*route evidence/i);
  expect(() =>
    assertNegativeRouteEvidence('blog', '<h1>anything</h1>', {
      ...evidence,
      blog: '',
    })
  ).toThrow(/blog.*route evidence/i);
});
