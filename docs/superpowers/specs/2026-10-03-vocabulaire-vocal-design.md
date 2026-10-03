# Vocabulaire souffleur pour la reconnaissance vocale — design

Date : 2026-10-03
Branche : `feat/voice-vocabulary` (empilée sur `feat/voice-equivalences`)

## Objectif

Le moteur de reconnaissance d'iOS (`SFSpeechRecognizer`) transcrit mal les mots
absents de son vocabulaire : noms de personnages, mots inventés (« chévéloure »),
emprunts. Une tirade dite juste échoue alors, et la table d'équivalences de
`@theatre/voice-match` ne peut rien : le moteur n'a pas produit le bon mot, il en a
produit un autre qui ne lui ressemble pas assez.

`SFSpeechRecognitionRequest.contextualStrings` permet de souffler au moteur des
mots probables. Ce document décrit comment calculer, pour chaque pièce, la liste
des mots à souffler, quand la recalculer, et comment elle arrive au plugin natif.

Critère de réussite : sur appareil, une tirade contenant « chévéloure » ou un nom de
personnage peu courant est transcrite avec ce mot, là où elle échouait.
**Cette amélioration n'est pas démontrée à l'écriture de la spec** (cf. Risques).

## Décisions de cadrage

Arrêtées avec l'utilisateur :

1. **Détection par heuristique + correcteur orthographique de macOS**, pas par
   mesure sur le moteur. Automatique, sans enregistrement ni dépendance. Un bench du
   moteur pour élaguer la liste est une suite possible, pas ce lot.
2. **Recalcul à chaque export / synchronisation**, rien n'est stocké côté serveur :
   une liste persistée serait fausse après la première modification du texte. Même
   principe que `planSession` pour le plan d'apprentissage.
3. **La liste voyage avec la pièce**, pas dans un réglage de l'app.

## Mesures qui fondent la conception

Faites le 2026-10-03 sur `tout-le-monde-se-tire` (18 174 mots) avec `NSSpellChecker`
en français :

- 3 350 mots distincts, dont **176 inconnus** du correcteur : trop pour une liste
  qu'on veut courte, donc le classement compte autant que la détection.
- « chévéloure » est bien signalé inconnu (« chevelure » est connu).
- **« Giuseppe » et « Benji » sont connus** du correcteur : les noms de personnages
  ne peuvent donc pas venir de lui, ils viennent de `meta.characters`.
- Les inconnus mêlent du signal (« chévéloure », « Corléone », « burrata »,
  « Gremlins », « allora », « ancora ») et du bruit probable : des mots déformés
  EXPRÈS par le texte pour dire un personnage qui se trompe (« démandérai »,
  « espliqué », « auyourd »). Le moteur les entend correctement ; les lui souffler
  avec cette orthographe n'aide sans doute pas, et pourrait nuire.
- Le correcteur compilé répond en ~0,5 s pour toute la pièce ; la compilation
  `swiftc` prend ~5 s, une fois.

## Architecture

Quatre unités, chacune testable seule.

### 1. `vocabulary.ts` — `@theatre/voice-match` (pur)

```ts
buildVocabulary({
  characterNames: string[],
  speechTexts: string[],
  isKnown: (word: string) => boolean,
  max?: number, // 100 par défaut
}): string[]
```

Ordre de la liste, jusqu'à `max` :

1. Noms de personnages, mis en forme « Giuseppe » (pas « GIUSEPPE »).
2. Noms propres du texte (`Token.proper`, cf. `normalize.ts`) absents de la liste.
3. Mots inconnus (`!isKnown`), du plus fréquent au moins fréquent, puis alphabétique
   pour un résultat stable.

Pur et sans I/O : le correcteur est INJECTÉ (`isKnown`), comme le recognizer l'est
dans `audio-player`. Les textes passés sont les textes DITS : didascalies exclues.
Aucune déduplication hors casse : « Corléone » et « corléone » comptent pour un seul.

Délibérément absent : un filtre des mots déformés exprès. On les laisse classés
par fréquence et on regarde sur appareil s'ils gênent.

### 2. `spell.ts` — `@theatre/server` (I/O)

Un script Swift appelant `NSSpellChecker` (langue `fr`), compilé une fois avec
`swiftc` et mis en cache dans un dossier de cache ignoré par git. Reçoit tous les
mots distincts d'un coup (stdin), rend les inconnus. Expose
`unknownWords(words: string[]): Promise<Set<string>>`.

**Dégradation sans casse** : hors macOS, sans `swiftc`, ou sur erreur, la fonction
rend « tout est connu » et journalise un avertissement. La liste se réduit alors aux
noms de personnages et aux noms propres ; l'export ne casse jamais (même esprit que
l'export audio sans clé ElevenLabs).

### 3. Calcul et mémoïsation — `@theatre/server`

`playVocabulary(slug)` : lit la pièce, extrait les textes dits de l'AST
(`speechText` des répliques, didascalies exclues), appelle `unknownWords` puis
`buildVocabulary`. Mémoïsé en mémoire sur `sha1(fountain + noms de personnages)` :
un texte inchangé ne repaie pas le correcteur, un texte modifié se recalcule seul.

Exposée de deux façons :

- **Export `.html`** (`reader-export.ts`) : appel direct, résultat dans les données
  du lecteur.
- **Route `GET /api/plays/:slug/vocabulary`** → `{ vocabulary: string[] }`, appelée
  par l'app mobile à la synchronisation. Route distincte de `GET /api/plays/:slug`
  pour ne pas faire payer le correcteur à chaque chargement de l'éditeur web.

### 4. Transport jusqu'au plugin

L'app mobile **reconstruit elle-même** le lecteur à partir de `{ fountain, meta }`
stockés pour le hors-ligne (`offline/store.ts`, `main.ts` → `buildReaderDocument`).
Elle ne peut pas appeler `NSSpellChecker` côté téléphone : la liste doit donc être
calculée par le serveur et **stockée avec la pièce**.

```
serveur ─ playVocabulary ─┬─ export .html ──► data.voiceVocabulary
                          └─ GET /vocabulary ─► prepareOffline ─► StoredPlay.vocabulary
                                                                      │
mobile main.ts ─ buildReaderDocument(input.vocabulary) ─► data.voiceVocabulary
reader-runtime boot ─ lit data.voiceVocabulary ─► voice coach
SpeechRecognizer.start({ locale, contextualStrings })
native.ts ─► SpeechPlugin.swift : req.contextualStrings = …
```

Changements d'interface, tous additifs et optionnels :

- `ReaderData` (`reader-runtime/src/types.ts`) : `voiceVocabulary?: string[]`.
- `ReaderDocumentInput` (`reader-ui/src/document.ts`) : `vocabulary?: string[]`.
- `StoredPlay` (`mobile-app/src/offline/store.ts`) : `vocabulary?: string[]`. Une
  pièce synchronisée avant ce lot n'en a pas : le lecteur marche comme avant.
- `SpeechRecognizer.start` (`audio-player/src/voice.ts`) : `contextualStrings?: string[]`.
  Le faux recognizer de développement l'ignore.
- `SpeechPlugin.swift` : lit `contextualStrings` dans `start` et le pose sur la
  requête. Absent ou vide : comportement actuel.

## Gestion des erreurs

- Correcteur indisponible : liste réduite (noms + noms propres), avertissement
  journalisé, pas d'échec d'export ni de route.
- Route `/vocabulary` en erreur côté app : la synchronisation de la pièce continue
  sans vocabulaire ; la voix marche comme aujourd'hui.
- Liste vide : aucun `contextualStrings` posé, rien ne change.

## Tests

- `vocabulary.test.ts` (pur, `isKnown` factice) : noms d'abord et mis en forme,
  noms propres ensuite, inconnus par fréquence, plafond respecté, résultat stable,
  didascalies absentes des entrées, `isKnown` qui accepte tout → noms seuls.
- `spell` : un test de fumée, ignoré hors macOS, qui vérifie « chévéloure »
  inconnu et « chevelure » connu ; un test de dégradation (binaire absent).
- Route et export : la liste arrive dans la réponse et dans le bloc de données.
- Côté Swift et efficacité réelle : **uniquement vérifiables avec `pnpm ios` sur le
  téléphone**. Le critère de réussite se mesure là, pas en test automatique.

## Risques et inconnues

- **Efficacité non démontrée.** `contextualStrings` est un biais, pas une garantie.
  À mesurer sur appareil avec « chévéloure » avant et après.
- **Plafond d'Apple non confirmé.** Je pars d'environ 100 entrées par prudence ;
  la valeur réelle est à vérifier dans la documentation avant de la figer.
- **Mots déformés exprès** : peuvent polluer la liste ou, pire, orienter le moteur
  vers une orthographe qu'il aurait évitée. Premier réglage envisagé si ça gêne :
  les exclure d'office.
- **Serveur / en ligne** : le plugin utilise la reconnaissance serveur d'Apple quand
  il y a du réseau, la locale hors ligne. Il faut vérifier que `contextualStrings`
  agit dans les deux modes sur l'appareil.

## Hors périmètre (suites possibles)

- Réglage `include` / `exclude` par pièce dans `meta.json`, pour forcer ou écarter
  des mots à la main.
- Bench du moteur sur les clips pour élaguer la liste avec ce qu'il rate vraiment.
- Pondération par scène ou par rôle joué.
