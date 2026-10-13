import type { BuildCommercialGuideLinksContext } from './content-cluster-types';

export function getProtectedModelFamilyTokens(
  context: Omit<BuildCommercialGuideLinksContext, 'pageKind'>,
  tokenize: (value: string) => string[]
) {
  const protectedTokens = new Set([
    ...tokenize(context.modelFamilySlug ?? ''),
    ...(context.categorySlug === 'nintendo-switch-2' ? ['switch'] : []),
    ...(context.categorySlug === 'vr-headsets' ? ['vr'] : []),
  ]);
  const contextTokens = [
    ...(context.brands ?? []),
    ...(context.modelFamilySlug ? [context.modelFamilySlug] : []),
    ...(context.productNames ?? []),
    ...(context.productSlugs ?? []),
  ].flatMap(tokenize);
  if (
    context.categorySlug === 'tablets' &&
    contextTokens.includes('redmi') &&
    contextTokens.includes('pad')
  ) {
    protectedTokens.add('pad');
  }
  return protectedTokens;
}
