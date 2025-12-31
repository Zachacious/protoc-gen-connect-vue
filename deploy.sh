#!/bin/bash
set -e

PACKAGE_NAME="@zachacious/protoc-gen-connect-vue"

echo "--------------------------------------------------"
echo "🚀 Preparing deployment for $PACKAGE_NAME"
echo "--------------------------------------------------"

# 1. AUTHENTICATION CHECK
# We check this FIRST before changing any code versions
echo "🔑 Checking NPM authentication..."
if ! npm whoami > /dev/null 2>&1; then
  echo "❌ Not authenticated with NPM."
  echo "👉 Running 'npm login' now. Please follow the prompts..."
  npm login
else
  echo "✅ Authenticated as $(npm whoami)"
fi

# 2. GIT STATE CHECK
if [ -n "$(git status --porcelain)" ]; then 
  echo "❌ Error: Your git working directory is not clean."
  echo "Please commit or stash your changes before deploying."
  exit 1
fi

# 3. BUILD
echo "📦 Running build..."
npm run build

# 4. VERSIONING
# 'npm version patch' creates a commit and a git tag automatically
echo "🔢 Bumping version..."
npm version patch -m "chore: release %s"

# 5. PUBLISHING
# We use --access public for scoped packages (@zachacious/...)
echo "🚢 Publishing to NPM registry..."
npm publish --access public

# 6. SYNCING
echo "📤 Pushing commit and tags to origin..."
git push origin main --tags

echo "--------------------------------------------------"
echo "✅ SUCCESS: Version $(node -p "require('./package.json').version") is live!"
echo "--------------------------------------------------"