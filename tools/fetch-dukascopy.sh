#!/bin/bash
# Research data fetch: 5m bid candles from the public Dukascopy feed via `npx dukascopy-node` (no key, no account).
# usage: tools/fetch-dukascopy.sh eurusd   -> ./raw/eurusd/*.csv   (run for: eurusd gbpusd xauusd btcusd usa500idxusd usdjpy audusd usdcad cadjpy)
# Prerequisite: npm i --no-save dukascopy-node   (kept out of package.json on purpose: research tool only)
# Data is never committed. Read-only market data; nothing here can place an order.
i=$1
mkdir -p raw/$i
for r in "2024-10-01 2025-01-01" "2025-01-01 2025-04-01" "2025-04-01 2025-07-01" "2025-07-01 2025-10-01" "2025-10-01 2026-01-01" "2026-01-01 2026-04-01" "2026-04-01 2026-07-01" "2026-07-01 2026-09-29"; do
  set -- $r
  f=raw/$i/$i-m5-$1.csv
  [ -s $f ] && continue
  for a in 1 2 3; do
    npx dukascopy-node -i $i -from $1 -to $2 -t m5 -f csv -dir raw/$i -fn $i-m5-$1 >/dev/null 2>&1
    [ -s $f ] && break
  done
  echo "$i $1 $(wc -l < $f 2>/dev/null)"
done
