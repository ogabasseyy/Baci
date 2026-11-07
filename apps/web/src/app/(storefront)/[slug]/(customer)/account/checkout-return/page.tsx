import { CheckoutReturn } from './checkout-return';

/** Reconcile the previous customer cart before returning from social sign-in. */
export default async function CheckoutReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { slug } = await params;
  const { next } = await searchParams;
  return <CheckoutReturn slug={slug} next={next} />;
}
