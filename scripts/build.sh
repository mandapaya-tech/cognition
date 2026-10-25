#!/usr/bin/env bash
# Copia solo los archivos públicos del sitio a public/ para el despliegue.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf public && mkdir public
git ls-files | grep -vE '^(worker/|scripts/|wrangler\.jsonc|README\.md|\.gitignore)' | while read -r f; do mkdir -p "public/$(dirname "$f")"; cp "$f" "public/$f"; done
