import assert from 'node:assert/strict';
import { test } from 'vitest';
import { inspectInitialHero } from './storefront-initial-hero.mjs';

test('rejects a real hero delivered in a hidden reveal segment outside main', () => {
  const result = inspectInitialHero(
    '<main><template id="B:6"></template></main><div hidden id="S:6"><h1>Store</h1><section data-ogabassey-hero><h2>Phone</h2><img alt="Phone" src="/phone.avif" /></section></div>'
  );
  assert.equal(result.pass, false);
  assert.deepEqual(result.hiddenHeroOwners, ['S:6']);
});
test('rejects a hero nested in main when the shared frame itself is hidden', () => {
  assert.equal(
    inspectInitialHero(
      '<div hidden id="S:4"><main><h1>Store</h1><section data-ogabassey-hero><h2>Phone</h2><img alt="Phone" src="/phone.avif" /></section></main></div>'
    ).pass,
    false
  );
});
test('rejects a visible hero wrapper when its first-slide content or image is streamed in a hidden segment', () => {
  const emptyWrapper = inspectInitialHero(
    '<main><h1>Store</h1><div data-ogabassey-hero></div></main>'
  );
  assert.equal(emptyWrapper.pass, false);
  assert.equal(emptyWrapper.visibleHeroCount, 0);

  const streamedImage = inspectInitialHero(
    '<main><h1>Store</h1><section data-ogabassey-hero><div data-ogabassey-mobile-hero><h2>Phone</h2><template id="B:6"></template></div></section></main><div hidden id="S:6"><picture><img alt="Phone" fetchpriority="high" loading="eager" src="/phone.avif" /></picture></div>'
  );
  assert.equal(streamedImage.pass, false);
  assert.equal(streamedImage.visibleHeroCount, 0);
  assert.deepEqual(streamedImage.hiddenHeroOwners, ['S:6']);

  const streamedSlide = inspectInitialHero(
    '<main><h1>Store</h1><section data-ogabassey-hero><template id="B:5"></template></section></main><div hidden id="S:5"><div data-ogabassey-mobile-hero><h2>Phone</h2><img alt="Phone" src="/phone.avif" /></div></div>'
  );
  assert.equal(streamedSlide.pass, false);
  assert.equal(streamedSlide.visibleHeroCount, 0);
  assert.deepEqual(streamedSlide.hiddenHeroOwners, ['S:5']);
});
test('accepts one visible hero with first-slide content and image while below-fold content streams', () => {
  const result = inspectInitialHero(
    '<main><h1>Store</h1><section data-ogabassey-hero><div data-ogabassey-mobile-hero><h2>Phone</h2><img alt="Phone" fetchpriority="high" loading="eager" src="/phone.avif" /></div></section><template id="B:7"></template></main><div hidden id="S:7"><h2>Products</h2><img alt="Card" src="/card.avif" /></div>'
  );
  assert.equal(result.pass, true);
  assert.deepEqual(result.hiddenHeroOwners, [null]);
});
test('rejects duplicate heroes and hidden document headings', () => {
  assert.equal(
    inspectInitialHero(
      '<main><h1>Store</h1><i data-ogabassey-hero><h2>A</h2><img alt="A" src="/a.avif" /></i><i data-ogabassey-hero><h2>B</h2><img alt="B" src="/b.avif" /></i></main>'
    ).pass,
    false
  );
  assert.equal(
    inspectInitialHero(
      '<main><i data-ogabassey-hero><h2>A</h2><img alt="A" src="/a.avif" /></i></main><div hidden><h1>Store</h1></div>'
    ).pass,
    false
  );
});
