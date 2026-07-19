# PWA mobile reader — remplacer l'export HTML autonome

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
2. **Poids** — tout l'audio inliné en base64 → fichier énorme, lent à générer,
   transférer, ouvrir.
3. **Pas une vraie app** — un fichier ouvert dans un navigateur : pas d'icône,
   pas d'expérience appli.
4. **Le principe même** — l'idée d'un artefact figé à exporter déplaît sur le fond.

**Contrainte dure** : l'utilisateur répète **souvent hors-ligne / loin** (métro,
coulisses, TGV, Mac éteint). Le mode hors-ligne, sans serveur joignable, est
donc obligatoire — c'est précisément ce qui justifiait l'export.

## Approche retenue : une PWA (Progressive Web App)

Au lieu d'exporter un fichier figé, on fait **parler le téléphone à l'app qui
tourne**, et on la rend *installable* + *hors-ligne* via un service worker.

**La PWA, c'est le web app existant** — aucun rendu nouveau, aucun runtime
parallèle. On réutilise `renderBody`/`renderCSS`, le reader `Reader.tsx`, le
cache audio disque et les endpoints existants.

| Reproche | Ce que la PWA change |
|---|---|
| Transfert | Supprimé — on ouvre une URL une fois, plus jamais de `.html` à balader |
| Poids | Supprimé — l'audio vit dans le Cache Storage (clip par clip, purgeable), pas un mastodonte base64 |
| Pas une app | Résolu — icône sur l'écran d'accueil, plein écran (`display: standalone`) |
| Artefact figé | Résolu — se re-synchronise dès qu'elle rejoint le Mac (texte, notes, audio en tâche de fond) |

### Origine HTTPS : Tailscale

Un service worker exige un **contexte sécurisé** (HTTPS ou localhost). Le
téléphone n'est ni l'un ni l'autre face à `http://<ip>:3001`.

**Décision : Tailscale.** `tailscale serve` proxifie
`https://<mac>.ts.net` → `127.0.0.1:3001` avec un cert Let's Encrypt de
confiance. Conséquences :

- Le service worker s'installe (origine HTTPS valide, stable).
- **Fastify reste sur `127.0.0.1`** — aucune ouverture LAN à faire, Tailscale
  est le seul à joindre le serveur, via le tailnet chiffré.
- Bonus : joignable de partout tant que le Mac tourne (4G comprise). Hors de
  portée du Mac, l'hors-ligne prend le relais via le cache du SW.

Le setup Tailscale est **documenté** (README + CLAUDE.md), pas scripté — c'est la
machine et le compte de l'utilisateur.

## Composants

### 1. Manifest PWA
`display: standalone`, icônes, `theme_color`, `start_url` ouvrant le reader en
mode lecture. Généré via **`vite-plugin-pwa`** (Workbox) — l'outillage standard,
plutôt qu'un service worker écrit à la main.

### 2. Service worker (Workbox, via vite-plugin-pwa)
- **Precache** de l'app shell (sortie du build Vite, versionnée → mises à jour
  automatiques quand le Mac est joignable = « pas figé »).
- **Runtime-cache** des GET data : `GET /api/plays/:slug` et
  `GET /api/plays/:slug/notes` (déjà des GET, cachables tels quels).
- **Cache audio** : voir le nouvel endpoint ci-dessous.

### 3. Nouvel endpoint serveur : `GET /api/plays/:slug/audio/:key`
Seule addition côté serveur. Le POST `/tts` actuel n'est **pas** cachable par le
Cache API (les POST ne le sont pas). Ce GET lit le cache disque en lecture seule :

- Réutilise `audioCacheKey` / `readAudioCache` (`storage.ts`) — aucune nouvelle
  logique de cache, aucun namespace nouveau.
- Renvoie `audio/mpeg` avec un `Cache-Control` cachable → le SW le stocke.
- Clip absent → `404` (pas de synthèse : le GET reste idempotent ; la synthèse
  reste sur le chemin `POST /tts` + `/tts/batch`).

### 4. Bouton « Préparer hors-ligne »
Dans le web app : chauffe le cache pour l'hors-ligne en **réutilisant le batch
existant** :
1. `POST /api/plays/:slug/tts/batch` → chauffe le cache serveur + renvoie le
   manifest `nodeId → { key, cached }`.
2. Pour chaque `key`, un `GET /api/plays/:slug/audio/:key` → peuple le Cache
   Storage du SW.
3. Cache aussi la pièce (`/api/plays/:slug`) et les notes (`/notes`).

Progression pilotée côté client (chunking), comme le fait déjà la modale de
génération en masse.

### 5. Entrée lecture-seule
`start_url` du manifest ouvre le reader en **mode lecture** (`mode: 'read'`,
toggle déjà existant). La sélection de pièce réutilise la liste existante
(`GET /api/plays`). La PWA sert `Reader.tsx` — **un seul reader**, pas de runtime
mobile séparé.

## Flux de données

**Préparation (maison, Wi-Fi, Mac allumé)** : ouvrir `https://<mac>.ts.net` →
« Ajouter à l'écran d'accueil » → « Préparer hors-ligne ». Tout est en cache.

**Répétition (déplacement, Mac éteint, pas de réseau)** : l'app se lance depuis
l'écran d'accueil, sert la pièce + les notes + l'audio depuis le cache. **Lecture
et audio 100 % hors-ligne.**

**Retour connecté** : le SW rafraîchit l'app shell + le texte + les notes en
tâche de fond. Un nouveau « Préparer hors-ligne » ajoute l'audio nouvellement
généré.

## Ce qu'on retire (immédiatement)

L'ancien export part **dès le début** (décision utilisateur), sans période de
coexistence :

- `packages/server/src/reader-export.ts` + ses tests
  (`reader-export.test.ts`, `reader-export-audio.test.ts`).
- La route `POST /api/export/reader` (`server.ts`) et le type `ExportBody` associé
  si inutilisé ailleurs.
- L'appel `exportReaderHtml` côté web (`packages/web/src/api.ts`) + le
  bouton/flux UI qui le déclenche.
- Le package **`@theatre/reader-runtime`** dans son intégralité : il a été écrit
  pour le `.html` autonome et devient du code mort une fois la PWA servie par
  `Reader.tsx`. Retirer aussi ses références (`package.json`, workspace, esbuild
  dans `reader-export.ts`).

## Réutilisation (aucun système parallèle)

- **Rendu** : `renderBody` / `renderCSS` / `Reader.tsx` inchangés.
- **Cache audio** : `audioCacheKey` / `readAudioCache` / clips disque `.mp3`,
  format `mp3_44100_128` (`DEFAULT_OUTPUT_FORMAT`) — le nouveau GET lit les mêmes
  fichiers que la lecture en ligne et le batch. Aucun namespace nouveau.
- **Pré-génération** : `POST /tts/batch` réutilisé tel quel.
- **Data** : `GET /api/plays/:slug`, `/notes`, `/api/plays` réutilisés.

Additions : le layer PWA côté web (manifest + SW via vite-plugin-pwa + bouton
« Préparer hors-ligne ») et **un seul** endpoint serveur (`GET .../audio/:key`).

## Risques & points de validation

- **Perf du reader sur mobile** : `Reader.tsx` utilise Paged.js (lazy-loaded,
  aplati en scroll continu). À valider sur le téléphone ; si trop lourd,
  optimiser ce chemin (mode reflow continu sans pagination) — **sans** recréer un
  second reader.
- **Cache Storage & quotas** : l'audio d'une pièce entière peut être volumineux.
  Vérifier le comportement d'éviction iOS/Safari ; « Préparer hors-ligne » doit
  être ré-exécutable et idempotent.
- **Mises à jour du SW** : garantir qu'une nouvelle version du build s'installe
  proprement (stratégie Workbox `autoUpdate` + invite de rechargement) pour tenir
  la promesse « pas figé ».
- **Tailscale serve** : vérifier le proxy HTTPS → loopback et la persistance
  (`--bg`) ; documenter l'install one-time du client sur le téléphone.

## Hors périmètre

- Wrapper natif (Capacitor/Tauri) — trop lourd pour un outil mono-utilisateur.
- Exposition publique (Funnel) — le tailnet privé suffit.
- Édition sur mobile — la PWA est lecture-seule.
