#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/../packages/skills/diagram-dsl"
TARGETS=(
  "$HOME/.claude/skills/diagram-dsl"
  "$HOME/.codex/skills/diagram-dsl"
)

if [ ! -d "$SRC" ]; then
  echo "Source skill not found: $SRC" >&2
  exit 1
fi

for dst in "${TARGETS[@]}"; do
  mkdir -p "$(dirname "$dst")"
  rm -rf "$dst"
  cp -R "$SRC" "$dst"
  echo "Synced -> $dst"
done

# Sync for Antigravity (Gemini)
GEMINI_DST_DIR="$HOME/.gemini/antigravity/skills"
mkdir -p "$GEMINI_DST_DIR"
cp "$SRC/SKILL.md" "$GEMINI_DST_DIR/diagram-dsl.md"
echo "Synced -> $GEMINI_DST_DIR/diagram-dsl.md"

