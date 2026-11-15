/** Load only after the customer starts a check, before any paid POST. */
export async function loadImeiResultSchema() {
  return (await import('@baci/shared/imei')).ImeiResultSchema;
}
