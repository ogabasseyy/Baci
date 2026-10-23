import { z } from 'zod';
import { defaultTheme } from '@/lib/theme-config';
import { portableSameStorePathSchema } from './portable-same-store-path';

const copy = z.string().max(4000);
const asset = z
  .url()
  .refine((value) => value.startsWith('https://'), 'HTTPS asset required');
const link = z
  .object({
    label: copy,
    url: portableSameStorePathSchema,
  })
  .strict();
const align = z.enum(['left', 'center', 'right']).default('center');
const id = z.string().min(1).max(100);
const block = <T extends string, P extends z.ZodRawShape>(type: T, props: P) =>
  z
    .object({
      type: z.literal(type),
      props: z.object({ id, ...props }).strict(),
    })
    .strict();

/** Theme overrides use the existing token tree and reject unknown design fields. */
function partialThemeSchema(value: unknown): z.ZodType {
  if (typeof value === 'string')
    return z
      .string()
      .min(1)
      .max(500)
      .regex(/^[^;{}<>]*$/);
  if (typeof value === 'number') return z.number().finite();
  if (typeof value === 'object' && value !== null && !Array.isArray(value))
    return z
      .object(
        Object.fromEntries(
          Object.entries(value).map(([key, child]) => [
            key,
            partialThemeSchema(child).optional(),
          ])
        )
      )
      .strict();
  return z.never();
}
const themeOverrides = partialThemeSchema(defaultTheme);

/** Explicit opt-in. Legacy Puck is not represented by this capability version. */
export const PORTABLE_RENDERER_VERSION = 'baci-home-six-v1' as const;
export const portableHomeSchema = z
  .object({
    root: z
      .object({
        props: z
          .object({
            rendererVersion: z.literal(PORTABLE_RENDERER_VERSION),
            title: copy,
          })
          .strict(),
      })
      .strict(),
    content: z
      .array(
        z.discriminatedUnion('type', [
          block('Header', {
            navigationLinks: z.array(link).max(8).default([]),
            showLogo: z.boolean().default(true),
          }),
          block('Hero', {
            title: copy,
            subtitle: copy.default(''),
            backgroundImage: asset.optional(),
            overlay: z.boolean().default(false),
            ctaText: copy.default(''),
            ctaLink: portableSameStorePathSchema.default('/products'),
            align,
            padding: z.enum(['small', 'medium', 'large']).default('medium'),
          }),
          block('Text', { title: copy.default(''), content: copy, align }),
          block('Button', {
            text: copy,
            link: portableSameStorePathSchema,
            align,
            size: z.enum(['sm', 'default', 'lg']).default('default'),
            variant: z.enum(['primary', 'accent']).default('primary'),
          }),
          block('Footer', {
            copyrightText: copy,
            quickLinksLabel: copy.default('Quick Links'),
            quickLinks: z.array(link).max(8).default([]),
          }),
          block('ProductGrid', {
            title: copy,
            columns: z.number().int().min(2).max(4).default(3),
            limit: z.number().int().min(1).max(24).default(6),
          }),
        ])
      )
      .min(1)
      .max(40),
    theme: themeOverrides.optional(),
  })
  .strict();

export const portableIdentitySchema = z
  .object({
    id: z.uuid(),
    template_id: z.literal('puck'),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    business_name: z.string().min(1).max(200),
    logo_url: asset.nullable().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('NGN'),
  })
  .strict();
export const portableCatalogSchema = z
  .object({
    merchantId: z.uuid(),
    capturedAt: z.iso.datetime(),
    products: z
      .array(
        z
          .object({
            id: z.uuid(),
            merchant_id: z.uuid(),
            name: z.string().min(1).max(300),
            price: z.number().finite().nonnegative(),
            image: asset.nullable(),
            slug: z.string().regex(/^[a-z0-9-]+$/),
          })
          .strict()
      )
      .max(24),
  })
  .strict()
  .superRefine((catalog, context) => {
    if (
      catalog.products.some(
        (product) => product.merchant_id !== catalog.merchantId
      )
    )
      context.addIssue({
        code: 'custom',
        message: 'Catalog merchant mismatch',
      });
  });
export type PortableHome = z.infer<typeof portableHomeSchema>;
export type PortableIdentity = z.infer<typeof portableIdentitySchema>;
export type PortableCatalog = z.infer<typeof portableCatalogSchema>;
export const portableCapabilities = {
  rendererVersion: PORTABLE_RENDERER_VERSION,
  pageSlugs: ['home'],
  blocks: ['Header', 'Hero', 'Text', 'Button', 'Footer', 'ProductGrid'],
  animation: false,
  zones: false,
  controls: false,
  links: 'same-store paths only',
  catalog: 'published display snapshot; not a reservation',
} as const;
