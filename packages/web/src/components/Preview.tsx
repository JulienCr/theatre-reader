/** Aperçu live : parse le Fountain et rend le même HTML/CSS que l'export PDF. */
import { useEffect, useMemo, useRef } from 'react';
import {
  parseFountain,
  renderBody,
  renderCSS,
  type Character,
  type Note,
  type Template,
} from '@theatre/core';
import { annotationCss, type AnchorDraft } from '@theatre/annotations';
import { useAnnotations } from '../useAnnotations';

export function Preview({
  fountain,
  characters,
  template,
  notes,
  editable,
  onActivate,
  onRequestCreate,
  onOrphans,
}: {
  fountain: string;
  characters: Character[];
  template: Template;
  notes: Note[];
  editable: boolean;
  onActivate: (id: string, rect: DOMRect) => void;
  onRequestCreate: (anchor: AnchorDraft, rect: DOMRect) => void;
  onOrphans?: (orphans: Note[]) => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const { css, body } = useMemo(() => {
    try {
      const play = parseFountain(fountain, characters);
      return { css: renderCSS(template), body: renderBody(play, template) };
    } catch (e) {
      return { css: '', body: `<p style="color:#b00">Erreur de rendu : ${String(e)}</p>` };
    }
  }, [fountain, characters, template]);

  // Injecte le CSS d'annotation une seule fois.
  useEffect(() => {
    const id = 'annotation-css';
    if (!document.getElementById(id)) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = annotationCss;
      document.head.appendChild(style);
    }
  }, []);

  useAnnotations(sheetRef, notes, {
    editable,
    redecorateKey: body,
    onActivate,
    onRequestCreate,
    onOrphans,
  });

  return (
    <div className="preview">
      <style>{css}</style>
      <div className="preview-sheet" ref={sheetRef} dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}
