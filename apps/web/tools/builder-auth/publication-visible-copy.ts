import type { PortableHome } from '../../src/schemas/portable-storefront';
export interface PublicationCopyRequirement {
  text: string;
  role?: 'heading' | 'link';
}
export function normalizePublicationCopy(text: string) {
  return text.replace(/\s+/gu, ' ').trim();
}
/** Exhaustive: every supported block's approved visible copy is checked in its own block. */
export function publicationVisibleCopy(
  block: PortableHome['content'][number]
): PublicationCopyRequirement[] {
  switch (block.type) {
    case 'Header':
      return block.props.navigationLinks.map((link) => ({
        text: link.label,
        role: 'link',
      }));
    case 'Hero':
      return [
        { text: block.props.title, role: 'heading' },
        { text: block.props.subtitle },
        { text: block.props.ctaText, role: 'link' },
      ];
    case 'Text':
      return [
        { text: block.props.title, role: 'heading' },
        { text: block.props.content },
      ];
    case 'Button':
      return [{ text: block.props.text, role: 'link' }];
    case 'Footer':
      return [
        { text: block.props.copyrightText },
        ...(block.props.quickLinks.length
          ? [
              { text: block.props.quickLinksLabel, role: 'heading' as const },
              ...block.props.quickLinks.map((link) => ({
                text: link.label,
                role: 'link' as const,
              })),
            ]
          : []),
      ];
    case 'ProductGrid':
      return [{ text: block.props.title, role: 'heading' }];
  }
}
