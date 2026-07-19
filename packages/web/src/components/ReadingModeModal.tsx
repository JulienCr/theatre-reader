/**
 * Modale de choix du mode de lecture (mobile-first), modulaire :
 *  - Continu / Répétition (interrupteur maître)
 *  - options de répétition indépendantes (masquer, répéter, avancement auto, bip)
 *  - mes rôles (multi-sélection)
 *
 * Réutilise la coque .progress-overlay/.progress-card, avec en plus la fermeture
 * par Échap et un piège de focus (absents de AudioProgressModal).
 */
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Character } from '@theatre/core';
import type { ReadingSettings } from '@theatre/audio-player';

const OPTIONS: { key: keyof ReadingSettings; label: string; hint: string }[] = [
  { key: 'mask', label: 'Masquer mes répliques', hint: 'Floutées à l\'écran jusqu\'à ce qu\'elles soient dites.' },
  { key: 'playMine', label: 'Me faire répéter', hint: 'À la reprise, le TTS lit ma réplique (contrôle mémoire).' },
  { key: 'autoAdvance', label: 'Avancement automatique', hint: 'Reprise auto après la durée de ma réplique (sans clic).' },
  { key: 'tick', label: 'Bip quand c\'est à moi', hint: 'Petit son au moment de la pause.' },
];

export function ReadingModeModal({
  settings,
  myRoles,
  characters,
  onSettings,
  onRoles,
  onClose,
}: {
  settings: ReadingSettings;
  myRoles: string[];
  characters: Character[];
  onSettings: (patch: Partial<ReadingSettings>) => void;
  onRoles: (cids: string[]) => void;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cardRef.current?.querySelector<HTMLElement>('input, select, button')?.focus();
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    e.stopPropagation(); // n'atteint pas les raccourcis du lecteur (Échap notamment)
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      const card = cardRef.current;
      if (!card) return;
      const items = card.querySelectorAll<HTMLElement>(
        'input, select, button, [tabindex]:not([tabindex="-1"])',
      );
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const toggleRole = (id: string): void => {
    onRoles(myRoles.includes(id) ? myRoles.filter((r) => r !== id) : [...myRoles, id]);
  };

  return (
    <div className="progress-overlay" onClick={onClose}>
      <div
        className="progress-card reading-mode-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reading-mode-title"
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h3 id="reading-mode-title">Mode de lecture</h3>

        <div className="reading-mode-seg">
          <button
            className={!settings.rehearsal ? 'on' : ''}
            aria-pressed={!settings.rehearsal}
            onClick={() => onSettings({ rehearsal: false })}
          >
            Continu
          </button>
          <button
            className={settings.rehearsal ? 'on' : ''}
            aria-pressed={settings.rehearsal}
            onClick={() => onSettings({ rehearsal: true })}
          >
            Répétition
          </button>
        </div>

        <fieldset className="reading-mode-opts" disabled={!settings.rehearsal}>
          {OPTIONS.map((o) => (
            <label key={o.key} className="reading-mode-option">
              <input
                type="checkbox"
                checked={settings[o.key]}
                onChange={(e) => onSettings({ [o.key]: e.target.checked })}
              />
              <span className="reading-mode-text">
                <span className="reading-mode-label">{o.label}</span>
                <span className="reading-mode-hint">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="reading-mode-roles">
          <div className="reading-mode-subhead">Mes rôles</div>
          {characters.map((c) => (
            <label key={c.id} className="reading-mode-role">
              <input
                type="checkbox"
                checked={myRoles.includes(c.id)}
                onChange={() => toggleRole(c.id)}
              />
              {c.canonicalName}
            </label>
          ))}
        </div>

        <div className="progress-actions">
          <button onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
