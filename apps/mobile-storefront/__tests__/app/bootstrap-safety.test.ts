import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('app bootstrap safety', () => {
  it('uses the optional gesture-handler wrapper in the root startup modules', () => {
    const rootLayoutNavSource = readFileSync(
      path.resolve(__dirname, '../../components/navigation/RootLayoutNav.tsx'),
      'utf-8'
    );
    const drawerMenuSource = readFileSync(
      path.resolve(__dirname, '../../components/navigation/DrawerMenu.tsx'),
      'utf-8'
    );
    const chatWidgetSource = readFileSync(
      path.resolve(__dirname, '../../components/chat/ChatWidget.tsx'),
      'utf-8'
    );

    expect(rootLayoutNavSource).toContain(
      "from '@/lib/optional-gesture-handler'"
    );
    expect(drawerMenuSource).toContain("from '@/lib/optional-gesture-handler'");
    expect(chatWidgetSource).toContain("from '@/lib/optional-gesture-handler'");
  });

  it('starts storefront query prefetch before storage hydration work', () => {
    const rootLayoutSource = readFileSync(
      path.resolve(__dirname, '../../app/_layout.tsx'),
      'utf-8'
    );

    expect(rootLayoutSource).toContain(
      "import { prefetchStartupStorefrontData } from '@/lib/startup-storefront-prefetch';"
    );
    expect(rootLayoutSource).toContain('void prefetchStartupStorefrontData();');
    expect(rootLayoutSource).toContain(
      'await initializeStorage(DEFAULT_SYNC_STORAGE_KEYS);'
    );
    expect(
      rootLayoutSource.indexOf('void prefetchStartupStorefrontData();')
    ).toBeLessThan(
      rootLayoutSource.indexOf(
        'await initializeStorage(DEFAULT_SYNC_STORAGE_KEYS);'
      )
    );
  });
});
