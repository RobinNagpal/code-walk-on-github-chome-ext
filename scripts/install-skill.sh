#!/usr/bin/env bash
# Installs the code-walkthrough Claude skill into ~/.claude/skills and asks for
# the walkthroughs folder and the voice. Without a terminal (piped or run by a
# tool) it keeps the current settings, or the defaults, instead of asking.
#
#   scripts/install-skill.sh          link the skill (a later `git pull` updates it)
#   scripts/install-skill.sh --copy   copy it instead
set -euo pipefail
# Hide Node's "type stripping is experimental" notice.
export NODE_NO_WARNINGS=1

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO/skills/code-walkthrough"
SKILLS_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
DEST="$SKILLS_DIR/code-walkthrough"

config() { node "$DEST/scripts/config.ts" "$@"; }

# Asks a question when there is someone to answer it; prints the answer or the default.
ask() {
  local prompt="$1" default="$2" answer=""
  if [ -t 0 ]; then read -r -p "$prompt [$default]: " answer || true; fi
  echo "${answer:-$default}"
}

# Node 22.18+ runs the TypeScript scripts directly.
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)' 2>/dev/null; then
  echo "Node.js 22.18 or newer is required (found: $(node -v 2>/dev/null || echo none))." >&2
  exit 1
fi

echo "Installing dependencies…"
npm install --prefix "$SRC" --omit=dev --no-fund --no-audit --silent

mkdir -p "$SKILLS_DIR"
if [ -L "$DEST" ]; then
  current_target="$(readlink "$DEST")"
  [ "$current_target" != "$SRC" ] && echo "Replacing the existing link to $current_target"
  rm "$DEST"
elif [ -d "$DEST" ]; then
  if grep -q '^name: code-walkthrough$' "$DEST/SKILL.md" 2>/dev/null; then
    rm -rf "$DEST" # An earlier --copy install.
  else
    echo "$DEST exists and is not this skill; move it away first." >&2
    exit 1
  fi
fi
if [ "${1:-}" = "--copy" ]; then
  cp -R "$SRC" "$DEST"
  echo "Copied the skill to $DEST"
else
  ln -s "$SRC" "$DEST"
  echo "Linked $DEST -> $SRC"
fi

current_folder="$(config get 2>/dev/null || true)"
echo
config set "$(ask "Folder for code walkthroughs" "${current_folder:-$HOME/code-walkthroughs}")"

echo
echo "Voice for the narration:"
echo "  edge    free Microsoft Edge neural voices, no API key"
echo "  openai  OpenAI text-to-speech, needs OPENAI_API_KEY"
echo "  gemini  Gemini text-to-speech (default model gemini-3.8-flash-lite-tts), needs GEMINI_API_KEY or GOOGLE_API_KEY"
current_provider="$(config voice 2>/dev/null | sed -n 's/.*"provider":"\([a-z]*\)".*/\1/p')"
while :; do
  provider="$(ask "Voice provider" "${current_provider:-edge}")"
  case "$provider" in
    edge | openai | gemini) break ;;
    *) echo "Choose edge, openai or gemini." ;;
  esac
done
if [ "$provider" != "$current_provider" ]; then config set-voice "$provider"; fi
if [ "${1:-}" = "--copy" ]; then env_file="$HOME/.config/code-walkthroughs/.env"; else env_file="$REPO/.env"; fi
echo "Put API keys in $env_file (see .env.example) or in your environment."

echo
echo "Done. In Claude Code, ask for a walkthrough, for example:"
echo "  \"Create a 10 minute code walkthrough of the payment flow\""
echo "Then choose the same folder in the Code Walkthroughs Chrome extension."
