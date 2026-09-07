#!/usr/bin/env sh
set -eu

name="video-pro-finder.zip"
rm -f "$name"
zip -qr "$name" . -x './.git/*' './.gitignore' './scripts/package.sh' './*.zip'
size=$(wc -c < "$name")
printf 'Created %s (%s bytes)\n' "$name" "$size"
if [ "$size" -lt 10485760 ]; then
  printf '%s\n' 'Package is below the requested 10 MiB size; include the demo fixture before publishing.' >&2
  exit 1
fi
printf '%s\n' 'Package meets the 10 MiB target.'
