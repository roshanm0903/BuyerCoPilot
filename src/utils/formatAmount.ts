const amountFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatAmount(value: number | string | null | undefined): string {
  const number = Number(value);
  return amountFormatter.format(Number.isFinite(number) ? number : 0);
}
