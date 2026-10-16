import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LabStoreHeader } from './lab-store-header';

describe('LabStoreHeader', () => {
  it('renders the store header landmark with storeName attribute and children', () => {
    const html = renderToStaticMarkup(
      <LabStoreHeader storeName="OgaBassey">
        <span>Lockup Slot</span>
      </LabStoreHeader>
    );
    expect(html).toContain('<header data-pilot-lab-store-header="OgaBassey">');
    expect(html).toContain('<span>Lockup Slot</span>');
  });
});
