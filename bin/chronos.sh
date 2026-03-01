#!/usr/bin/env bash
# Chronos — authoritative date/time context from system clock
set -euo pipefail

echo "=== System Clock ==="
echo "ISO 8601:  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "Local:     $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "Epoch:     $(date '+%s')"
echo "Day:       $(date '+%A')"
echo "Week:      $(date '+%V') (ISO week)"

# Quarter calculation
month=$(date '+%-m')
if [ "$month" -le 3 ]; then
  quarter="Q1"
elif [ "$month" -le 6 ]; then
  quarter="Q2"
elif [ "$month" -le 9 ]; then
  quarter="Q3"
else
  quarter="Q4"
fi
echo "Quarter:   ${quarter} $(date '+%Y')"
echo "FY Quarter: F${quarter} FY$(date '+%Y')"
