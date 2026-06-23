/**
 * Panneau personnages : surlignage (couleur + portée) ET édition — renommer,
 * éditer la description (affichée dans la Distribution), voir les alias et
 * fusionner un personnage dans un autre (corrige les doublons / coquilles).
 */
import { useState } from 'react';
import type { Character, HighlightScope, Template } from '@theatre/core';
import { ColorField, Select } from './controls';

const PALETTE = ['#fff176', '#a5d6a7', '#90caf9', '#f48fb1', '#ffcc80', '#ce93d8', '#80deea'];

export function CharactersPanel({
  characters,
  template,
  onChange,
  onCharactersChange,
}: {
  characters: Character[];
  template: Template;
  onChange: (t: Template) => void;
  onCharactersChange: (c: Character[]) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const highlightOf = (id: string) => template.highlights.find((h) => h.characterId === id);

  const updateHighlight = (
    id: string,
    next: { color: string; scope: HighlightScope } | null,
  ) => {
    const others = template.highlights.filter((h) => h.characterId !== id);
    onChange({
      ...template,
      highlights: next ? [...others, { characterId: id, ...next }] : others,
    });
  };

  const patchChar = (id: string, patch: Partial<Character>) =>
    onCharactersChange(characters.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const mergeInto = (sourceId: string, targetId: string) => {
    const source = characters.find((c) => c.id === sourceId);
    if (!source) return;
    onCharactersChange(
      characters
        .map((c) =>
          c.id === targetId
            ? {
                ...c,
                aliases: [...new Set([...c.aliases, ...source.aliases, source.canonicalName])],
                description: c.description ?? source.description,
              }
            : c,
        )
        .filter((c) => c.id !== sourceId),
    );
    // Retire un éventuel surlignage du personnage absorbé (référence orpheline).
    if (highlightOf(sourceId)) {
      onChange({
        ...template,
        highlights: template.highlights.filter((h) => h.characterId !== sourceId),
      });
    }
    setExpanded(null);
  };

  return (
    <section className="panel">
      <h3>
        Personnages <span className="muted">({characters.length})</span>
      </h3>
      <p className="hint">Surligne, renomme, édite la description ou fusionne les doublons.</p>
      <ul className="char-list">
        {characters.map((c, i) => {
          const hl = highlightOf(c.id);
          const open = expanded === c.id;
          return (
            <li key={c.id} className="char-item">
              <div className="char-head">
                <input
                  type="checkbox"
                  title="Surligner ce personnage"
                  checked={Boolean(hl)}
                  onChange={(e) =>
                    updateHighlight(
                      c.id,
                      e.target.checked
                        ? {
                            color: hl?.color ?? PALETTE[i % PALETTE.length]!,
                            scope: hl?.scope ?? 'replique',
                          }
                        : null,
                    )
                  }
                />
                <button
                  type="button"
                  className="char-name-btn"
                  onClick={() => setExpanded(open ? null : c.id)}
                >
                  <span className="char-name">{c.canonicalName}</span>
                  {!c.description && (
                    <span className="badge" title="Absent de la distribution — à vérifier">
                      ?
                    </span>
                  )}
                  <span className="chevron">{open ? '▾' : '▸'}</span>
                </button>
              </div>

              {hl && (
                <div className="char-hl">
                  <ColorField
                    value={hl.color}
                    onChange={(color) => updateHighlight(c.id, { color, scope: hl.scope })}
                  />
                  <Select<HighlightScope>
                    value={hl.scope}
                    options={[
                      { value: 'replique', label: 'Réplique entière' },
                      { value: 'name', label: 'Nom seulement' },
                    ]}
                    onChange={(scope) => updateHighlight(c.id, { color: hl.color, scope })}
                  />
                </div>
              )}

              {open && (
                <div className="char-edit">
                  <label className="edit-row">
                    <span>Nom</span>
                    <input
                      type="text"
                      value={c.canonicalName}
                      onChange={(e) => patchChar(c.id, { canonicalName: e.target.value })}
                    />
                  </label>
                  <label className="edit-row edit-row--col">
                    <span>Description</span>
                    <textarea
                      rows={4}
                      value={c.description ?? ''}
                      placeholder="Présentation affichée dans la Distribution…"
                      onChange={(e) => patchChar(c.id, { description: e.target.value })}
                    />
                  </label>
                  {c.aliases.length > 0 && (
                    <div className="aliases" title="Orthographes reconnues dans le texte">
                      {c.aliases.map((a) => (
                        <span className="alias-chip" key={a}>
                          {a}
                        </span>
                      ))}
                    </div>
                  )}
                  <label className="edit-row">
                    <span>Fusionner dans</span>
                    <select
                      value=""
                      onChange={(e) => e.target.value && mergeInto(c.id, e.target.value)}
                    >
                      <option value="">— choisir —</option>
                      {characters
                        .filter((o) => o.id !== c.id)
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.canonicalName}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
