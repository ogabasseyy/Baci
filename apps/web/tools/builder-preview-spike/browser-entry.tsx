import { createRoot } from 'react-dom/client';
import { PublicPortableHome } from '../../src/components/storefront/portable/public-portable-home';
import { catalog, home, merchant } from './fixtures';
import { mountPortablePreview } from './widget-entry';

const element = document.getElementById('root');
if (!element) throw new Error('Missing preview mount');
if (location.pathname === '/public')
  createRoot(element).render(
    <PublicPortableHome config={home} merchant={merchant} basePath="" />
  );
else mountPortablePreview(element, { config: home, merchant, catalog });
