/**
 * Création d'une note par sélection : à la fin d'une sélection contenue dans un
 * seul bloc `[data-ni]`, affiche un tooltip flottant « ➕ Note ». Au clic,
 * calcule l'ancre (nodeIndex + décalages dans le textContent du bloc + citation)
 * et la remonte via `onRequestCreate`. Interactif (Selection API) — vérifié par
 * Playwright, pas en unit.
 */

export interface AnchorDraft {
  nodeIndex: number;
  start: number;
  end: number;
  quote: string;
}

/** Bloc annotable ancêtre (`[data-ni]`) d'un nœud, borné au conteneur. */
function blockOf(container: HTMLElement, node: Node | null): HTMLElement | null {
  let el: HTMLElement | null =
    node && node.nodeType === Node.TEXT_NODE
      ? (node.parentElement as HTMLElement | null)
      : (node as HTMLElement | null);
  while (el && el !== container) {
    if (el.hasAttribute?.('data-ni')) return el;
    el = el.parentElement;
  }
  return null;
}

export function enableCreation(
  container: HTMLElement,
  opts: { onRequestCreate: (anchor: AnchorDraft, rect: DOMRect) => void },
): () => void {
  const doc = container.ownerDocument;
  const tip = doc.createElement('button');
  tip.type = 'button';
  tip.className = 'note-tip';
  tip.textContent = '➕ Note';
  Object.assign(tip.style, {
    position: 'absolute',
    display: 'none',
    zIndex: '60',
    padding: '4px 8px',
    font: '13px sans-serif',
    background: '#1f2937',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,.25)',
  });
  doc.body.appendChild(tip);

  let pending: AnchorDraft | null = null;
  const hide = () => {
    tip.style.display = 'none';
    pending = null;
  };

  const onEnd = () => {
    const sel = doc.defaultView?.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return hide();
    const range = sel.getRangeAt(0);
    const startBlock = blockOf(container, range.startContainer);
    const endBlock = blockOf(container, range.endContainer);
    if (!startBlock || startBlock !== endBlock) return hide();
    const quote = range.toString();
    if (!quote.trim()) return hide();
    const pre = doc.createRange();
    pre.selectNodeContents(startBlock);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    pending = {
      nodeIndex: Number(startBlock.getAttribute('data-ni')),
      start,
      end: start + quote.length,
      quote,
    };
    const rect = range.getBoundingClientRect();
    const view = doc.defaultView!;
    tip.style.left = `${view.scrollX + rect.left + rect.width / 2 - 32}px`;
    tip.style.top = `${view.scrollY + rect.top - 38}px`;
    tip.style.display = 'block';
  };

  const deferEnd = () => setTimeout(onEnd, 0);
  // Empêche le tooltip de voler le focus / d'effacer la sélection.
  tip.addEventListener('mousedown', (e) => e.preventDefault());
  tip.addEventListener('click', () => {
    if (pending) {
      const rect = tip.getBoundingClientRect();
      opts.onRequestCreate(pending, rect);
    }
    const sel = doc.defaultView?.getSelection();
    sel?.removeAllRanges();
    hide();
  });
  container.addEventListener('mouseup', deferEnd);
  container.addEventListener('touchend', deferEnd);
  const onSelChange = () => {
    const sel = doc.defaultView?.getSelection();
    if (!sel || sel.isCollapsed) hide();
  };
  doc.addEventListener('selectionchange', onSelChange);

  return () => {
    container.removeEventListener('mouseup', deferEnd);
    container.removeEventListener('touchend', deferEnd);
    doc.removeEventListener('selectionchange', onSelChange);
    tip.remove();
  };
}
