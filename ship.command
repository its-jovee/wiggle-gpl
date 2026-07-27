#!/bin/bash
cd "$(dirname "$0")"
clear
echo "=== Wigo Studio — Shipping ==="
echo ""
npm run electron:build
echo ""
echo "=== Done! Release is in ./release ==="
read -p "Press enter to close..."
