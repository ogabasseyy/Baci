export function extractRedvaultInventoryRelease(inventory) {
  const privateStart = inventory.indexOf(
    'CREATE OR REPLACE FUNCTION private.release_order_inventory_units('
  );
  const publicStart = inventory.indexOf(
    'CREATE OR REPLACE FUNCTION public.release_order_inventory_units('
  );
  if (privateStart < 0 || publicStart <= privateStart) {
    throw new Error(
      'REDVAULT inventory release markers are missing or out of order'
    );
  }
  return inventory.slice(privateStart, publicStart);
}
