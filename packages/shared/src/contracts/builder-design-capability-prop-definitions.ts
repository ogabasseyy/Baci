import {
  copy,
  label,
  safeLink,
} from './builder-design-capability-descriptor-factories';
import type {
  BuilderDesignProp,
  BuilderDesignProps,
} from './builder-design-capability-types';

export const headerProps: BuilderDesignProps = {
  ctaButton: {
    item: {
      properties: {
        show: { required: true, type: 'boolean' },
        text: { ...label(), required: true },
        url: { ...safeLink, required: true },
      },
    },
    type: 'object',
  },
  glassEffect: { type: 'boolean' },
  layout: {
    enum: ['logo-left-nav-center', 'logo-left-nav-right', 'logo-center'],
    type: 'enum',
  },
  navigationLinks: {
    item: {
      properties: {
        label: { ...label(), required: true },
        url: { ...safeLink, required: true },
      },
      uniqueBy: 'label',
    },
    maximumItems: 8,
    type: 'array',
  },
  paddingY: { enum: ['sm', 'md', 'lg'], type: 'enum' },
  searchRadius: { enum: ['none', 'sm', 'md', 'full'], type: 'enum' },
  searchStyle: { enum: ['outline', 'filled', 'minimal'], type: 'enum' },
  showCart: { type: 'boolean' },
  showLogo: { type: 'boolean' },
  showMenu: { type: 'boolean' },
  showSearch: { type: 'boolean' },
  sticky: { type: 'boolean' },
};

export const heroProps: BuilderDesignProps = {
  align: { default: 'center', enum: ['center', 'left', 'right'], type: 'enum' },
  ctaLink: { ...safeLink, default: '/products' },
  ctaText: { ...label('Shop now'), required: true },
  overlay: { default: false, type: 'boolean' },
  padding: {
    default: 'medium',
    enum: ['large', 'medium', 'small'],
    type: 'enum',
  },
  subtitle: { ...copy('Discover our collection.'), required: true },
  title: { ...label('Featured collection'), required: true },
};

export const featureList: BuilderDesignProp = {
  default: [{ description: 'Describe this benefit.', title: 'A benefit' }],
  item: {
    properties: {
      description: { ...copy(), required: true },
      icon: { type: 'feature-icon' },
      title: { ...label(), required: true },
    },
    uniqueBy: 'title',
  },
  maximumItems: 8,
  minimumItems: 1,
  type: 'array',
};

export const safeTextProps: BuilderDesignProps = {
  align: { default: 'left', enum: ['center', 'left', 'right'], type: 'enum' },
  content: { ...copy('Add supporting storefront copy here.'), required: true },
  title: { ...label('About us'), required: true },
};
