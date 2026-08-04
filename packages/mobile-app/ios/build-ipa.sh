#!/bin/bash
# Build de l'IPA de Theatre Reader (signature Compagnie Avolo, profil valide 1 an).
# Voir App/ExportOptions.plist pour le choix du mode d'export (« debugging », pas « ad-hoc »).
#
# Usage :
#   pnpm run ipa:ios              # rebuild du front + cap sync, puis archive + export
#   pnpm run ipa:ios -- --no-web  # réutilise le App/App/public déjà synchronisé
set -e

cd "$(dirname "$0")"
IOS_DIR="$(pwd)"
REPO_ROOT="$(cd ../../.. && pwd)"
PBXPROJ="$IOS_DIR/App/App.xcodeproj/project.pbxproj"
BUILD_DIR="$IOS_DIR/App/build"
IPA_NAME="TheatreReader.ipa"

if [ "${1:-}" = "--no-web" ]; then
  echo "⏭  Front non reconstruit (--no-web) — App/App/public est réutilisé tel quel."
else
  echo "🌐 Build du front mobile + cap sync..."
  pnpm -C "$REPO_ROOT" run build:ios
fi

echo "🧹 Nettoyage du build précédent..."
rm -rf "$BUILD_DIR"

echo "🔢 Incrément du numéro de build..."
# agvtool est volontairement évité : l'Info.plist référence $(CURRENT_PROJECT_VERSION)
# et agvtool le remplacerait par une valeur en dur. On incrémente la source, le pbxproj.
CURRENT_BUILD=$(perl -ne 'if (/CURRENT_PROJECT_VERSION = (\d+);/) { print $1; exit }' "$PBXPROJ")
if [ -z "$CURRENT_BUILD" ]; then
  echo "Erreur : CURRENT_PROJECT_VERSION introuvable dans $PBXPROJ"
  exit 1
fi
NEW_BUILD=$((CURRENT_BUILD + 1))
perl -pi -e "s/CURRENT_PROJECT_VERSION = \d+;/CURRENT_PROJECT_VERSION = $NEW_BUILD;/g" "$PBXPROJ"
MARKETING_VERSION=$(perl -ne 'if (/MARKETING_VERSION = (.+);/) { print $1; exit }' "$PBXPROJ")
echo "   Version : $MARKETING_VERSION ($NEW_BUILD)"

echo "📦 Archive..."
xcodebuild -project App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$BUILD_DIR/App.xcarchive" \
  archive \
  -allowProvisioningUpdates \
  -quiet

echo "📱 Export de l'IPA..."
xcodebuild -exportArchive \
  -archivePath "$BUILD_DIR/App.xcarchive" \
  -exportPath "$BUILD_DIR/ipa" \
  -exportOptionsPlist App/ExportOptions.plist \
  -allowProvisioningUpdates

# Le produit s'appelle App.app (PRODUCT_NAME = $(TARGET_NAME)) : on renomme l'IPA.
if [ -f "$BUILD_DIR/ipa/App.ipa" ]; then
  mv "$BUILD_DIR/ipa/App.ipa" "$BUILD_DIR/ipa/$IPA_NAME"
fi

echo ""
echo "✅ Build terminé."
echo "📍 IPA : $BUILD_DIR/ipa/$IPA_NAME"
echo "📌 Version : $MARKETING_VERSION ($NEW_BUILD)"
echo ""
echo "Expiration du profil embarqué :"
security cms -D -i "$BUILD_DIR/App.xcarchive/Products/Applications/App.app/embedded.mobileprovision" 2>/dev/null \
  | plutil -extract ExpirationDate raw - 2>/dev/null \
  || echo "   (non lisible)"
echo ""
echo "➡️  Installation : pnpm run install:ios"
