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

Au lieu d'exporter un fichier figé, on empaquette le **reader web existant** dans
une **app iOS native via Capacitor** (WebView). Le rendu reste 100 % le rendu
canonique de `@theatre/core` — l'invariant « source de rendu unique » est
préservé, aucune réimplémentation native.

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
| Réutilise `renderBody`/`Reader.tsx` | ✅ | ✅ (WebView) |
| Offline durable | ⚠️ éviction iOS | ✅ FS natif, aucune éviction |
| Audio arrière-plan / écran verrouillé | ❌ | ✅ (voie native, voir jalons) |
| Vraie app installée | ⚠️ « écran d'accueil » | ✅ compte dev |
| MàJ du code reader | ✅ over-the-air | ⚠️ re-déploiement Xcode |
| MàJ du contenu (texte/notes/audio) | ✅ | ✅ à l'exécution (« Préparer hors-ligne ») |

## Composants

### 1. Projet Capacitor iOS
- `@capacitor/core` + `@capacitor/ios`, `webDir` = build web (`packages/web/dist`).
- `npx cap add ios` → projet Xcode ; `cap sync` après chaque build web.
- Build sur device / TestFlight via le compte dev. Le projet iOS généré est
  gitignoré (artefact de build) sauf la config Capacitor (`capacitor.config.ts`).

### 2. Reader lecture-seule bundlé (shell hors-ligne par construction)
- L'app charge le web build depuis le bundle (`capacitor://localhost`) → le
  **shell reader fonctionne sans réseau**, aucune synchro nécessaire pour l'UI.
- Sert `Reader.tsx` en **mode lecture** (`mode: 'read'`, toggle déjà existant).
  Sur le build natif, l'UI d'édition est masquée (flag de build).
- **Base URL API configurable** : sous Capacitor, les appels `/api/...` ne sont
  plus same-origin ; ils pointent vers le Mac (`https://<mac>.ts.net`). Un écran
  de réglage stocke cette URL (saisie une fois).

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

## Ce qu'on retire (immédiatement)

L'ancien export part **dès le début** (décision utilisateur), sans coexistence :
- `packages/server/src/reader-export.ts` + tests
  (`reader-export.test.ts`, `reader-export-audio.test.ts`).
- Route `POST /api/export/reader` (`server.ts`) + type `ExportBody` si inutilisé.
- Appel `exportReaderHtml` côté web (`packages/web/src/api.ts`) + bouton/flux UI.
- Package **`@theatre/reader-runtime`** en entier (écrit pour le `.html`
  autonome ; le reader mobile est désormais `Reader.tsx` en WebView) + ses
  références (`package.json`, workspace, esbuild).

## Réutilisation (aucun système parallèle)

- **Rendu** : `renderBody` / `renderCSS` / `Reader.tsx` inchangés.
- **Cache audio** : `audioCacheKey` / `readAudioCache` / `.mp3` disque, format
  `mp3_44100_128` — le GET lit les mêmes fichiers que la lecture en ligne/batch.
- **Pré-génération** : `POST /tts/batch` réutilisé tel quel.
- **Data** : `GET /api/plays/:slug`, `/notes`, `/api/plays`, `audio-player`.

Additions : le projet Capacitor iOS, la couche de sync-vers-FS + réglage URL, et
**un seul** endpoint serveur (`GET .../audio/:key`).

## Jalons

1. **Boucle offline (v1)** : projet Capacitor + reader read-only bundlé + base URL
   configurable + `GET /audio/:key` + « Préparer hors-ligne » → FS + lecture audio
   HTML5. Retrait de l'ancien export + `reader-runtime`.
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
- **Perf reader en WebView** : `Reader.tsx` utilise Paged.js (lazy, aplati en
  scroll continu). À valider sur device ; si lourd, optimiser ce chemin — **sans**
  recréer un second reader.

## Hors périmètre

- Rendu full-native (Flutter/SwiftUI) — casse l'invariant de rendu unique.
- Exposition publique (Tailscale Funnel) — le tailnet privé suffit.
- Édition sur mobile — l'app est lecture-seule.
- Android — cible iOS d'abord (compte dev Apple) ; Capacitor le permettra plus tard.
