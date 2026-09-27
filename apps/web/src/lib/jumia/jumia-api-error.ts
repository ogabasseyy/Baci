export class JumiaApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(`Jumia API Error (${status}): ${message}`);
    this.name = 'JumiaApiError';
  }
}
