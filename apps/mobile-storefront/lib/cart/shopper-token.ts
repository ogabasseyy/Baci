/** Session identity is a precondition, never an inferred customer relationship. */
export async function getCartShopperToken(
  expectedOwner: string | undefined,
  readSession: () => Promise<{
    access_token: string;
    user: { id: string };
  } | null>
): Promise<string | null> {
  if (!expectedOwner) return null;
  const session = await readSession();
  return session?.user.id === expectedOwner ? session.access_token : null;
}
