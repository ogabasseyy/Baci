import {
  type PortableHome,
  portableHomeSchema,
} from '@/schemas/portable-storefront';
export function createPrivateHome(businessName: string): PortableHome {
  return portableHomeSchema.parse({
    root: {
      props: { rendererVersion: 'baci-home-six-v1', title: businessName },
    },
    content: [
      {
        type: 'Header',
        props: {
          id: 'header',
          navigationLinks: [{ label: 'Products', url: '/products' }],
          showLogo: true,
        },
      },
      {
        type: 'Hero',
        props: {
          id: 'hero',
          title: businessName,
          subtitle: 'Welcome to our store',
          ctaText: 'Browse products',
          ctaLink: '/products',
        },
      },
      { type: 'ProductGrid', props: { id: 'catalog', title: 'Our products' } },
      { type: 'Footer', props: { id: 'footer', copyrightText: businessName } },
    ],
  });
}
