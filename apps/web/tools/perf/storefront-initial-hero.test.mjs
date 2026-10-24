import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectInitialHero } from './storefront-initial-hero.mjs';

test('rejects a real hero delivered in a hidden reveal segment outside main', () => {
  const result = inspectInitialHero(
    '<main><template id="B:6"></template></main><div hidden id="S:6"><h1>Store</h1><section data-ogabassey-hero>Real hero</section></div>'
  );
  assert.equal(result.pass, false);
  assert.deepEqual(result.hiddenHeroOwners, ['S:6']);
});
test('rejects a hero nested in main when the shared frame itself is hidden', () => {
  assert.equal(
    inspectInitialHero(
      '<div hidden id="S:4"><main><h1>Store</h1><section data-ogabassey-hero>Real hero</section></main></div>'
    ).pass,
    false
  );
});
test('accepts one visible hero and heading while below-fold content streams', () => {
  assert.equal(
    inspectInitialHero(
      '<main><h1>Store</h1><section data-ogabassey-hero>Real hero</section><template id="B:7"></template></main><div hidden id="S:7">Products</div>'
    ).pass,
    true
  );
});
test('rejects duplicate heroes and hidden document headings', () => {
  assert.equal(
    inspectInitialHero(
      '<main><h1>Store</h1><i data-ogabassey-hero></i><i data-ogabassey-hero></i></main>'
    ).pass,
    false
  );
  assert.equal(
    inspectInitialHero(
      '<main><i data-ogabassey-hero></i></main><div hidden><h1>Store</h1></div>'
    ).pass,
    false
  );
});
