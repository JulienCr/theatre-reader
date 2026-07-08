#!/usr/bin/env bash
#
# Injecte ELEVENLABS_API_KEY depuis 1Password (item « Elevenlabs-api-key ») puis
# exécute la commande passée en argument. Nécessite le CLI `op` et une session
# active (`op signin`). La clé n'est jamais écrite sur le disque.
#
# Si la clé est introuvable (pas de `op`, pas de session, item absent), on
# continue quand même : le TTS se désactive proprement côté serveur
# (`hasElevenLabsKey()`) et le reste de `pnpm dev` tourne normalement.
#
# Exemple : bash scripts/with-elevenlabs.sh pnpm dev
#
set -euo pipefail

if [ -z "${ELEVENLABS_API_KEY:-}" ]; then
  # Recherche l'item par nom dans tous les coffres, en essayant les libellés de
  # champ les plus courants (adapte si ton item utilise un autre libellé).
  KEY="$(op item get 'Elevenlabs-api-key' --fields label=credential --reveal 2>/dev/null \
    || op item get 'Elevenlabs-api-key' --fields label=password --reveal 2>/dev/null \
    || op item get 'Elevenlabs-api-key' --fields label=api_key --reveal 2>/dev/null || true)"
  if [ -n "$KEY" ]; then
    export ELEVENLABS_API_KEY="$KEY"
  else
    echo "⚠️  Clé ElevenLabs introuvable (1Password) — TTS désactivé pour cette session." >&2
    echo "   Pour l'activer : 'op signin' puis vérifie l'item 'Elevenlabs-api-key'." >&2
  fi
fi

exec "$@"
