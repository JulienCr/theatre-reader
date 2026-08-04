#!/bin/bash
# Installe l'IPA Theatre Reader sur les devices iOS connectés.
# Usage :
#   ./install-ios.sh                            # interactif : sélection des devices
#   ./install-ios.sh all                        # tous les devices disponibles
#   ./install-ios.sh "iPad de Julien,AvoloPhone" # devices nommés
set -e

cd "$(dirname "$0")"

IPA_PATH="./App/build/ipa/TheatreReader.ipa"

if [ ! -f "$IPA_PATH" ]; then
    echo "Erreur : IPA introuvable à $IPA_PATH"
    echo "Lance d'abord 'pnpm run ipa:ios'."
    exit 1
fi

# Nettoyage des fichiers temporaires
cleanup() { rm -f "$TMP_JSON"; rm -rf "$TMP_LOGS"; }
trap cleanup EXIT

# Récupère les devices sous forme de lignes "nom|identifiant|modèle"
TMP_JSON=$(mktemp /tmp/theatre-devices.XXXXXX.json)
TMP_LOGS=""

xcrun devicectl list devices --json-output "$TMP_JSON" >/dev/null 2>&1

devices=()
while IFS= read -r line; do
    [ -n "$line" ] && devices+=("$line")
done < <(python3 - "$TMP_JSON" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
for d in data['result']['devices']:
    tunnel = d['connectionProperties'].get('tunnelState', '')
    if tunnel == 'unavailable':
        continue
    name = d['deviceProperties']['name']
    cid = d['identifier']
    model = d['hardwareProperties'].get('marketingName', '?')
    print(f'{name}|{cid}|{model}')
PYEOF
)

if [ ${#devices[@]} -eq 0 ]; then
    echo "Aucun device iOS disponible."
    echo "Vérifie qu'ils sont connectés en USB et appairés."
    exit 1
fi

dev_name()  { local tmp="${1%%|*}"; echo "$tmp"; }
dev_id()    { local tmp="${1#*|}"; echo "${tmp%%|*}"; }
dev_model() { echo "${1##*|}"; }

install_on_device() {
    local name="$1"
    local identifier="$2"
    local logfile="$3"
    echo "Installation sur $name ($identifier)..."
    if xcrun devicectl device install app --device "$identifier" "$IPA_PATH" >"$logfile" 2>&1; then
        echo "OK : $name"
    else
        echo "ÉCHEC : $name (log ci-dessous)"
        return 1
    fi
}

selected=()
DEVICES_ARG="${1:-}"

if [ "$DEVICES_ARG" = "all" ]; then
    selected=("${devices[@]}")
elif [ -n "$DEVICES_ARG" ]; then
    IFS=',' read -ra requested <<< "$DEVICES_ARG"
    for req in "${requested[@]}"; do
        req=$(echo "$req" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        found=false
        for dev in "${devices[@]}"; do
            if [ "$(dev_name "$dev")" = "$req" ]; then
                selected+=("$dev")
                found=true
                break
            fi
        done
        if [[ "$found" == false ]]; then
            echo "Attention : device '$req' introuvable ou indisponible, ignoré."
        fi
    done
else
    echo "Devices disponibles :"
    echo ""
    for i in "${!devices[@]}"; do
        echo "  $((i + 1)). $(dev_name "${devices[$i]}") ($(dev_model "${devices[$i]}"))"
    done
    echo ""
    echo "Sélection (ex. '1 3', 'all', ou Entrée pour tous) :"
    read -r selection

    if [ -z "$selection" ] || [ "$selection" = "all" ]; then
        selected=("${devices[@]}")
    else
        for num in $selection; do
            idx=$((num - 1))
            if [ "$idx" -ge 0 ] && [ "$idx" -lt ${#devices[@]} ]; then
                selected+=("${devices[$idx]}")
            else
                echo "Attention : sélection invalide '$num', ignorée."
            fi
        done
    fi
fi

if [ ${#selected[@]} -eq 0 ]; then
    echo "Aucun device sélectionné."
    exit 1
fi

echo ""
echo "Installation de TheatreReader.ipa sur ${#selected[@]} device(s) en parallèle..."

TMP_LOGS=$(mktemp -d /tmp/theatre-install.XXXXXX)
pids=()
pid_names=()
pid_logs=()

for dev in "${selected[@]}"; do
    name="$(dev_name "$dev")"
    identifier="$(dev_id "$dev")"
    logfile="$TMP_LOGS/${name// /_}.log"
    install_on_device "$name" "$identifier" "$logfile" &
    pids+=($!)
    pid_names+=("$name")
    pid_logs+=("$logfile")
done

failures=0
for i in "${!pids[@]}"; do
    if ! wait "${pids[$i]}"; then
        ((failures++))
        echo ""
        echo "--- Log de ${pid_names[$i]} ---"
        cat "${pid_logs[$i]}"
        echo "---"
    fi
done

echo ""
if [ $failures -eq 0 ]; then
    echo "Toutes les installations ont réussi."
else
    echo "$failures installation(s) en échec."
    echo "Rappel : après le passage à la team U3P93WXUHR, l'ancienne app signée par la team"
    echo "personnelle doit être désinstallée du device avant de pouvoir installer celle-ci."
    exit 1
fi
