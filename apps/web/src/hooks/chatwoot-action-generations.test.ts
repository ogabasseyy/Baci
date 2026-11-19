import { describe, expect, it } from 'vitest';
import { createChatwootActionGenerations } from './chatwoot-action-generations';

describe('createChatwootActionGenerations', () => {
  it('lets a newer cart action supersede an older one', () => {
    const generations = createChatwootActionGenerations();
    const first = generations.startAction(false);
    const second = generations.startAction(false);
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });

  it('keeps overlapping product lookups independently current', () => {
    const generations = createChatwootActionGenerations();
    const first = generations.startAction(true);
    const second = generations.startAction(true);
    generations.startAction(false);
    expect(first.isCurrent()).toBe(true);
    expect(second.isCurrent()).toBe(true);
  });

  it('does not let a product lookup supersede a pending cart action', () => {
    const generations = createChatwootActionGenerations();
    const cart = generations.startAction(false);
    generations.startAction(true);
    expect(cart.isCurrent()).toBe(true);
  });

  it('invalidates every action when a new context begins', () => {
    const generations = createChatwootActionGenerations();
    const product = generations.startAction(true);
    const cart = generations.startAction(false);
    generations.beginContext();
    expect(product.isCurrent()).toBe(false);
    expect(cart.isCurrent()).toBe(false);
  });
});

describe('bugfix: a superseded cart action still applies its session renewal', () => {
  it('lets a superseded action rotate the token but not roll back a newer one', () => {
    const generations = createChatwootActionGenerations();
    const first = generations.startAction(false);
    const second = generations.startAction(false);
    expect(first.isCurrent()).toBe(false);
    expect(first.canApplyRenewal()).toBe(true);
    expect(second.canApplyRenewal()).toBe(true);
    expect(first.canApplyRenewal()).toBe(false);
  });
});
