type PreviewRootTitleProps = {
  title: string;
};

export function PreviewRootTitle({ title }: PreviewRootTitleProps) {
  return (
    <aside
      aria-label="Preview page title"
      className="border-store-border bg-store-background/95 border-b px-4 py-2 text-sm text-store-foreground"
      data-testid="builder-preview-root-title"
    >
      <span className="text-store-foreground/70">Page title · </span>
      <strong className="font-medium">{title}</strong>
    </aside>
  );
}
