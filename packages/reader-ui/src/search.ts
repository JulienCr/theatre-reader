/**
 * Recherche plein texte dans le DOM d'une pièce rendue.
 *
 * DOM pur, sans React : le lecteur web et le lecteur mobile exporté ont besoin
 * exactement du même comportement, et ils n'ont pas le même hôte. Ce module
 * remplace deux implémentations qui avaient divergé en se recopiant
 * (`Reader.tsx` et `reader-runtime/src/index.ts`).
 *
 * On expose un **contrôleur** plutôt que des fonctions isolées, parce que ce
 * qui était réellement dupliqué, c'est l'état : la liste des marques posées et
 * l'index du résultat courant. Les deux appelants le tenaient à la main, l'un
 * dans des refs React, l'autre dans des variables de module.
 *
 * Le contrôleur **mute le DOM** (il enrobe les occurrences dans des `<mark>`) :
 * il s'applique donc au HTML rendu par @theatre/core, que React ne possède
 * jamais. `clear()` restaure le texte d'origine et refusionne les nœuds texte.
 */

/** En deçà, une recherche renverrait la moitié de la pièce. */
export const MIN_QUERY_LENGTH = 2;

const HIT_CLASS = 'reader-hit';
const CURRENT_CLASS = 'reader-hit--current';

/** Sous-arbres dont le texte n'est jamais surligné (MARK : déjà surligné). */
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'MARK']);

/**
 * Parcours explicite plutôt que `document.createTreeWalker(root, SHOW_TEXT, …)` :
 * happy-dom, l'environnement de test du dépôt, ignore le masque `SHOW_TEXT` et
 * ne renvoie alors aucun nœud — le module deviendrait intestable sans ajouter
 * jsdom. Le comportement est identique et le coût négligeable à l'échelle d'une
 * pièce. Ne pas « optimiser » en revenant au TreeWalker.
 */
function collectTextNodes(root: Node): Text[] {
  const out: Text[] = [];
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === 3) {
      if (child.nodeValue) out.push(child as Text);
    } else if (child.nodeType === 1 && !SKIPPED_TAGS.has((child as Element).tagName)) {
      out.push(...collectTextNodes(child));
    }
  }
  return out;
}

export interface SearchController {
  /** Surligne `query` et cadre le premier résultat. Renvoie le nombre de résultats. */
  run(query: string): number;
  /** Avance de `delta` résultats (cyclique). Renvoie le nouvel index, 0-based. */
  step(delta: number): number;
  /** Retire toutes les marques et restaure le texte d'origine. */
  clear(): void;
  /** Nombre de résultats de la recherche courante. */
  readonly count: number;
  /** Index 0-based du résultat courant (0 s'il n'y en a aucun). */
  readonly index: number;
}

export function createSearch(root: HTMLElement): SearchController {
  let marks: HTMLElement[] = [];
  let index = 0;

  function clear(): void {
    for (const mark of marks) {
      const parent = mark.parentNode;
      // Marque orpheline : le conteneur a été vidé entre-temps (re-pagination
      // du lecteur web). Rien à restaurer, on la laisse partir.
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
      parent.normalize();
    }
    marks = [];
    index = 0;
  }

  function focus(i: number): void {
    marks.forEach((m, k) => m.classList.toggle(CURRENT_CLASS, k === i));
    marks[i]?.scrollIntoView({ block: 'center' });
  }

  function mark(query: string): void {
    const needle = query.toLowerCase();

    // On collecte d'abord, on remplace ensuite : remplacer en cours de parcours
    // ferait manquer des nœuds.
    const targets = collectTextNodes(root).filter((t) =>
      (t.nodeValue ?? '').toLowerCase().includes(needle),
    );

    for (const textNode of targets) {
      const text = textNode.nodeValue ?? '';
      const haystack = text.toLowerCase();
      const frag = document.createDocumentFragment();
      let last = 0;
      let at = haystack.indexOf(needle, 0);
      while (at !== -1) {
        if (at > last) frag.appendChild(document.createTextNode(text.slice(last, at)));
        const el = document.createElement('mark');
        el.className = HIT_CLASS;
        // Découpé dans le texte d'origine, pas dans la version bas-de-casse :
        // la casse et les accents de la pièce doivent être préservés.
        el.textContent = text.slice(at, at + query.length);
        frag.appendChild(el);
        marks.push(el);
        last = at + query.length;
        at = haystack.indexOf(needle, last);
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      textNode.parentNode?.replaceChild(frag, textNode);
    }
  }

  return {
    run(query) {
      clear();
      const trimmed = query.trim();
      if (trimmed.length >= MIN_QUERY_LENGTH) mark(trimmed);
      if (marks.length) focus(0);
      return marks.length;
    },
    step(delta) {
      if (!marks.length) return 0;
      index = (index + delta + marks.length) % marks.length;
      focus(index);
      return index;
    },
    clear,
    get count() {
      return marks.length;
    },
    get index() {
      return index;
    },
  };
}
