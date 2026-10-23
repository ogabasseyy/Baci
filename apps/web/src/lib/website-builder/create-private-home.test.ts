import { describe, expect, it } from 'vitest';
import { portableHomeSchema } from '@/schemas/portable-storefront';
import { createPrivateHome } from './create-private-home';

describe('private store starter', () => {
  it('uses the certified renderer and deterministic config without publication', () => {
    const home = createPrivateHome('My Store');
    expect(portableHomeSchema.parse(home)).toEqual(home);
    expect(home.root.props.title).toBe('My Store');
    expect(createPrivateHome('My Store')).toEqual(home);
    expect(JSON.stringify(home)).not.toContain('published');
  });
});
