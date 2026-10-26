import { builderPreviewResultSchema } from '@/schemas/builder-mcp-results';
import { hasSafeBuilderPreviewAssets } from '@/schemas/builder-preview-assets';
import { PortableHomeView } from './portable/portable-home';

/** Shared inert rendering contract for ChatGPT and the later owner approval page. */
export function PreviewRendererCore({ preview }: { preview: unknown }) {
  const result = builderPreviewResultSchema.safeParse(preview);
  if (!result.success || !hasSafeBuilderPreviewAssets(result.data.projection))
    return (
      <p role="alert">
        Preview unavailable. Open the authenticated Baci editor to review this
        homepage.
      </p>
    );
  const { projection } = result.data;
  return (
    <PortableHomeView
      config={projection.config}
      merchant={projection.identity}
      catalog={projection.catalog}
      inert
    />
  );
}
