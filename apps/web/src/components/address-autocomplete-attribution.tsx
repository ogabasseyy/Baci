export function AddressAutocompleteAttribution({
  provider,
}: {
  provider: 'google' | 'geoapify';
}) {
  if (provider === 'geoapify')
    return (
      <span className="text-xs text-muted-foreground">
        Powered by{' '}
        <a
          href="https://www.geoapify.com/"
          target="_blank"
          rel="noopener"
          className="underline"
        >
          Geoapify
        </a>
        {' · '}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener"
          className="underline"
        >
          © OpenStreetMap contributors
        </a>
      </span>
    );
  return (
    <span
      role="img"
      aria-label="Powered by Google"
      className="text-xs text-muted-foreground opacity-60"
    >
      Powered by{' '}
      <span className="font-medium">
        <span className="text-[#4285F4]">G</span>
        <span className="text-[#EA4335]">o</span>
        <span className="text-[#FBBC05]">o</span>
        <span className="text-[#4285F4]">g</span>
        <span className="text-[#34A853]">l</span>
        <span className="text-[#EA4335]">e</span>
      </span>
    </span>
  );
}
