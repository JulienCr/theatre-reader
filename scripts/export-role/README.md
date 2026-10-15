# Export PDF des tirades d'un personnage

Exporte en PDF uniquement les répliques d'UN personnage, dans n'importe quelle pièce
du dossier `data/`. Réutilise le pipeline de rendu et d'export existant
(`@theatre/core` pour le filtre, `@theatre/server` pour Playwright + Paged.js) — rien
n'est réimplémenté.

À ne pas confondre avec le mode « mes scènes uniquement » du lecteur web
(`filterScenesByRoles`) : celui-ci garde des **scènes entières** dès qu'on y joue, y
compris les répliques des autres personnages présents. Ce script filtre **réplique par
réplique** (`filterLinesByCharacter`).

## Usage

```bash
pnpm tsx scripts/export-role/export-role.ts <slug-piece> <personnage> [options]
```

- `<slug-piece>` : nom du dossier sous `data/` (ex. `benji`).
- `<personnage>` : id, nom canonique ou alias du personnage, insensible à la casse.

Options :
- `--placeholder` : au lieu de retirer les répliques des autres personnages, les
  remplace par un repère `— NOM —` (garde un minimum de contexte sur qui parle).
  Par défaut, elles sont retirées entièrement.
- `--out <fichier>` : chemin du PDF produit. Défaut : `./<slug>-<personnage>-tirades.pdf`.

Les en-têtes d'acte/scène sont toujours conservés (repères de structure), même si la
scène ne contient plus que le personnage ciblé.

## Exemple

```bash
pnpm tsx scripts/export-role/export-role.ts benji "Benji" --placeholder --out ~/Desktop/benji-tirades.pdf
```
