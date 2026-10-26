/** Synthetic authorized snapshot. No live credentials or customer information. */
export const merchant = {
  id: '10000000-0000-4000-8000-000000000001',
  slug: 'task-zero-fixture',
  business_name: 'Task Zero Fixture Limited',
  currency: 'NGN',
  template_id: 'puck',
} as const;
export const catalog = {
  merchantId: merchant.id,
  capturedAt: '2026-10-20T12:00:00.000Z',
  products: [
    {
      id: '30000000-0000-4000-8000-000000000001',
      merchant_id: merchant.id,
      name: 'Authorized fixture camera',
      price: 125000,
      image: null,
      slug: 'fixture-camera',
    },
  ],
};
export const widths = [375, 768, 1200] as const;
export const blockTypes = [
  'Header',
  'Hero',
  'Text',
  'Button',
  'Footer',
  'ProductGrid',
] as const;
export const home = {
  root: {
    props: { rendererVersion: 'baci-home-six-v1', title: 'Fixture home' },
  },
  content: [
    {
      type: 'Header',
      props: {
        id: 'header',
        navigationLinks: [{ label: 'Shop', url: '/products' }],
      },
    },
    {
      type: 'Hero',
      props: {
        id: 'hero',
        title: 'Our cameras',
        subtitle: 'A snapshot with exact shared presentation',
        ctaText: 'Shop cameras',
        ctaLink: '/products',
      },
    },
    {
      type: 'Text',
      props: {
        id: 'text',
        title: 'About us',
        content: 'Merchant supplied copy',
        align: 'left',
      },
    },
    {
      type: 'Button',
      props: { id: 'button', text: 'Explore', link: '/products' },
    },
    {
      type: 'ProductGrid',
      props: {
        id: 'products',
        title: 'Featured Products',
        columns: 3,
        limit: 6,
      },
    },
    {
      type: 'Footer',
      props: {
        id: 'footer',
        copyrightText: '© Fixture. All rights reserved.',
        quickLinks: [{ label: 'Contact', url: '/contact' }],
      },
    },
  ],
  theme: {
    colors: {
      primary: '#6d28d9',
      background: '#faf5ff',
      foreground: '#24143d',
      button: { primary: { background: '#6d28d9', text: '#ffffff' } },
    },
  },
};
