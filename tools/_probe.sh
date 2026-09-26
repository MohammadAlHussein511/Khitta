#!/usr/bin/env bash
set -euo pipefail
SDK="$ARENA_WORKSPACE"/.cache/androidtool/sdk
J="$SDK/platforms/android-34/android.jar"
echo "len=${#J}"
printf '%s' "$J" | od -c | head -2
[ -e "$J" ] && echo PROBE_EXISTS || echo PROBE_MISSING
