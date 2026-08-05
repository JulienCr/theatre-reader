# Plan d'apprentissage d'un rôle — design

Date : 2026-08-05
Branche : `worktree-plan-apprentissage` (basée sur `main` @967fc1c)

> Amendé après implémentation. Sept points de la conception initiale se sont
> révélés faux ou infaisables une fois le code écrit et vérifié dans le
> navigateur : le type de `Session.orphans`, la longueur de l'échelle
> d'espacement, la sémantique d'erreur de `loadStudy`, la provenance du rôle
> pré-rempli, la formule de `capacityPerDay`, la navigation vers une portion, et
> le sort des répliques hors scène. Le document ci-dessous dit l'état réel du
> code, pas l'intention de départ.

## Objectif

Aider un comédien à apprendre son rôle d'ici une date donnée, en dérivant le travail
du jour du texte réel plutôt que d'un calendrier saisi à la main. L'app connaît déjà
le rôle joué (`myRoles`), le découpage en scènes et le contenu de chaque réplique :
elle a tout ce qu'il faut pour dire quoi travailler aujourd'hui, et si la date tient.

Mesuré sur `tout-le-monde-se-tire`, rôle BENJI : 157 répliques, 1 584 mots, 41 % de
répliques de cinq mots ou moins. C'est ce profil — beaucoup de répliques courtes, peu
de longues tirades — qui motive la formule de coût ci-dessous.

## Décisions de cadrage

Quatre choix arrêtés avec l'utilisateur avant rédaction :

1. **Web d'abord**, mobile dans un second lot.
2. **Aucun calendrier n'est stocké.** On persiste la configuration et l'état
   d'avancement ; la séance du jour est recalculée à chaque ouverture. Prendre du
   retard redistribue la charge sans intervention.
3. **Auto-évaluation à trois niveaux** après chaque portion (*pas su* / *hésitant* /
   *su*), qui pilote l'espacement des révisions.
4. **Moteur pur dans `@theatre/core`, état dans `data/<slug>/study.json`** servi par
   une route Fastify calquée sur celle des notes. `@theatre/core` étant déjà une
   dépendance de `mobile-app`, le second lot n'aura qu'un écran à écrire.

L'apprentissage est un **troisième mode plein écran** à côté d'Édition et Lecture, pas
un panneau du dock.

## Modèle de données

`data/<slug>/study.json` :

```ts
interface StudyState {
  version: 1;
  config: StudyConfig;
  /** Indexé par nodeId (identifiant de contenu stable, cf. buildNodeIds). */
  progress: Record<string, NodeState>;
}

interface StudyConfig {
  roleIds: string[];
  /** Date d'atterrissage, 'YYYY-MM-DD'. */
  target: string;
  sessionMinutes: number;
  /** 1..7 — sert au calcul de capacité, pas à fixer des jours précis. */
  daysPerWeek: number;
}

interface NodeState {
  /** 0..5 — position dans l'échelle d'espacement. */
  level: number;
  /** Prochaine révision, 'YYYY-MM-DD'. */
  due: string;
  lastSeen: string;
}
```

**L'état est ancré sur les `nodeId`, pas sur les portions.** C'est le point non
évident du design. Une portion est une vue calculée : sa taille dépend du budget de
séance, donc changer `sessionMinutes` redécoupe tout. Si la progression était indexée
par portion, ce simple réglage effacerait un mois de travail. Indexée par nœud, elle
survit au redécoupage, aux modifications du texte (un nœud disparu perd son état, les
autres restent) et au changement de rôle.

L'évaluation se saisit par portion et s'applique à chacun de ses nœuds ; l'état
affiché d'une portion est l'agrégat de ses nœuds — `level` = le minimum (une portion
vaut son maillon faible), due si **au moins un** nœud est dû.

## `core/src/study.ts`

Module pur, sans DOM ni I/O, dans la lignée de `scenes.ts` et `notes.ts`.

```ts
export interface Portion {
  id: string;          // dérivé des nodeIds — vue calculée, jamais persisté comme clé
  actLabel: string;
  sceneLabel: string;
  sceneId: string;     // 'h-<index>', identique à buildToc et à la nav du lecteur
  fromTirade: number;  // 1-based dans la numérotation du rôle (celle du PDF de tirades)
  toTirade: number;
  nodeIds: string[];
  words: number;
  lines: number;
  shortLines: number;  // répliques de 5 mots ou moins
  cost: number;
}

export type Grade = 'again' | 'hard' | 'good';

export interface Session {
  due: Portion[];      // à réviser, les plus en retard d'abord
  fresh: Portion[];    // texte neuf
  orphans: string[];   // nodeId dont l'ancrage est perdu (texte modifié)
  minutes: number;     // charge estimée de la séance
}

export interface Forecast {
  status: 'ok' | 'tight' | 'late';
  daysLeft: number;        // jours ouvrés restants (daysPerWeek appliqué)
  portionsLeft: number;    // portions jamais vues
  neededPerDay: number;
  capacityPerDay: number;
}

export function splitIntoPortions(play: Play, roleIds: string[], budgetCost: number): Portion[];
export function gradeNodes(state: StudyState, nodeIds: string[], grade: Grade, today: string): StudyState;
export function planSession(portions: Portion[], state: StudyState, today: string): Session;
export function forecast(portions: Portion[], state: StudyState, today: string): Forecast;
```

Toutes les fonctions sont déterministes : la date du jour est **passée en paramètre**,
jamais lue depuis l'horloge. C'est ce qui rend le moteur testable sans geler le temps.

### Découpage

On parcourt les répliques du rôle dans l'ordre de la pièce et on ferme une portion
quand son coût cumulé atteint `budgetCost`. Une portion ne franchit jamais une
frontière de scène : une scène plus courte que le budget donne une portion plus
petite, sans regroupement avec la suivante. Une portion plus longue que le budget est
coupée à l'intérieur de la scène.

### Coût

```
coût(réplique) = mots + K × 1        avec K = 3.5
coût(portion)  = Σ coût(répliques)
```

Compter les mots seuls ne marche pas sur ce texte : une scène de vingt « Ouais » pèse
40 mots et coûte une séance entière, parce que le travail y est dans l'accroche, pas
dans le texte. Le terme `K` par réplique capture ce coût d'enchaînement.

Conversion en durée : `COST_PER_MINUTE = 4.5`, et une révision coûte
`REVIEW_FACTOR = 0.35` de son coût d'acquisition. Ces trois constantes sont calibrées
sur le rôle de BENJI (2 134 unités de coût ≈ 19 séances de 25 min, cohérent avec
l'estimation manuelle de 8 à 12 heures) et exportées pour rester ajustables.

Le budget passé à `splitIntoPortions` en découle : `budgetCost = sessionMinutes ×
COST_PER_MINUTE × 0.6`. Le facteur 0.6 réserve le reste de la séance aux révisions —
sans lui, une portion neuve remplirait la séance entière et rien ne serait jamais
revu. `Session.minutes` applique la conversion inverse : `(Σ coût des neuves + Σ coût
des dues × REVIEW_FACTOR) / COST_PER_MINUTE`.

### Espacement

Échelle : `INTERVALS = [1, 3, 7, 14, 30, 60]` jours, indexée par `level`, et
`MAX_LEVEL = INTERVALS.length - 1`. Les deux sont liés délibérément : une échelle de
cinq valeurs pour un plafond à 5 laissait `INTERVALS[5]` indéfini.

| Note | `level` | `due` |
|---|---|---|
| `again` (pas su) | `max(0, level - 1)` | demain |
| `hard` (hésitant) | inchangé | +2 jours |
| `good` (su) | `min(MAX_LEVEL, level + 1)` | +échelle[nouveau level] |

Un nœud jamais vu n'a pas d'entrée dans `progress` : c'est ce qui distingue le neuf du
révisable, sans champ supplémentaire.

### Séance du jour

1. Les portions **dues** (au moins un nœud dont `due <= today`), triées par retard
   décroissant puis par `level` croissant.
2. Complétées par des portions **neuves** dans l'ordre de la pièce, tant que la charge
   estimée reste sous `sessionMinutes`.
3. Le débit de neuf est plafonné par `neededPerDay` du `forecast`, pour ne pas
   engloutir tout le texte le premier jour au détriment des révisions.

Les révisions passent avant le neuf : du texte oublié coûte plus cher que du texte
jamais vu.

### Atterrissage

`daysLeft = floor(jours calendaires jusqu'à target × daysPerWeek / 7 × 0.8)`, la
réserve de 20 % couvrant les filages de fin. `portionsLeft` compte les portions dont
**aucun** nœud n'a d'entrée dans `progress` — jamais abordées, par opposition à
partiellement travaillées. `neededPerDay = portionsLeft / max(1, daysLeft)`.

`capacityPerDay = sessionMinutes × COST_PER_MINUTE / coût moyen des portions restantes`
— la séance **entière**, pas `budgetForSession`. Le ratio de 0,6 borne la taille d'une
portion dans la séance du jour ; l'appliquer aussi ici cumulerait trois marges sur la
même incertitude (ce ratio, la réserve de 20 % des jours, le seuil à 0,8) et annonçait
« hors délai » un rôle qui tient : mesuré sur BENJI, 474 min de travail pour 550 min
disponibles sortaient en retard. Diviser par le coût moyen plutôt que de compter une
portion par jour est tout aussi nécessaire : les frontières de scène produisent des
portions plus petites que le budget (48,5 mesuré pour 67,5).

Statut : `ok` jusqu'à 80 % de la capacité, `tight` jusqu'à 100 %, `late` au-delà ou si
`daysLeft ≤ 0`. L'UI affiche le levier correspondant (allonger les séances, ajouter des
jours, reculer la date) ; le moteur ne renvoie que les nombres.

## Serveur

`GET /api/plays/:slug/study` → `{ study: StudyState | null }`
`PUT /api/plays/:slug/study` → corps `{ study: StudyState }`, `400` si invalide.

`loadStudy` / `saveStudy` dans `storage.ts`, calqués sur `loadNotes` / `saveNotes`,
mêmes garanties : fichier absent = `null`, **JSON corrompu = exception relancée**
et non `null`. Absorber la corruption ferait qu'un `saveStudy` ultérieur écrase
des semaines de progression ; c'est l'UI qui affiche l'erreur sans rien effacer.

## UI web — le mode `study`

`AppMode` passe de `'edit' | 'read'` à `'edit' | 'read' | 'study'`. Cinq points
d'impact, tous mineurs :

- `sessionPrefs.ts` : le type, et la validation de `loadSessionPrefs` qui doit
  accepter `'study'` (un localStorage plus ancien retombe sur `'edit'`, comportement
  déjà en place).
- `TopBar.tsx` : une troisième entrée dans `MODES`, et les deux signatures `mode` /
  `onMode` qui réécrivent l'union à la main — elles passent sur `AppMode`, déjà
  exporté mais inutilisé.
- `App.tsx` : `useState<AppMode>` et la branche de rendu.
- `CommandPalette` : une commande « Séance du jour ».

L'écran, servi par un nouveau `components/StudyMode.tsx` :

- **Non configuré** : rôle pré-rempli — `StudyMode` appelle lui-même
  `loadReadingPrefs(slug, …)` comme le fait `Reader`, avec repli sur
  `audio.myCharacterId` (`myRoles` n'est pas visible depuis `App`) — puis date
  d'atterrissage, durée de séance, jours par semaine. Aperçu recalculé à chaque frappe
  (nombre de portions, charge, statut d'atterrissage) — c'est l'aperçu qui rend le
  réglage compréhensible, pas une explication.
- **Configuré** : la séance du jour, portion par portion. Chaque portion s'ouvre dans
  le lecteur sur le `data-nid` de sa première réplique — et non sur son `sceneId`, que
  le filtre « mes scènes seulement » décale — puis se clôt par les trois boutons
  d'évaluation. Sous la séance, l'avancement par portion et le compte à rebours.

## Cas limites

| Cas | Comportement |
|---|---|
| Aucun rôle pré-remplissable | Renvoi vers la Distribution, pas d'écran vide |
| `target` dépassée | Mode entretien : révisions seules, plus de neuf |
| Texte modifié depuis la config | `nodeId` décrochés listés en `orphans`, effaçables via `pruneOrphans` |
| `study.json` absent | Écran de configuration |
| `study.json` corrompu | Bandeau d'erreur explicite ; reconfigurer écrase, mais le dit |
| Rôle sans réplique | Message explicite |
| `daysLeft <= 0` mais `target` future | `forecast` renvoie `late`, pas de division par zéro |

## Tests

`core/src/study.test.ts` (vitest, pur) :

- découpage déterministe, frontières de scène jamais franchies, portion plus courte
  que le budget en fin de scène ;
- coût : une scène de répliques courtes et une longue tirade de même nombre de mots
  ne reçoivent pas le même coût ;
- les trois transitions de niveau, y compris le plancher à 0 et le plafond à 5 ;
- priorité des révisions sur le neuf, plafond `neededPerDay` ;
- `forecast` : les trois statuts, et `daysLeft <= 0` ;
- cas limites du tableau ci-dessus.

`server/src/study.test.ts` sur le modèle de `notes.test.ts` : aller-retour GET/PUT,
400 sur corps invalide, `null` sur pièce sans fichier.

Pas de test web (le projet n'en a pas ; vérification par script Playwright jetable,
non commité).

## Ajouts après le premier essai à l'usage

Quatre manques signalés en manipulant l'écran, et un défaut qu'ils ont révélé.

- **Annulation.** Une note passée par erreur envoyait la portion à +3 jours sans
  recours. Un cran d'annulation (`undo`), plus les trois notes accessibles depuis la
  liste d'avancement — ce qui couvre aussi le « je croyais la savoir » découvert
  trois jours plus tard.
- **Calendrier prévisionnel** (`projectSchedule`) : le moteur est rejoué jour par
  jour sur un état simulé, en supposant qu'un passage sur trois demandera une reprise
  (`PROJECTION_HARD_EVERY = 3`). Déterministe, rien n'est stocké. Les jours travaillés
  suivent une convention explicite : les `daysPerWeek` premiers de chaque période de
  sept.
- **Export `.ics`** (`core/src/ics.ts`, pur) : un fichier plutôt que l'API Google —
  ni OAuth, ni secret, ni serveur de callback. Heures « flottantes » pour que 19 h 30
  reste 19 h 30 dans l'agenda qui importe, UID par jour pour qu'un ré-export remplace.
  `startTime` entre dans `StudyConfig`, optionnel et rétro-compatible.
- **Réinitialisation** : effacer la progression en gardant les réglages, ou supprimer
  le plan (`DELETE /api/plays/:slug/study`). Confirmation en deux temps, en texte sur
  `--danger` comme l'exigent les jetons.

**Le défaut mis au jour** : les révisions affamaient le texte neuf. `planSession`
plafonnait le neuf par la charge de la séance *en plus* de `maxFresh`, si bien qu'une
fois les révisions à 25 min, plus aucune portion neuve n'était programmée — le plan de
BENJI s'arrêtait à la tirade 117 sur 157 en annonçant pourtant « tendu ». Le neuf ne
suit plus que `maxFresh`. Seule la projection pouvait le montrer : la séance du jour,
prise isolément, paraissait normale.

**Vocabulaire** : « portion » est un mot du moteur et n'atteint plus l'écran. Tout se
compte en tirades, et chaque borne porte son numéro **et** son texte.

## Hors périmètre

Écran mobile, notifications, statistiques historiques, synchronisation multi-appareils
au-delà du fichier partagé, déduction automatique de la maîtrise depuis le lecteur
audio. Ce dernier point est la suite naturelle une fois le moteur en place.
