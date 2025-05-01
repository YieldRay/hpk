#!/bin/sh
CMD="node --run hpk -- \"$URL\" --referer \"$REFERER\""

if [ -n "$CORS" ]; then
    CMD="$CMD --cors \"$CORS\""
else
    CMD="$CMD --cors-origin"
fi

printf "%s\n\n" "$CMD"
eval "$CMD"
exit $?
