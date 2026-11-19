export function OxygenFormError({ id, error }: { id: string; error: string }) {
  if (!error) return null;
  return (
    <p
      id={id}
      role="alert"
      tabIndex={-1}
      className="rounded-xl border border-store-primary/30 bg-store-primary/10 p-3 text-sm text-store-background-text"
    >
      {error}
    </p>
  );
}
