#!/bin/bash
set -e

# Build
echo "Building..."
npm run build

# Versioning
echo "Bumping version..."
npm version patch -m "chore: release %s"

# Publishing
echo "Publishing to NPM..."
npm publish --access public

# Syncing
echo "Pushing to Git..."
git push origin main --tags

echo "Done."