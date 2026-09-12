import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('floating Admin tab scroll-to-top wiring', () => {
  it.each([
    ['Home', 'app/(admin)/(tabs)/index.tsx'],
    ['Menu', 'app/(admin)/(tabs)/menu.tsx'],
    ['Orders', 'components/orders-screen/OrdersScreen.tsx'],
    ['Customers', 'app/(admin)/(tabs)/customers.tsx'],
    ['Products', 'app/(admin)/(tabs)/products.tsx'],
  ])('registers the active %s vertical surface with scroll-to-top handling', (_label, path) => {
    const file = source(path);
    expect(file).toContain('useAdminTabScrollToTop');
    expect(file).toContain('scrollRef');
  });

  it('threads list refs through each extracted vertical list component', () => {
    for (const path of [
      'components/orders-screen/OrdersList.tsx',
      'components/customers/FollowUpQueueList.tsx',
      'components/product/ProductsListShell.tsx',
    ]) {
      const file = source(path);
      expect(file).toContain('scrollRef');
      expect(file).toContain('ref={scrollRef as never}');
    }

    expect(
      source('components/orders-screen/OrdersScrollSurface.tsx')
    ).toContain('scrollRef={scrollRef}');
    expect(source('components/product/ProductsTabPage.tsx')).toContain(
      'scrollRef={scrollRef}'
    );
  });

  it('scrolls the active route after the floating bar recognizes a double tap', () => {
    const file = source('components/navigation/AdminFloatingTabBar.tsx');
    expect(file).toContain('recordAdminTabPress');
    expect(file).toContain('scrollAdminTabToTop(route.name)');
  });
});
