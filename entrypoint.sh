#!/bin/sh
CMD="node --run hpk -- \"$URL\" --referer \"$REFERER\""

if [ -n "$ORIGIN" ]; then
    CMD="$CMD --cors \"$ORIGIN\""
else
    CMD="$CMD --cors-origin"
fi

printf "%s\n\n" "$CMD"
eval "$CMD"
exit $?