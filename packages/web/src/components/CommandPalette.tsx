/**
 * Palette de commandes (⌘K / Ctrl+K) : lance toute action au clavier.
 * Filtre par texte, navigation ↑/↓, Entrée pour exécuter, Échap pour fermer.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

export interface Command {
  id: string;
  label: string;
  /** Regroupement affiché (ex. « Aller à »). */
  group?: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => `${c.group ?? ''} ${c.label}`.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // Focus après le rendu de l'overlay.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  if (!open) return null;

  const run = (cmd?: Command) => {
    if (!cmd) return;
    onClose();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Empêche les raccourcis globaux (lecteur) de réagir aux touches de la palette.
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (e.key === 'ArrowDown') {
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      run(filtered[active]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Tapez une commande…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul className="palette-list" ref={listRef}>
          {filtered.length === 0 && <li className="palette-empty">Aucune commande</li>}
          {filtered.map((c, i) => (
            <li
              key={c.id}
              className={`palette-item${i === active ? ' palette-item--active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(c)}
              ref={(el) => {
                if (i === active) el?.scrollIntoView({ block: 'nearest' });
              }}
            >
              {c.group && <span className="palette-group">{c.group}</span>}
              <span className="palette-label">{c.label}</span>
              {c.hint && <span className="palette-hint">{c.hint}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
