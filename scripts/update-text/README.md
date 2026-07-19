# Mettre à jour une pièce à partir d'une nouvelle version (PDF de l'auteur)

Outils pour reporter, dans `data/<slug>/play.fountain`, les modifications qu'un auteur
renvoie sous forme de **PDF mis en page** — que les changements soient marqués
(tirets rouges, passages en gras) **ou pas**. La détection ne se fie PAS aux marques :
elle compare le texte du PDF (marques rouges retirées) au Fountain actuel.

Conçu à l'origine pour « Tout le monde se tire » (juillet 2026). À adapter selon la pièce.

## Principe

Le Fountain actuel est la référence de structure. On extrait le texte du PDF, on retire
les tirets rouges (des **marqueurs**, pas du texte), et pour chaque réplique du Fountain
on regarde si elle apparaît telle quelle dans le PDF. Celles qui n'y sont pas = les modifs.
On regroupe en « régions de changement » (ancres = répliques longues inchangées de part
et d'autre) et on reconstruit chaque région depuis le PDF.

## Pourquoi cette approche (alternatives écartées)

Trois pistes ont été essayées et abandonnées avant l'approche par ancres :
- **Se fier aux marques rouges/gras** comme source du diff → écarté : un « - » ne dit pas
  *quoi* mettre à la place ; il faut de toute façon le texte cible du PDF. Les marques
  servent juste à comprendre l'intention (raccourci / suppression / réassignation).
- **Segmenter le PDF en paragraphes par écart vertical** → échec : le PDF n'a PAS de ligne
  vide entre répliques, donc des scènes entières fusionnent en un seul « paragraphe ».
- **Détecter les indications scéniques par l'italique** (comme le fait `@theatre/import`)
  → non fiable : `pdftohtml` étend parfois l'italique au-delà de la didascalie.

D'où le choix : **ancrer chaque réplique longue inchangée** à sa position dans le texte
PDF ; tout ce qui tombe entre deux ancres est une région à reconstruire. Robuste car ça
ne dépend ni de la structure de paragraphes ni de l'italique — juste du texte.

## Prérequis

- **poppler** (`pdftohtml`, `pdftotext`) : `brew install poppler`
- Python 3 (stdlib uniquement — pas de lib PDF nécessaire)

## Étapes

```bash
cd scripts/update-text

# 1) PDF -> XML positionné, avec couleurs (fontspec) et gras/italique (<b>/<i>).
#    Les tirets rouges de l'auteur ressortent en color="#ff1f00".
pdftohtml -xml -i -hidden "/chemin/vers/nouvelle-version.pdf" full.xml

# 2) Détecter les régions de changement (rapport lisible OLD vs NEW).
python3 regions.py            # écrit regions_report.txt  (lit ../../data/<slug>/play.fountain)

# 3) Appliquer automatiquement les régions "dialogue pur".
#    Les régions avec DIDASCALIES/TITRES/gras réécrits sont listées dans MANUAL_SKIP
#    (à éditer à la main ensuite). Écrit play.fountain.new À CÔTÉ de l'original.
python3 executor.py

# 4) Vérifier : re-scanne un Fountain contre le PDF. Doit ne lister QUE
#    les régions manuelles restantes (ou les faux positifs connus).
python3 verify.py ../../data/<slug>/play.fountain.new
```

Puis : éditer à la main les régions `MANUAL_SKIP`, promouvoir `play.fountain.new`
en `play.fountain`, et re-lancer `verify.py`.

## Chemins / paramètres

Les scripts ont le chemin du Fountain et `full.xml` en dur en tête de fichier
(constante `FOUNTAIN`, fichier `full.xml` dans le cwd). `verify.py` prend le Fountain
en argument. Adapter ces constantes pour une autre pièce.

## Ce sur quoi il faut se méfier (limites connues)

- **Faux positifs de normalisation** : `pdftohtml` insère parfois une espace parasite
  autour de `…` ou `« »`, ou là où un tiret rouge est retiré (`venues-.` → `venues .`).
  `verify.py` peut alors signaler une région inchangée. Vérifier visuellement.
- **Texte en gras réordonné** : sur les gros blocs réécrits en gras, l'extraction PDF
  peut mélanger l'ordre des mots (ex. « Sa femme Et ben, avec un autre homme »).
  Pour ces blocs, se fier au **rendu visuel** (`Read` du PDF), pas au texte extrait.
- **Didascalies collées** : les didascalies inline `(…)` et les indications scéniques
  sont toutes en italique ; on les sépare par la profondeur de parenthèses, pas fiable
  à 100 %. Les régions avec indications scéniques sont dans `MANUAL_SKIP`.
- **Nom de perso collé en fin de réplique** : quand une région est suivie d'une réplique-ancre
  qui commence par une didascalie, le nom du perso suivant peut se coller à la fin
  (`contrarié…GERALD`). Après application, chercher les lignes finissant par un nom en
  MAJUSCULES et les nettoyer.
- **Cue mal orthographié dans le PDF** : si l'auteur tape un nom de perso fautif (`GERLAD`
  pour `GERALD`, ou une variante OCR type `GISUEPPE`), `executor.py` ne le reconnaît pas
  comme cue (il n'est pas dans `SPEAKERS`) et **fond la réplique dans la précédente**.
  Après application, chercher un nom en MAJUSCULES suivi de ` : ` *au milieu* d'une ligne
  (`grep -nE '[A-ZÀ-Ü]{2,} : '`) — en Fountain un cue n'a jamais de `:`, donc toute
  occurrence = un cue fondu à re-séparer.
- **Éditeur ouvert en parallèle** : si le `.fountain` est ouvert dans un éditeur pendant
  qu'un script/Claude le modifie, une sauvegarde depuis l'éditeur écrase silencieusement
  les modifs (buffer périmé). Committer tôt, et re-vérifier après toute édition manuelle.
- **Coquilles de l'auteur** : préservées verbatim (ex. « Merci de vous fidélité » ≈
  « de votre fidélité »). À signaler à l'auteur, ne pas « corriger » d'office.

## Fichiers

- `regions.py`   — détection + rapport OLD/NEW par région
- `executor.py`  — application auto des régions dialogue + `MANUAL_SKIP`
- `verify.py`    — re-scan d'un Fountain contre le PDF (prend le chemin en argument)
- `segment.py`   — découpe le PDF en unités (réplique / didascalie / titre) [expérimental]
- `annotate.py`  — dump du PDF avec marquage des runs rouges/gras (debug des marques)
