# Lecteur mobile autonome — design

**Date** : 2026-06-23
**Statut** : validé (brainstorming), prêt pour plan d'implémentation

## Problème

Le mode lecteur est aujourd'hui rendu dans le navigateur, mais il dépend du serveur
Node local (`:3001`) pour charger les pièces depuis `data/`. Un téléphone n'a pas accès
à ce `localhost`. On veut pouvoir **lire une pièce sur mobile**, avec :

- choix du/des personnage(s) surligné(s) **à la lecture** (sans éditer le template) ;
- saut rapide vers une scène ;
- (et plus largement, une lecture confortable sur petit écran).

## Décisions structurantes (issues du brainstorming)

1. **Distribution = fichier HTML autonome.** Le serveur produit un seul `.html`
   auto-suffisant (texte + CSS + JS inline). On le transfère au téléphone
   (AirDrop / mail / cloud). Il s'ouvre dans n'importe quel navigateur mobile,
   **hors-ligne, sans serveur**. C'est un **instantané figé** d'une pièce à un
   instant T ; pour une nouvelle version, on ré-exporte.
2. **Mise en page = reflow à la largeur.** Pas de Paged.js, pas de pages A4. Le texte
   se reflowe pour remplir l'écran. Conséquence assumée : les numéros de page ne
   correspondent plus au PDF ; la navigation se fait par acte/scène. Avantage : fichier
   léger (pas de Paged.js inline) et lecture confortable.
3. **Fonctions du lecteur** : surligner **plusieurs** persos, mode « mes répliques »
   (répétition), recherche texte, réglage de la taille du texte. Plus le saut de scène.

## Invariant respecté

`@theatre/core` reste la **source unique du rendu**. L'export reader appelle le même
`renderBody` + `renderCSS` que la preview, le lecteur desktop et l'export PDF. Aucune
ré-implémentation du rendu hors de `core`.

## Architecture

### 1. Serveur — nouvel endpoint d'export

`POST /api/export/reader`

- **Entrée** : mêmes champs que l'export PDF — `{ fountain, characters, template }`.
- **Traitement** :
  1. `parseFountain(fountain, characters)` → `play`.
  2. `renderBody(play, template)` + `renderCSS(template)` (rendu canonique).
  3. **Enveloppe mobile** : document HTML complet avec
     - `<meta name="viewport" content="width=device-width, initial-scale=1">`,
     - padding responsive, `.play { max-width: none }`,
     - **neutralisation de la pagination** : on n'émet pas / on surcharge
       `@page`, `break-after: page`, et surtout
       `.toc-item a::after { content: none }` (sinon `target-counter` produit du
       vide hors Paged.js).
  4. **Inline** du runtime lecteur (cf. §3) + d'un bloc de données :
     ```json
     {
       "characters": [{ "id": "...", "name": "..." }],
       "toc":        [{ "id": "h-12", "label": "Acte I, scène 2", "scene": true }],
       "highlightsDefault": [{ "characterId": "...", "color": "..." }]
     }
     ```
     `characters` et `toc` viennent de `play.characters` et `buildToc(play, template)`.
     `highlightsDefault` = `template.highlights` (pré-sélection initiale).
- **Sortie** : le `.html` (téléchargé côté web).

### 2. `core/src/render.ts` — retouche minime

`renderLine` émet aujourd'hui `<p class="line">` sans identité de personnage. On ajoute
**`data-cid="<characterId>"`** sur chaque `<p class="line">` (et rien d'autre).

- Inoffensif pour l'export PDF et la preview (attribut ignoré par le rendu visuel).
- Indispensable au runtime pour colorer / masquer par personnage côté client.
- Test unitaire : `renderBody` produit `data-cid` sur chaque `.line`.

### 3. Runtime du lecteur (nouveau code vanilla)

Le fichier autonome ne peut pas embarquer React/Vite. On écrit un **runtime navigateur
en TS vanilla**, **bundlé/minifié par esbuild** (déjà présent dans le repo) au moment de
l'export, puis **inliné** dans le `.html`.

Emplacement : `packages/server/src/reader-runtime/` (consommé uniquement par l'export
pour l'instant). esbuild ajouté comme devDependency explicite de `@theatre/server` si
nécessaire.

Le runtime, à partir du HTML rendu + du bloc de données :

- **Sélecteur de personnages (multi)** : liste depuis `characters` ; activation de
  plusieurs persos ; couleur attribuée depuis une petite palette. Colore les
  `.line[data-cid=…]` correspondantes. Pré-coché depuis `highlightsDefault` s'il y en a,
  sinon vide.
- **Mode « mes répliques »** : toggle qui masque/floute le `.speech` des persos
  surlignés ; tap sur une réplique pour la révéler. Réutilise `data-cid`.
- **Saut de scène** : panneau (bottom-sheet) depuis `toc` →
  `scrollIntoView` sur `#h-<index>` (ids déjà émis par `renderBody`).
- **Recherche texte** : surlignage des occurrences + suivant/précédent, adapté tactile.
- **Taille du texte** : boutons A− / A+ sur `.play { font-size }`.
- **Persistance** : persos sélectionnés + taille de texte mémorisés en `localStorage`,
  clé dérivée du slug/titre de la pièce.

UI **tactile-first** : barre d'outils compacte + panneaux en bottom-sheet. Pas de
raccourcis clavier (contrairement au lecteur desktop, qui reste inchangé).

### 4. Web UI

Bouton **« Exporter le lecteur mobile »** à côté de l'export PDF (même zone, même flux :
appel API → `Blob` → téléchargement). Ajout d'une fonction `exportReader(...)` dans
`packages/web/src/api.ts`, symétrique de `exportPdf(...)`.

## Réutilisation & dette assumée

La recherche DOM (`markMatches` / `clearMarks` / `focusMatch`) existe déjà dans
`packages/web/src/components/Reader.tsx`. Les moteurs de mise en page diffèrent (Paged.js
page-fidèle côté desktop vs reflow côté mobile), donc **on ne fusionne pas maintenant**.

- Pour la v1, le runtime mobile **réimplémente** la recherche (logique petite et isolée).
- On **crée un ticket GitHub** pour extraire ces helpers DOM dans un module partagé
  plus tard, au lieu de les dupliquer silencieusement.

## Tests

- **Unit (`core`)** : `renderBody` émet `data-cid` sur chaque `.line` ; le reste du rendu
  (PDF/preview) inchangé.
- **Unit (`server`)** : l'export reader produit un HTML auto-suffisant — pas de
  `http://`, pas de `@page` actif, bloc de données présent, runtime inliné.
- **Front** : script Playwright jetable (sous `packages/server/`, supprimé après) ouvrant
  le `.html` en viewport mobile et vérifiant surlignage multi, saut de scène, recherche,
  taille de texte, mode répliques. Pas de test web unitaire (conforme au projet).

## Hors périmètre (YAGNI)

- Bascule reflow ↔ pages A4 fidèles dans le fichier mobile.
- Hébergement en ligne / accès LAN au serveur.
- Sync / mise à jour automatique du fichier après ré-export.
- Fusion immédiate du code de recherche avec `Reader.tsx` (→ ticket).
