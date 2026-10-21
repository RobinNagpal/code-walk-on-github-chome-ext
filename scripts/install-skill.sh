#!/usr/bin/env bash
# Installs the code-walkthrough skill for Claude Code (~/.claude/skills) and/or
# Antigravity CLI (~/.gemini/antigravity-cli/skills), and asks for the walkthroughs
# folder and the voice. Without a terminal (piped or run by a tool) it keeps the
# current settings, or the defaults, instead of asking.
#
#   scripts/install-skill.sh                 link the skill for Claude Code (a later `git pull` updates it)
#   scripts/install-skill.sh --antigravity   link it for Antigravity CLI instead
#   scripts/install-skill.sh --claude --antigravity   for both
#   scripts/install-skill.sh --copy          copy instead of linking (combines with the above)
set -euo pipefail
# Hide Node's "type stripping is experimental" notice.
export NODE_NO_WARNINGS=1

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO/skills/code-walkthrough"
CLAUDE_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
ANTIGRAVITY_DIR="${ANTIGRAVITY_SKILLS_DIR:-$HOME/.gemini/antigravity-cli/skills}"

copy=false
targets=()
for arg in "$@"; do
  case "$arg" in
    --copy) copy=true ;;
    --claude) targets+=("$CLAUDE_DIR") ;;
    --antigravity) targets+=("$ANTIGRAVITY_DIR") ;;
    *)
      echo "Unknown option: $arg (use --claude, --antigravity, --copy)" >&2
      exit 1
      ;;
  esac
done
[ ${#targets[@]} -eq 0 ] && targets=("$CLAUDE_DIR")
FIRST="${targets[0]}/code-walkthrough"

config() { node "$FIRST/scripts/config.ts" "$@"; }

# Asks a question when there is someone to answer it; prints the answer or the default.
ask() {
  local prompt="$1" default="$2" answer=""
  if [ -t 0 ]; then read -r -p "$prompt [$default]: " answer || true; fi
  echo "${answer:-$default}"
}

# Links or copies the skill into one skills directory.
install_into() {
  local skills_dir="$1" dest="$1/code-walkthrough"
  mkdir -p "$skills_dir"
  if [ -L "$dest" ]; then
    local current_target
    current_target="$(readlink "$dest")"
    [ "$current_target" != "$SRC" ] && echo "Replacing the existing link to $current_target"
    rm "$dest"
  elif [ -d "$dest" ]; then
    if grep -q '^name: code-walkthrough$' "$dest/SKILL.md" 2>/dev/null; then
      rm -rf "$dest" # An earlier --copy install.
    else
      echo "$dest exists and is not this skill; move it away first." >&2
      exit 1
    fi
  fi
  if $copy; then
    cp -R "$SRC" "$dest"
    echo "Copied the skill to $dest"
  else
    ln -s "$SRC" "$dest"
    echo "Linked $dest -> $SRC"
  fi
}

# Node 22.18+ runs the TypeScript scripts directly.
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)' 2>/dev/null; then
  echo "Node.js 22.18 or newer is required (found: $(node -v 2>/dev/null || echo none))." >&2
  exit 1
fi

echo "Installing dependencies…"
npm install --prefix "$SRC" --omit=dev --no-fund --no-audit --silent

for skills_dir in "${targets[@]}"; do install_into "$skills_dir"; done

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
if $copy; then env_file="$HOME/.config/code-walkthroughs/.env"; else env_file="$REPO/.env"; fi
echo "Put API keys in $env_file (see .env.example) or in your environment."

echo
echo "Done. In Claude Code or Antigravity CLI, ask for a walkthrough, for example:"
echo "  \"Create a 10 minute code walkthrough of the payment flow\""
echo "Then choose the same folder in the Code Walkthroughs Chrome extension."
