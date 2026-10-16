import { describe, expect, it } from 'vitest';
import {
  goodSlot,
  mount,
  pilotImg,
} from './merchant-image-pilot-readiness-checks-fixtures.mjs';

describe('merchant-image-pilot-readiness-checks-fixtures', () => {
  it('exports consistent shared scan fixtures for readiness checks', () => {
    expect(mount.binding).toBe('merchant/logo-a');
    expect(mount.slotId).toBe('header-logo');
    expect(pilotImg.complete).toBe(true);
    expect(pilotImg.currentSrc).toContain(mount.generationId);
    expect(goodSlot.binding).toBe(mount.binding);
    expect(goodSlot.slotId).toBe(mount.slotId);
    expect(goodSlot.img).toBe(pilotImg);
  });
});
