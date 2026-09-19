import { describe, expect, it } from 'vitest';
import {
  loadDefaultInteractiveCardModule,
  loadDefaultInteractionBindingsModule,
} from './home-product-grid-interaction-loaders';

describe('home-product-grid-interaction-loaders', () => {
  it('resolves the deferred interactive modules', async () => {
    const [bindingsModule, cardModule] = await Promise.all([
      loadDefaultInteractionBindingsModule(),
      loadDefaultInteractiveCardModule(),
    ]);

    expect(bindingsModule.ProductGridInteractionBindings).toBeDefined();
    expect(cardModule.ProductGridItem).toBeDefined();
  });
});
