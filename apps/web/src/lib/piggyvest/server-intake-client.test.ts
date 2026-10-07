import { describe, expect, it, vi } from 'vitest';
import { createPiggyvestIntakeServiceClient } from './server-intake-client';

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn((sentinel: string) => ({ sentinel })),
}));

import { createServiceClient } from '@/lib/supabase/service';

describe('createPiggyvestIntakeServiceClient', () => {
  it('constructs the branded intake client', () => {
    expect(createPiggyvestIntakeServiceClient()).toEqual({
      sentinel: 'piggyvest-intake',
    });
    expect(createServiceClient).toHaveBeenCalledWith('piggyvest-intake');
  });
});
