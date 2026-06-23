# Theatre Reader

Met en page des textes de théâtre à partir d'un **PDF** : extraction d'une
version structurée (personnages, didascalies, répliques, actes/scènes), édition,
**aperçu live** et **export PDF** selon des templates configurables.

Outil **local mono-utilisateur** (pas de comptes, pas de base de données) — les
pièces sont stockées en fichiers dans `data/`.

## Démarrage

```bash
pnpm install
pnpm setup:browser      # installe Chromium (Playwright) pour l'export PDF — une seule fois
pnpm dev                # serveur (:3001) + interface web (:5173)
```

Ouvre **http://localhost:5173**, clique **Importer un PDF**, choisis ton texte.

Build de production : `pnpm build && pnpm start` puis http://localhost:3001
(le serveur sert alors le front buildé sur la même origine).

## Premier cas d'usage : lecture comédien

Le template intégré « Lecture comédien » fait : **nom en gras**, **réplique à la
ligne**, **didascalies en italique grisé**. Dans le panneau *Personnages*, coche
**Michel** et **Benji** pour surligner leurs répliques (couleur et portée
réglables par personnage), puis **Exporter en PDF**.

## Éditeur de personnages (panneau de gauche)

Chaque personnage est dépliable pour : **renommer** (nom affiché dans les cues et
la distribution), **éditer la description** (texte de la *Distribution*), voir ses
**alias** (orthographes reconnues dans le texte), et le **fusionner** dans un autre
personnage — pratique pour corriger les doublons / faux personnages signalés par
l'import (badge « ? »), p.ex. fusionner `DIRECTEUR` dans `GERALD`. Le surlignage
(couleur + portée) se règle au même endroit.

## Options de mise en page (panneau de droite)

- **Nom du personnage** : gras, majuscules, réplique à la ligne, séparateur.
- **Didascalies** (isolées / en incise) : italique, couleur, indentation, masquage.
- **Présentation des personnages** (section *Distribution* en tête) + saut de page après.
- **Sommaire** : actes/scènes avec n° de page (résolu à l'export via Paged.js).
- **Numérotation des pages** en pied (« page x / y »), à l'export PDF.
- **Afficher l'acte avec chaque scène** (`ACTE II. SCENE III` au lieu de `ACTE II.` puis `SCENE III.`).

> Aperçu vs PDF : l'aperçu écran est en flux continu (il montre la structure du
> sommaire sans numéros et sans pied de page) ; les **numéros de page, le pied
> « page x/y » et la pagination réelle n'apparaissent qu'à l'export PDF**, où
> Paged.js pagine le document.

## Comment marche l'import (hybride)

```
PDF → extraction texte + polices (pdfjs) → heuristiques (structure)
    → normalisation des noms (LLM si dispo, sinon fuzzy) → Fountain + AST
```

- L'**italique** des polices distingue les didascalies ; les **MAJUSCULES** en
  début de ligne, les répliques ; la section **DISTRIBUTION**, la liste des
  personnages.
- Les **coquilles de noms** (`GIUSEPPPE`→GIUSEPPE, `BENII`→BENJI) sont
  regroupées. Avec une clé API Anthropic (`ANTHROPIC_API_KEY`), le regroupement
  passe par Claude (plus fiable) ; sinon un appariement flou déterministe prend
  le relais. Les répliques douteuses (cue absente de la distribution) sont
  **signalées** (badge « ? » et contour pointillé dans l'aperçu).

Le texte source est éditable en **Fountain** (panneau de gauche) : corrige le
parsing, la mise en page suit en temps réel.

## Architecture (monorepo pnpm)

| Package            | Rôle |
|--------------------|------|
| `@theatre/core`    | AST, conversion Fountain↔AST, modèle de template, rendu HTML/CSS |
| `@theatre/import`  | Pipeline PDF→Fountain (pdfjs, heuristiques, normalisation LLM/fuzzy) |
| `@theatre/server`  | API Fastify (`/import`, `/plays`, `/export`) + export PDF Playwright |
| `@theatre/web`     | Interface React/Vite (éditeur, aperçu, panneaux personnages & template) |

`pnpm test` lance les tests unitaires (core + import). `pnpm typecheck` vérifie
les types de tous les packages.

## Variables d'environnement

| Variable | Effet |
|----------|-------|
| `ANTHROPIC_API_KEY` | Active la normalisation des noms par Claude à l'import |
| `THEATRE_LLM_MODEL` | Modèle utilisé (défaut `claude-sonnet-4-6`) |
| `THEATRE_DATA_DIR`  | Dossier de stockage des pièces (défaut `./data`) |
| `PORT`              | Port du serveur (défaut `3001`) |
