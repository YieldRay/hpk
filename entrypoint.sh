#!/bin/sh
CMD="node --run hpk -- \"$URL\""

if [ -n "$CORS" ]; then
    CMD="$CMD --cors \"$CORS\""
fi

if [ -n "$REFERER" ]; then
    CMD="$CMD --referer \"$REFERER\""
fi

printf "%s\n\n" "$CMD"
eval "$CMD"
exit $?
