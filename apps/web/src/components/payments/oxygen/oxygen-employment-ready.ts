export function isOxygenEmploymentReady(amount: string, day: string): boolean {
  return (
    /^\d+(\.\d{1,2})?$/.test(amount) && Number(day) >= 1 && Number(day) <= 31
  );
}
