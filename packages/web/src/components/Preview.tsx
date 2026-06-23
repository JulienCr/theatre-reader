/** Aperçu live : parse le Fountain et rend le même HTML/CSS que l'export PDF. */
import { useMemo } from 'react';
import {
  parseFountain,
  renderBody,
  renderCSS,
  type Character,
  type Template,
} from '@theatre/core';

export function Preview({
  fountain,
  characters,
  template,
}: {
  fountain: string;
  characters: Character[];
  template: Template;
}) {
  const { css, body } = useMemo(() => {
    try {
      const play = parseFountain(fountain, characters);
      return { css: renderCSS(template), body: renderBody(play, template) };
    } catch (e) {
      return { css: '', body: `<p style="color:#b00">Erreur de rendu : ${String(e)}</p>` };
    }
  }, [fountain, characters, template]);

  return (
    <div className="preview">
      <style>{css}</style>
      <div className="preview-sheet" dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}
