#!/bin/sh
# Nubecita's sounds, all built into macOS (no internet, no tokens).
# usage: hablar.sh tirin    -> the soft "a chat finished" chime
#        hablar.sh callar   -> stop reading aloud
if [ "$1" = "tirin" ]; then
  (afplay -v 0.4 /System/Library/Sounds/Glass.aiff) >/dev/null 2>&1 &
  exit 0
fi
if [ "$1" = "callar" ]; then
  pkill -f "^/usr/bin/say " >/dev/null 2>&1
  pkill -f "/bin/kokoro.py " >/dev/null 2>&1
  pkill -f "afplay .*pulpo-" >/dev/null 2>&1
  exit 0
fi
exit 0
