#!/usr/bin/env bash
set -euo pipefail

scratch=$(mktemp -d)
trap 'find "$scratch" -depth -delete' EXIT
mkdir "$scratch/browser"
export TMPDIR="$scratch/browser"

# GNU time reports the largest individual process RSS in the command tree.
# The function's concurrent memory usage still needs a deployment smoke check.
/usr/bin/time -f '%M' -o "$scratch/peak-rss-kib" \
  node --import tsx --input-type=module <<'JS'
import { renderHtmlToPdf } from './apps/web/src/lib/receipt-html-to-pdf.ts';
const pdf = await renderHtmlToPdf('<!doctype html><html><body><h1>Invoice</h1><p>Automatic Confirmation</p><p>Manual Confirmation</p></body></html>');
if (Buffer.from(pdf.subarray(0, 5)).toString() !== '%PDF-') {
  throw new Error('Packaged Chromium did not render a PDF');
}
JS

peak_rss_kib=$(cat "$scratch/peak-rss-kib")
scratch_kib=$(du -sk "$TMPDIR" | cut -f1)
printf 'Chromium scratch files after cold render: %s KiB\n' "$scratch_kib"
printf 'Peak RSS of largest individual process: %s KiB\n' "$peak_rss_kib"
limit_kib=$((512 * 1024))
if (( scratch_kib <= 0 || scratch_kib > limit_kib || peak_rss_kib <= 0 || peak_rss_kib > limit_kib )); then
  echo 'Cold invoice PDF render exceeded its scratch or process RSS budget'
  exit 1
fi
