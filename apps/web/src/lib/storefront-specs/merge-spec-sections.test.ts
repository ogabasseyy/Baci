import { describe, expect, it } from 'vitest';
import { mergeSpecSections } from './merge-spec-sections';

describe('mergeSpecSections', () => {
  it('keeps localized sections separate when ASCII normalization is empty', () => {
    expect(
      mergeSpecSections([
        { category: '外观', items: [{ label: '重量', value: '450g' }] },
        { category: '显示', items: [{ label: '尺寸', value: '6.7 inches' }] },
      ])
    ).toEqual([
      { category: '外观', items: [{ label: '重量', value: '450g' }] },
      { category: '显示', items: [{ label: '尺寸', value: '6.7 inches' }] },
    ]);
  });

  it('keeps same-label facts in separate sections while stored values win ties', () => {
    expect(
      mergeSpecSections(
        [
          {
            category: 'Display',
            items: [{ label: 'Protection', value: 'Gorilla Glass Victus 2' }],
          },
          {
            category: 'Body',
            items: [{ label: 'Protection', value: 'IP68' }],
          },
        ],
        [
          {
            category: 'Display',
            items: [{ label: 'Protection', value: 'Ceramic Shield' }],
          },
          {
            category: 'Body',
            items: [{ label: 'Protection', value: 'IP69' }],
          },
        ]
      )
    ).toEqual([
      {
        category: 'Display',
        items: [{ label: 'Protection', value: 'Gorilla Glass Victus 2' }],
      },
      {
        category: 'Body',
        items: [{ label: 'Protection', value: 'IP68' }],
      },
    ]);
  });

  it('does not repeat stored fields from a generic derived section', () => {
    expect(
      mergeSpecSections(
        [{ category: 'Memory', items: [{ label: 'RAM', value: '8GB' }] }],
        [
          {
            category: 'Key Specs',
            items: [
              { label: 'ram', value: '16GB' },
              { label: 'Camera', value: '50MP' },
            ],
          },
        ]
      )
    ).toEqual([
      { category: 'Memory', items: [{ label: 'RAM', value: '8GB' }] },
      { category: 'Key Specs', items: [{ label: 'Camera', value: '50MP' }] },
    ]);
  });

  it('keeps section context when deduplicating generic key specs', () => {
    expect(
      mergeSpecSections(
        [
          {
            category: 'Imaging',
            items: [{ label: 'Resolution', value: '12MP' }],
          },
        ],
        [
          {
            category: 'Key Specs',
            items: [{ label: 'Display Resolution', value: '4K' }],
          },
        ]
      )
    ).toEqual([
      {
        category: 'Imaging',
        items: [{ label: 'Resolution', value: '12MP' }],
      },
      {
        category: 'Key Specs',
        items: [{ label: 'Display Resolution', value: '4K' }],
      },
    ]);
  });

  it('retains a unique generic fact when stored sections have legitimate same-label facts', () => {
    expect(
      mergeSpecSections(
        [
          {
            category: 'Display',
            items: [{ label: 'Protection', value: 'Gorilla Glass' }],
          },
          {
            category: 'Body',
            items: [{ label: 'Protection', value: 'IP68' }],
          },
        ],
        [
          {
            category: 'Key Specs',
            items: [{ label: 'Camera', value: '50MP' }],
          },
        ]
      )
    ).toEqual([
      {
        category: 'Display',
        items: [{ label: 'Protection', value: 'Gorilla Glass' }],
      },
      {
        category: 'Body',
        items: [{ label: 'Protection', value: 'IP68' }],
      },
      {
        category: 'Key Specs',
        items: [{ label: 'Camera', value: '50MP' }],
      },
    ]);
  });
});
