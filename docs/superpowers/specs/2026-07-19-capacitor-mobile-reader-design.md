# Lecteur mobile en app iOS (Capacitor) — remplacer l'export HTML autonome

**Date** : 2026-07-19
**Statut** : design validé, prêt pour le plan d'implémentation

## Contexte & problème

Le lecteur mobile actuel est un **export HTML autonome** : `exportReaderHtml`
(`packages/server/src/reader-export.ts`) assemble un unique `.html` embarquant le
rendu de la pièce, le runtime navigateur `@theatre/reader-runtime` (bundlé par
esbuild) et **tous les clips audio ElevenLabs en base64 data-URI**. On transfère
ce fichier sur le téléphone et on l'ouvre hors-ligne dans un navigateur.

Quatre reproches, tous confirmés par l'utilisateur :

1. **Transfert du fichier** — télécharger le `.html` puis le poser sur le
   téléphone est pénible ; à re-faire à chaque modif du texte/des notes.
2. **Poids** — tout l'audio inliné en base64 → fichier énorme.
3. **Pas une vraie app** — un fichier ouvert dans un navigateur : pas d'icône.
4. **Le principe même** — l'idée d'un artefact figé à exporter déplaît sur le fond.

**Contraintes dures** :
- L'utilisateur répète **souvent hors-ligne / loin** (métro, coulisses, TGV, Mac
  éteint). Le mode hors-ligne **fiable**, sans serveur joignable, est obligatoire.
- L'utilisateur possède un **compte développeur Apple**.

## Approche retenue : app iOS Capacitor (WebView du reader web)

> **Révisé le 2026-07-19, après la refonte UI (`main` → 5bf1241, PR #7/#9/#11/#13/#15).**
> Ce spec prévoyait initialement d'embarquer `Reader.tsx` (le lecteur *desktop*) et de
> **supprimer** `@theatre/reader-runtime`. Ces PR ont fait de `reader-runtime` un
> véritable lecteur mobile React/Preact (chrome, transport, sheet Options, modes de
> répétition) adossé aux nouveaux `@theatre/ui` et `@theatre/reader-ui`.
> **Décision inversée : on garde et on réutilise `reader-runtime`** ; `Reader.tsx` reste
> le lecteur desktop (Paged.js = parité PDF) et n'est pas embarqué. Le retrait de
> l'export HTML devient **différé** (après validation sur device).

Au lieu d'exporter un fichier figé, on empaquette le **lecteur mobile existant**
(`@theatre/reader-runtime`) dans une **app iOS native via Capacitor** (WebView). Le
rendu reste 100 % le rendu canonique de `@theatre/core` — l'invariant « source de
rendu unique » est préservé, aucune réimplémentation native.

### Pourquoi Capacitor plutôt que PWA ou Flutter

- **Flutter / full-native (rejeté)** : ne peut pas réutiliser `renderBody`/
  `renderCSS` (qui émettent du HTML/CSS). Il faudrait réimplémenter le rendu →
  **casse l'invariant**, diverge du PDF, énorme travail dans un langage neuf.
- **PWA pure (rejetée)** : iOS **évince** le Cache Storage (~7 j sans ouverture +
  quotas) → offline non fiable, précisément quand on en a besoin (loin, Mac
  éteint, app pas ouverte depuis longtemps).
- **Capacitor (retenu)** : réutilise le reader web (invariant intact) ET offre
  **stockage natif sans éviction** + **vraie app** (via le compte dev Apple) +
  une **voie vers l'audio en arrière-plan**. Coût : un projet iOS à builder/signer
  via Xcode, et un re-déploiement Xcode pour livrer une nouvelle version *du code
  reader* (le *contenu*, lui, se met à jour à l'exécution sans rebuild).

| | PWA pure | **Capacitor (retenu)** |
|---|---|---|
| Réutilise `renderBody` + le lecteur mobile | ✅ | ✅ (WebView) |
| Offline durable | ⚠️ éviction iOS | ✅ FS natif, aucune éviction |
| Audio arrière-plan / écran verrouillé | ❌ | ✅ (voie native, voir jalons) |
| Vraie app installée | ⚠️ « écran d'accueil » | ✅ compte dev |
| MàJ du code reader | ✅ over-the-air | ⚠️ re-déploiement Xcode |
| MàJ du contenu (texte/notes/audio) | ✅ | ✅ à l'exécution (« Préparer hors-ligne ») |

## Composants

### 1. Paquet `@theatre/mobile-app` + projet Capacitor iOS
- **Nouveau paquet léger** (Vite + Preact) : shell + couche de sync. Il n'embarque
  **ni Paged.js ni l'UI d'édition** — c'est tout l'intérêt de ne pas réutiliser
  `packages/web`.
- `@capacitor/core` + `@capacitor/ios`, `webDir` = `packages/mobile-app/dist`.
- `cap add ios` → projet Xcode ; `cap sync` après chaque build.
- Build sur device / TestFlight via le compte dev.

### 2. Le lecteur = `@theatre/reader-runtime` (shell hors-ligne par construction)
- L'app charge son bundle depuis le paquet natif (`capacitor://localhost`) → le
  **shell fonctionne sans réseau**, aucune synchro nécessaire pour l'UI.
- À l'exécution, l'app fait ce que `exportReaderHtml` fait au build : `renderBody` /
  `renderCSS`, construction d'un `ReaderData`, puis `TheatreReader.boot()`. La
  logique de construction est **extraite dans `buildReaderDocument`
  (`@theatre/reader-ui`)**, partagée avec l'export → une seule source de `ReaderData`.
- **Seam clé** : `ReaderData.audio.clips` (`Record<nodeId, string>`) est consommé
  *tel quel comme URL* par `Chrome.tsx` (`resolveAudio`). On y met une **URL serveur**
  (mode en ligne) puis une **URL de fichier local** (hors-ligne) : `reader-runtime`
  ne change pas d'une ligne, et le base64 disparaît.
- **Base URL API configurable** : sous Capacitor les appels ne sont pas same-origin ;
  ils pointent vers le Mac (`https://<mac>.ts.net`), saisi une fois et persisté.

### 3. Nouvel endpoint serveur : `GET /api/plays/:slug/audio/:key`
Seule addition côté serveur. Le POST `/tts` actuel renvoie l'audio mais on veut un
GET simple à consommer/stocker côté app :
- Réutilise `audioCacheKey` / `readAudioCache` (`storage.ts`) — aucune nouvelle
  logique de cache, aucun namespace nouveau (`mp3_44100_128`, `DEFAULT_OUTPUT_FORMAT`).
- Renvoie `audio/mpeg`. Clip absent → `404` (pas de synthèse : la synthèse reste
  sur `POST /tts` + `/tts/batch`).

### 4. « Préparer hors-ligne » (sync contenu → FS natif)
Bouton dans le reader mobile, à exécuter une fois connecté au Mac :
1. `POST /api/plays/:slug/tts/batch` → chauffe le cache serveur + renvoie le
   manifest `nodeId → { key, cached }` (**réutilisé tel quel**).
2. Pour chaque `key`, `GET /api/plays/:slug/audio/:key` → écrit le `.mp3` sur le
   **FS natif** (plugin **Capacitor Filesystem**).
3. Écrit aussi la pièce (`GET /api/plays/:slug`) et les notes (`/notes`) sur le FS.
- **Ré-exécutable et idempotent** (cache-first, ne re-télécharge que le manquant).
- Hors-ligne, le reader lit la pièce/notes/audio depuis le FS. Reconnecté, un
  nouveau « Préparer » ajoute le contenu nouvellement généré (**pas figé**).

### 5. Audio
- **v1** : lecture HTML5 dans la WebView, en **réutilisant `audio-player`**
  existant, sur des URLs de fichiers locaux (FS). Valide toute la boucle offline.
- **Jalon 2 (voie native)** : plugin audio natif pour la lecture en
  **arrière-plan / écran verrouillé** (capability iOS « Audio background »), pour
  faire défiler les répliques téléphone en poche. Le vrai gain « natif » de l'audio.

## Flux de données

**Préparation (connecté au Mac, via Tailscale)** : ouvrir l'app → choisir la
pièce → « Préparer hors-ligne ». Pièce + notes + audio écrits sur le FS.

**Répétition (Mac éteint, pas de réseau)** : l'app se lance (shell bundlé), lit
tout depuis le FS. **Lecture et audio 100 % hors-ligne, sans éviction.**

**Reconnecté** : un « Préparer hors-ligne » re-synchronise texte/notes/nouvel
audio. Le *code* reader, lui, se met à jour par re-déploiement Xcode.

## Transport de sync : Tailscale

La sync API (composants 3-4) doit joindre le Mac. **Tailscale** : `tailscale
serve` proxifie `https://<mac>.ts.net` → `127.0.0.1:3001`.
- Fournit du **HTTPS** → satisfait l'**App Transport Security** d'iOS (le HTTP
  brut LAN serait bloqué sans exception ATS).
- Fastify **reste sur `127.0.0.1`** ; Tailscale est le seul à le joindre.
- Marche **de partout** tant que le Mac tourne (4G comprise) ; sinon le FS local
  prend le relais.
- Setup **documenté** (README + CLAUDE.md), pas scripté — machine/compte de
  l'utilisateur.

## Ce qu'on retire (différé, après validation device)

Décision utilisateur révisée : l'export reste le **filet** tant que l'app n'est pas
prouvée sur le téléphone. Une fois validée, on retire **uniquement l'assemblage
`.html` et son déclenchement** :
- `packages/server/src/reader-export.ts` + tests
  (`reader-export.test.ts`, `reader-export-audio.test.ts`).
- Route `POST /api/export/reader` (`server.ts`) + champs audio de `ExportBody`.
- `exportReader` côté web (`packages/web/src/api.ts`) + bouton/commande palette.

⚠️ **`@theatre/reader-runtime` est CONSERVÉ** — c'est désormais le lecteur de l'app
mobile. Idem pour `@theatre/reader-ui` et `@theatre/ui`.

## Réutilisation (aucun système parallèle)

- **Rendu** : `renderBody` / `renderCSS` (`@theatre/core`) inchangés.
- **Lecteur mobile** : `@theatre/reader-runtime` (chrome, transport, sheet Options,
  modes de répétition) réutilisé **sans modification**, avec `@theatre/reader-ui`
  (recherche, composants) et `@theatre/ui` (`uiCss` en chaînes, inlinable).
- **Cache audio** : `audioCacheKey` / `readAudioCache` / `.mp3` disque, format
  `mp3_44100_128` — le GET lit les mêmes fichiers que la lecture en ligne/batch.
- **Pré-génération** : `POST /tts/batch` réutilisé tel quel.
- **Data** : `GET /api/plays/:slug`, `/notes`, `/api/plays`, `audio-player`.

Additions : le paquet `@theatre/mobile-app` (shell + sync), le projet Capacitor iOS,
`buildReaderDocument` **extrait** de l'export (mutualisé), et **un seul** endpoint
serveur (`GET .../audio/:key`).

## Jalons

1. **Boucle offline (v1)** : `buildReaderDocument` partagé + paquet `mobile-app`
   (d'abord **en ligne**, pour dérisquer) + `GET /audio/:key` + store FS +
   « Préparer hors-ligne » + ouverture local-first + projet Capacitor iOS.
   Retrait **différé** de l'export, après validation device.
2. **Audio natif** : lecture en arrière-plan / écran verrouillé.

## Risques & points de validation

- **App Transport Security** : confirmer que Tailscale HTTPS passe l'ATS sans
  exception ; sinon, exception ATS ciblée pour l'hôte `ts.net`.
- **Base URL / premier lancement** : UX de saisie de l'URL `ts.net` (une fois),
  et message clair quand le Mac est injoignable (« contenu hors-ligne uniquement »).
- **Quantité d'audio** : une pièce entière peut peser lourd ; FS natif sans quota
  strict, mais valider les temps de « Préparer hors-ligne » et la place disque.
- **Re-déploiement Xcode** : documenter le cycle build web → `cap sync` → Xcode →
  device, pour livrer une nouvelle version du code reader.
- **Poids du bundle** : vérifier que `mobile-app` n'embarque ni Paged.js ni React
  complet (alias Preact effectif). *(Le risque « Paged.js lourd en WebView » de la
  version initiale disparaît : on n'embarque plus `Reader.tsx`.)*
- **`boot()` est à un coup** : `reader-runtime` lit `window.__THEATRE_READER_DATA__`
  une seule fois. Changer de pièce = recharger la vue, ou assouplir plus tard.

## Hors périmètre

- Rendu full-native (Flutter/SwiftUI) — casse l'invariant de rendu unique.
- Exposition publique (Tailscale Funnel) — le tailnet privé suffit.
- Édition sur mobile — l'app est lecture-seule.
- Android — cible iOS d'abord (compte dev Apple) ; Capacitor le permettra plus tard.
