// Lab header bar: the lockup is the selected slot, so the bar is a plain
// landmark placing it top-of-page. Production chrome (search/cart/nav/
// account), glass scroll states, and sticky positioning are excluded —
// identical across arms and irrelevant to the 40px slot's fetch sequence.
export function LabStoreHeader({
  children,
  storeName,
}: {
  children: React.ReactNode;
  storeName: string;
}) {
  return (
    <header data-pilot-lab-store-header={storeName}>
      <div className="flex items-center gap-2 px-4 py-4 md:px-8">
        {children}
      </div>
    </header>
  );
}
