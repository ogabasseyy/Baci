import { expect, it } from 'vitest';
import type { StorefrontAgentUiEvent } from '@/schemas/storefront-agent-ui-contract';
import { chatHistoryContent } from './chat-history-content';

const event: StorefrontAgentUiEvent = {
  type: 'present_products',
  intent: 'discover',
  title: 'Phones',
  products: ['first', 'second'].map((id) => ({
    id,
    name: `${id} phone`,
    brand: null,
    category: null,
    description: null,
    hasVariants: false,
    imageUrl: null,
    manageStock: false,
    price: 10,
    slug: null,
    stock: null,
  })),
};

it('budgets long assistant text and escaped card references within 10000 characters', () => {
  const richEvent = {
    ...event,
    products: Array.from({ length: 6 }, (_, index) => ({
      ...event.products[0], id: `product-${index}`, name: '"\\'.repeat(100),
    })),
  };
  const content = chatHistoryContent({
    role: 'model', text: 'x'.repeat(10_000),
    uiEvents: [richEvent, richEvent, richEvent],
  });
  expect(content.length).toBeLessThanOrEqual(10_000);
  const references = content.slice(content.indexOf('[[{'));
  expect(JSON.parse(references)).toHaveLength(3);
  expect(JSON.parse(references)[0][0]).toEqual({
    id: 'product-0', name: '"\\'.repeat(100),
  });
});

it('bounds a long plain assistant response without card references', () => {
  expect(chatHistoryContent({ role: 'model', text: 'x'.repeat(100_000) }))
    .toHaveLength(10_000);
});

it('drops trailing references when JSON control-character escaping exhausts the budget', () => {
  const richEvent = { ...event, products: Array.from({ length: 6 }, (_, index) => ({
    ...event.products[0], id: `id-${index}`, name: `A${'\u0001'.repeat(199)}`,
  })) };
  const content = chatHistoryContent({ role: 'model', text: 'Options', uiEvents: [richEvent, richEvent, richEvent] });
  expect(content.length).toBeLessThanOrEqual(10_000);
  const groups = JSON.parse(content.slice(content.indexOf('[[{')));
  expect(groups[0]).toHaveLength(6);
  expect(groups.flat().length).toBeLessThan(18);
});

it('preserves ordered references from presentation-only replies', () => {
  const content = chatHistoryContent({
    role: 'model',
    text: 'Options',
    uiEvents: [event],
  });
  expect(content).toContain(
    JSON.stringify([
      [
        { id: 'first', name: 'first phone' },
        { id: 'second', name: 'second phone' },
      ],
    ])
  );
  expect(content).not.toContain('price');
});

it('bounds history cards to three groups and ignores invalid events', () => {
  const content = chatHistoryContent({
    role: 'model',
    text: 'Options',
    uiEvents: [event, event, event, { ...event, title: 'overflow' }],
  });
  expect(content.match(/first phone/g)).toHaveLength(3);
  expect(
    chatHistoryContent({
      role: 'model',
      text: 'Options',
      uiEvents: [{ ...event, products: [] }],
    })
  ).toBe('Options');
});

it('leaves user messages and plain assistant replies unchanged', () => {
  expect(
    chatHistoryContent({ role: 'user', text: 'Hi', uiEvents: [event] })
  ).toBe('Hi');
  expect(chatHistoryContent({ role: 'model', text: 'Hi' })).toBe('Hi');
});
