'use client';
import { Component, type ReactNode } from 'react';
import { PreviewRendererCore } from '@/components/storefront/preview-renderer-core';
import type { PreviewResult } from '@/schemas/builder-mcp-results';

/** The approval action disappears with a failed render. The server repeats validation at POST. */
class ApprovalRenderBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p role="alert">
        This homepage could not be displayed. Open the Baci editor before
        publishing.
      </p>
    ) : (
      this.props.children
    );
  }
}
export function ApprovalPreview({
  preview,
  children,
}: {
  preview: PreviewResult;
  children: ReactNode;
}) {
  return (
    <ApprovalRenderBoundary key={`${preview.storefrontId}:${preview.version}`}>
      <PreviewRendererCore preview={preview} />
      {children}
    </ApprovalRenderBoundary>
  );
}
