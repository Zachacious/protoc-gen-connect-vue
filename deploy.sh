#!/bin/bash
set -e

PACKAGE_NAME="@zachacious/protoc-gen-connect-vue"

echo "🚀 Starting Production Release for $PACKAGE_NAME"

# 1. Clean build check
echo "🛠  Testing build..."
npm run build || { echo "❌ Build failed. Fix errors before deploying."; exit 1; }

# 2. NPM Auth
if ! npm whoami > /dev/null 2>&1; then
  echo "🔑 NPM Login required..."
  npm login
fi

# 3. Required files
for file in "LICENSE" "README.md" ".npmrc"; do
  [ -f "$file" ] || { echo "❌ Missing $file"; exit 1; }
done

# 4. Git Check
[ -z "$(git status --porcelain)" ] || { echo "❌ Git directory dirty. Commit first."; exit 1; }

# 5. Execute Release
echo "🔢 Bumping version and tagging..."
npm version patch -m "chore: release %s"

echo "🚢 Publishing to NPM..."
npm publish

echo "📤 Syncing with Git..."
git push origin main --tags

echo "✅ DEPLOYMENT COMPLETE"