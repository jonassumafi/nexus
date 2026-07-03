#!/bin/bash
# Download 1000px top-down ship images from scorg.tools

THUMB_DIR="/home/kylo-mini/nexus/frontend/public/images/ships/thumbnails"
LARGE_DIR="/home/kylo-mini/nexus/frontend/public/images/ships/large"
BASE_URL="https://scorg.tools"
DELAY=0.4

mkdir -p "$LARGE_DIR"

total=0
ok=0
fail=0

for f in "$THUMB_DIR"/*.webp; do
  slug=$(basename "$f" .webp)
  out="$LARGE_DIR/${slug}.webp"
  if [ -f "$out" ]; then
    ((total++))
    ((ok++))
    continue
  fi
  url="${BASE_URL}/media/ships/${slug}/ID-top-1000.webp"
  http_code=$(curl -s -o "$out" -w "%{http_code}" "$url")
  ((total++))
  if [ "$http_code" = "200" ]; then
    ((ok++))
  else
    rm -f "$out"
    ((fail++))
    echo "MISS $slug ($http_code)"
  fi
  sleep $DELAY
done

echo "Done: $ok/$total downloaded, $fail misses"
