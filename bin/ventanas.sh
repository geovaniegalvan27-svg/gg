#!/bin/sh
# Window helpers for the ⧉ button (macOS; needs Accessibility for System Events the first time).
# usage: ventanas.sh nombres            -> the names of Claude's windows, one per line
#        ventanas.sh acomodar "<names>" -> waits for a new Claude window (one not in <names>) and
#                                          puts it on the half of the screen the main window is not
#                                          using, full height.
if [ "$1" = "nombres" ]; then
  osascript <<'E'
set AppleScript's text item delimiters to linefeed
tell application "System Events" to tell process "Claude" to set n to name of windows
return n as text
E
  exit 0
fi

if [ "$1" = "acomodar" ]; then
  osascript - "$2" <<'E'
on run argv
  set antes to paragraphs of (item 1 of argv)
  tell application "Finder" to set b to bounds of window of desktop
  set anchoPantalla to item 3 of b
  set altoPantalla to item 4 of b
  set arriba to 25
  tell application "System Events" to tell process "Claude"
    set nueva to missing value
    repeat 24 times
      repeat with w in windows
        if antes does not contain (name of w) then set nueva to contents of w
      end repeat
      if nueva is not missing value then exit repeat
      delay 0.25
    end repeat
    if nueva is missing value then return "no new window"
    set centro to 0
    repeat with w in windows
      if (name of w) is not (name of nueva) then
        set p to position of w
        set s to size of w
        set centro to (item 1 of p) + (item 1 of s) / 2
        exit repeat
      end if
    end repeat
    if centro < anchoPantalla / 2 then
      set x to anchoPantalla / 2
    else
      set x to 0
    end if
    set position of nueva to {x as integer, arriba}
    set size of nueva to {(anchoPantalla / 2) as integer, (altoPantalla - arriba) as integer}
    return "ok"
  end tell
end run
E
  exit 0
fi
