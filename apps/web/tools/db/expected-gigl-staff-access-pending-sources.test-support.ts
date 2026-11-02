const migration = (name: string, sha256: string) => ({
  repositoryPath: `supabase/migrations/${name}`,
  sha256,
});

export const EXPECTED_GIGL_STAFF_ACCESS_PENDING_SOURCES = [
  migration(
    '20261031130000_add_gigl_wallet_actor_columns.sql',
    'a001e8ee3e2713a921abc3f650e946d48d64a51ba8436d98165a4674de1a29ed'
  ),
  migration(
    '20261031130100_add_merchant_shipping_wallet_projections.sql',
    'e8d85dd4acb10876f677077338b9881db6fb7c09f51266966e5880b2c94bfeaa'
  ),
  migration(
    '20261031130200_allow_fulfil_staff_gigl_quote_bind.sql',
    '7d0c6b94091958677205e68a6315ba0d9c352324bd1b31aa3e0eead4b77939dc'
  ),
  migration(
    '20261031130300_allow_fulfil_staff_wallet_reservation.sql',
    '812de2af760db69ee223ab944ecc97046872746dae93d99cf5db49b8094311df'
  ),
  migration(
    '20261031130400_allow_fulfil_staff_wallet_funding.sql',
    '467e000cb0093e5029ffbcb72a01ece6db9751836ba0107c487d6525055d00fa'
  ),
  migration(
    '20261031130500_allow_fulfil_staff_checkout_shipping_recovery.sql',
    '4c502373f173920cfff68ffa73c4a9a8a380638f0ac4cdc4bb3070679fc3d022'
  ),
];
