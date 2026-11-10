export interface StartTarget {
  kind: 'line' | 'heading';
  value: string;
}

/**
 * Decodes `BootOptions.startAt`: `n:<data-nid>` is a tirade, `h:<id>` a heading. A bare
 * fragment is a heading id (legacy `#h-4`, still produced by the TOC links of `render.ts`).
 */
export function parseStartAt(startAt: string): StartTarget {
  if (startAt.startsWith('n:')) return { kind: 'line', value: startAt.slice(2) };
  if (startAt.startsWith('h:')) return { kind: 'heading', value: startAt.slice(2) };
  return { kind: 'heading', value: startAt };
}
