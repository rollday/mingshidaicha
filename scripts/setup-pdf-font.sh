#!/usr/bin/env bash
# Install the same UMing font as the production Debian package, without root.
set -euo pipefail

font_target="$HOME/.local/share/fonts/arphic/uming.ttc"
font_sha256=fe952e55617275142d9cefd4d79eade4df446517b0478b2567d9bc7df49f70e2
font_package=fonts-arphic-uming_0.2.20080216.2-11_all.deb
# Verified against Debian trixie's signed InRelease -> Packages.xz metadata.
font_package_sha256=2676b21b90df94f23418610291b71b43720c95cdccb420b97ab56edfd3ce4cf5
font_url="https://deb.debian.org/debian/pool/main/f/fonts-arphic-uming/$font_package"
font_cache="${XDG_CACHE_HOME:-$HOME/.cache}/mingshidaicha/fonts"

if [ -r /usr/share/fonts/truetype/arphic/uming.ttc ]; then
  printf '%s\n' 'Using the system UMing font.'
  exit 0
fi
if [ -e "$font_target" ] || [ -L "$font_target" ]; then
  if printf '%s  %s\n' "$font_sha256" "$font_target" | sha256sum --check --status; then
    printf 'Verified user UMing font: %s\n' "$font_target"
    exit 0
  fi
  printf 'Existing font differs from the pinned UMing file; preserving it: %s\n' "$font_target" >&2
  exit 1
fi

for font_tool in curl sha256sum dpkg-deb install mktemp; do
  command -v "$font_tool" >/dev/null
done
mkdir -p "$font_cache"
font_work="$(mktemp -d "$font_cache/install.XXXXXXXX")"
trap 'rm -rf -- "$font_work"' EXIT
if ! printf '%s  %s\n' "$font_package_sha256" "$font_cache/$font_package" | sha256sum --check --status 2>/dev/null; then
  curl --fail --silent --show-error --location --max-time 60 "$font_url" -o "$font_work/package.deb"
  printf '%s  %s\n' "$font_package_sha256" "$font_work/package.deb" | sha256sum --check --status
  mv "$font_work/package.deb" "$font_cache/$font_package"
fi
dpkg-deb --extract "$font_cache/$font_package" "$font_work/unpacked"
font_source="$font_work/unpacked/usr/share/fonts/truetype/arphic/uming.ttc"
printf '%s  %s\n' "$font_sha256" "$font_source" | sha256sum --check --status
install -D -m 644 "$font_source" "$font_target"
install -D -m 644 "$font_work/unpacked/usr/share/doc/fonts-arphic-uming/copyright" "${font_target%/*}/copyright"
cp -R "$font_work/unpacked/usr/share/doc/fonts-arphic-uming/license" "${font_target%/*}/license"
printf 'Installed checksum-verified UMing font: %s\n' "$font_target"
