// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Note } from '@theatre/core';
import { clearAnnotations, decorate, wrapOffsets } from './index';

function note(over: Partial<Note>): Note {
  return {
    id: 'n1', nodeId: 'aaa#0', start: 0, end: 0, quote: '', body: 'x',
    createdAt: '', updatedAt: '', ...over,
  };
}

describe('@theatre/annotations', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="c"><p class="line" data-nid="aaa#0">MICHEL : Bonjour à tous.</p>' +
      '<p class="line" data-nid="bbb#0">BENJI : Salut.</p></div>';
    root = document.getElementById('c') as HTMLElement;
  });

  it('wrapOffsets enrobe la plage dans un <mark>', () => {
    const block = root.querySelector('[data-nid="aaa#0"]') as HTMLElement;
    const marks = wrapOffsets(block, 9, 16, 'n1'); // "Bonjour"
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe('Bonjour');
    expect(marks[0]!.getAttribute('data-note-id')).toBe('n1');
    expect(block.textContent).toBe('MICHEL : Bonjour à tous.'); // texte inchangé
  });

  it('decorate surligne les notes résolues et appelle onActivate au clic', () => {
    let activated: string | null = null;
    const notes = [note({ id: 'a', nodeId: 'aaa#0', start: 9, end: 16, quote: 'Bonjour' })];
    const { orphans } = decorate(root, notes, { onActivate: (id) => (activated = id) });
    expect(orphans).toHaveLength(0);
    const mark = root.querySelector('mark.note-anchor') as HTMLElement;
    expect(mark.textContent).toBe('Bonjour');
    mark.click();
    expect(activated).toBe('a');
  });

  it('classe orpheline une note dont la citation ne correspond plus', () => {
    const notes = [note({ id: 'b', nodeId: 'aaa#0', start: 9, end: 16, quote: 'Bonsoir' })];
    const { orphans } = decorate(root, notes);
    expect(orphans.map((o) => o.id)).toEqual(['b']);
    expect(root.querySelector('mark.note-anchor')).toBeNull();
  });

  it('classe orpheline une note pointant un nodeId absent', () => {
    const notes = [note({ id: 'c', nodeId: 'zzz#0', start: 0, end: 3, quote: 'XXX' })];
    expect(decorate(root, notes).orphans.map((o) => o.id)).toEqual(['c']);
  });

  it('clearAnnotations retire les marques et restaure le texte', () => {
    decorate(root, [note({ id: 'a', nodeId: 'aaa#0', start: 9, end: 16, quote: 'Bonjour' })]);
    clearAnnotations(root);
    expect(root.querySelector('mark.note-anchor')).toBeNull();
    expect((root.querySelector('[data-nid="aaa#0"]') as HTMLElement).textContent).toBe('MICHEL : Bonjour à tous.');
  });

  it('re-décorer ne cumule pas les marques', () => {
    const notes = [note({ id: 'a', nodeId: 'aaa#0', start: 9, end: 16, quote: 'Bonjour' })];
    decorate(root, notes);
    decorate(root, notes);
    expect(root.querySelectorAll('mark.note-anchor')).toHaveLength(1);
  });
});
