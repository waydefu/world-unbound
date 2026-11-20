#!/usr/bin/env bash
# GitHub Codespaces only: installs lightweight CLI tools. No npm install, browser download or MCP server.
set -euo pipefail

packages=()
command -v rg >/dev/null 2>&1 || packages+=(ripgrep)
command -v jq >/dev/null 2>&1 || packages+=(jq)
if ! command -v fd >/dev/null 2>&1 && ! command -v fdfind >/dev/null 2>&1; then
  packages+=(fd-find)
fi

if (( ${#packages[@]} > 0 )); then
  sudo apt-get update -qq
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${packages[@]}"
fi

if ! command -v fd >/dev/null 2>&1; then
  sudo ln -sf "$(command -v fdfind)" /usr/local/bin/fd
fi

rg --version | head -n 1
fd --version
jq --version
node --version
