export function boundedStorefrontPreflightRpcErrorDetail(
  code: string,
  message: string
): string | undefined {
  return `${code} ${message}`.trim().slice(0, 160) || undefined;
}
