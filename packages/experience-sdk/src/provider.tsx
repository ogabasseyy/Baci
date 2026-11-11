import type { ExperienceCommerce } from '@baci/shared/experience';
import { createContext, type ReactNode, useContext } from 'react';

const Context = createContext<{
  commerce: ExperienceCommerce;
  assets: Readonly<Record<string, string>>;
} | null>(null);
export function CommerceProvider({
  commerce,
  assets = {},
  children,
}: {
  commerce: ExperienceCommerce;
  assets?: Readonly<Record<string, string>>;
  children: ReactNode;
}) {
  return (
    <Context.Provider value={{ commerce, assets }}>{children}</Context.Provider>
  );
}
export function useCommerce(): ExperienceCommerce {
  const c = useContext(Context);
  if (!c) throw Error('CommerceProvider required');
  return c.commerce;
}
export function useAssetUrl(assetId: string): string | null {
  const c = useContext(Context);
  if (!c) throw Error('CommerceProvider required');
  return Object.hasOwn(c.assets, assetId) ? c.assets[assetId] : null;
}
