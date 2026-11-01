import { z } from 'zod';
/** Individually authorized staging bookings. This does not enable production activation. */
export const oxygenActivationBindings = [
  {
    reference: 'b75cd437-28af-4008-a1af-7e6810282833',
    workflowId: '52ab6696-762b-4e9f-8f99-a9d926a29b2c',
  },
  {
    reference: '1e65cf4b-4942-4ade-8149-e894687f6c40',
    workflowId: '1c0459fe-2d45-4d2c-b41a-0ac640ad9f89',
  },
] as const;
export const oxygenActivationReferenceSchema = z.enum([
  oxygenActivationBindings[0].reference,
  oxygenActivationBindings[1].reference,
]);
export function oxygenActivationBinding(reference: string) {
  return oxygenActivationBindings.find(
    (binding) => binding.reference === reference
  );
}
