#!/bin/bash
set -e

# --- Configuration ---
PACKAGE_NAME="@zachacious/protoc-gen-connect-vue"

echo "🚀 Starting deployment for $PACKAGE_NAME..."

# 1. Ensure we are on the main branch and clean
if [ -n "$(git status --porcelain)" ]; then 
  echo "❌ Error: Working directory is not clean. Commit your changes first."
  exit 1
fi

# 2. Check NPM Login
echo "🔑 Checking NPM authentication..."
if ! npm whoami > /dev/null 2>&1; then
  echo "⚠️ Not logged into NPM. Please login now:"
  npm login
fi

# 3. Build the project
echo "📦 Building project..."
npm run build

# 4. Version Bump (Patch)
# This will increment 1.0.0 -> 1.0.1, commit the change, and tag it
echo "🔢 Bumping version..."
npm version patch -m "release: %s"

# 5. Push to Git
echo "📤 Pushing changes and tags to Git..."
git push origin main --tags

# 6. Publish to NPM
echo "🚢 Publishing to NPM..."
npm publish

echo "✅ Successfully deployed version $(node -p "require('./package.json').version")!"