import { describe, expect, it } from 'vitest';
import { buildDescriptionKeySpecs } from './build-description-key-specs';

describe('buildDescriptionKeySpecs', () => {
  it('extracts a key-spec table from the product description', () => {
    expect(
      buildDescriptionKeySpecs(
        '<h2>Key Specs</h2><table><tr><th>Display</th><td>6.8 inches</td></tr></table>'
      )
    ).toEqual([
      {
        category: 'Key Specs',
        items: [{ label: 'Display', value: '6.8 inches' }],
      },
    ]);
  });

  it('extracts a key-spec table when the table tag is uppercase', () => {
    expect(
      buildDescriptionKeySpecs(
        '<h2>Key Specs</h2><TABLE><TR><TH>Display</TH><TD>6.8 inches</TD></TR></TABLE>'
      )
    ).toEqual([
      {
        category: 'Key Specs',
        items: [{ label: 'Display', value: '6.8 inches' }],
      },
    ]);
  });

  it('ignores non-specification tables without a Key Specs heading', () => {
    expect(
      buildDescriptionKeySpecs(
        '<h2>Size Chart</h2><table><tr><th>Size</th><th>Chest</th></tr><tr><td>S</td><td>36 in</td></tr></table>'
      )
    ).toEqual([]);
  });

  it('ignores tables from later sections after a Key Specs heading', () => {
    expect(
      buildDescriptionKeySpecs(
        '<h2>Key Specs</h2><ul><li>48MP main camera</li></ul><h2>Size chart</h2><table><tr><th>Size</th><th>Chest</th></tr><tr><td>S</td><td>36 in</td></tr></table>'
      )
    ).toEqual([]);
  });

  it('ignores descriptions without a complete table', () => {
    expect(buildDescriptionKeySpecs('<p>No key table</p>')).toEqual([]);
    expect(
      buildDescriptionKeySpecs(
        '<h2>Key Specs</h2><table><tr><td>Display</td></tr></table>'
      )
    ).toEqual([]);
  });
});
