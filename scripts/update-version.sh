#!/bin/bash
# scripts/update-version.sh
# Automatically updates data/version.json with the latest Git commit info.

# Get the short SHA of the current HEAD
SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "v1.0.0")

# Get the date of the latest commit
DATE=$(git log -1 --format=%cd --date=short 2>/dev/null || date +%Y-%m-%d)

# Write to version.json
cat <<EOF > data/version.json
{
    "sha": "$SHA",
    "date": "$DATE"
}
EOF

echo "Version updated to: $SHA ($DATE)"
