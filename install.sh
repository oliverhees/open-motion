#!/usr/bin/env bash
# Open Motion installer for Linux and macOS. No admin rights, everything goes into ~/.openmotion.
#
#   curl -fsSL https://raw.githubusercontent.com/oliverhees/open-motion/main/install.sh | bash
#
# Options (environment variables):
#   OM_HOME=~/.openmotion   install folder        OM_REF=main   branch or tag
#   OM_WHISPER=1|0          answer the Whisper question without asking
# Running it again updates Open Motion. Your projects (OM_HOME/data) stay.

set -euo pipefail

NODE_VERSION="22.23.3"
REPO="oliverhees/open-motion"

main() {
  local home="${OM_HOME:-$HOME/.openmotion}"
  local ref="${OM_REF:-main}"
  local de=0
  case "${LANG:-}${LC_ALL:-}" in de*|*de_*) de=1 ;; esac
  say() { if [ "$de" = 1 ]; then printf '%s\n' "$1"; else printf '%s\n' "$2"; fi; }
  fail() { printf '\n❌ %s\n' "$1" >&2; exit 1; }

  command -v curl >/dev/null || fail "curl fehlt / curl is missing (sudo apt install curl)"
  command -v tar >/dev/null || fail "tar fehlt / tar is missing"

  local os arch
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) fail "$(say "Nicht unterstützt: $(uname -s). Für Windows: install.ps1" "Unsupported: $(uname -s). For Windows use install.ps1")" ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) fail "$(say "Prozessor nicht unterstützt: $(uname -m)" "Unsupported CPU: $(uname -m)")" ;;
  esac
  # Apple Silicon running a Rosetta shell: use the native build.
  if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -in hw.optional.arm64 2>/dev/null)" = 1 ]; then arch=arm64; fi

  printf '\n🎬 Open Motion · %s-%s · %s\n' "$os" "$arch" "$home"
  mkdir -p "$home"
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  # 1. Node.js (own copy, checksum verified)
  if [ "$("$home/node/bin/node" -v 2>/dev/null || true)" != "v$NODE_VERSION" ]; then
    say "⬇️  Node.js $NODE_VERSION …" "⬇️  Node.js $NODE_VERSION …"
    local file="node-v$NODE_VERSION-$os-$arch.tar.gz"
    curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$file" -o "$tmp/$file"
    curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
    local want got
    want="$(grep " $file\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1)"
    if command -v sha256sum >/dev/null; then got="$(sha256sum "$tmp/$file" | cut -d' ' -f1)"; else got="$(shasum -a 256 "$tmp/$file" | cut -d' ' -f1)"; fi
    [ -n "$want" ] && [ "$want" = "$got" ] || fail "$(say "Prüfsumme von Node.js stimmt nicht. Download abgebrochen." "Node.js checksum mismatch. Aborted.")"
    rm -rf "$home/node" && mkdir -p "$home/node"
    tar -xzf "$tmp/$file" -C "$home/node" --strip-components=1
  fi

  # 2. Open Motion itself (replaces the old app folder, keeps data/)
  say "⬇️  Open Motion ($ref) …" "⬇️  Open Motion ($ref) …"
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$ref" -o "$tmp/app.tar.gz" \
    || fail "$(say "Download fehlgeschlagen. Gibt es den Branch/Tag \"$ref\"?" "Download failed. Does the branch/tag \"$ref\" exist?")"
  rm -rf "$home/app.new" && mkdir -p "$home/app.new"
  tar -xzf "$tmp/app.tar.gz" -C "$home/app.new" --strip-components=1
  rm -rf "$home/app.old"
  [ -d "$home/app" ] && mv "$home/app" "$home/app.old"
  mv "$home/app.new" "$home/app"
  rm -rf "$home/app.old"

  # 3. Everything else (same script on every system)
  local node="$home/node/bin/node"
  if [ -r /dev/tty ] && (exec </dev/tty) 2>/dev/null; then
    "$node" "$home/app/scripts/install/setup.ts" --home "$home" </dev/tty
  else
    "$node" "$home/app/scripts/install/setup.ts" --home "$home" </dev/null
  fi
}

# Wrapped in main() so a half-downloaded script never runs.
main "$@"
