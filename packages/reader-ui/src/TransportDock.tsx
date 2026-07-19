/**
 * Dock de transport audio du lecteur : ⏮ ▶/⏸ ⏭ et la bascule « Répétition ».
 *
 * Purement présentationnel — il ne connaît ni le `Player` ni son état interne,
 * tout passe par des props. C'est ce qui permet aux deux lecteurs de le composer
 * différemment : le lecteur mobile le place entre le menu et le bord droit d'une
 * barre fixe, le lecteur web l'insère dans sa propre barre du bas.
 *
 * Il rend deux groupes de barre d'outils frères plutôt qu'un seul bloc : la
 * grappe de transport doit pouvoir être centrée dans la barre pendant que la
 * bascule est poussée au bord. Un conteneur unique interdirait ce placement.
 */
import { Button, IconButton, ToolbarGroup } from '@theatre/ui';

export interface TransportDockProps {
  /** Lecture en cours — hors pause de répétition (cf. `waiting`). */
  playing: boolean;
  /** En pause « c'est à toi » : le bouton central reprend au lieu de démarrer. */
  waiting?: boolean;
  onPrev: () => void;
  onToggle: () => void;
  onNext: () => void;
  /** État de la bascule Répétition. La bascule n'est rendue qu'avec `onRehearsalChange`. */
  rehearsal?: boolean;
  onRehearsalChange?: (on: boolean) => void;
}

export function TransportDock({
  playing,
  waiting,
  onPrev,
  onToggle,
  onNext,
  rehearsal = false,
  onRehearsalChange,
}: TransportDockProps) {
  return (
    <>
      <ToolbarGroup className="transport" label="Transport audio">
        <IconButton icon="skip-back" label="Réplique précédente" size="touch" onClick={onPrev} />
        {/* Unique aplat d'accent de la barre : l'action centrale en répétition. */}
        <IconButton
          icon={playing ? 'pause' : 'play'}
          label={playing ? 'Pause' : waiting ? 'Reprendre' : 'Lecture'}
          size="hero"
          variant="primary"
          className="transport-play"
          onClick={onToggle}
        />
        <IconButton icon="skip-forward" label="Réplique suivante" size="touch" onClick={onNext} />
      </ToolbarGroup>

      {onRehearsalChange && (
        <ToolbarGroup className="transport-mode" label="Mode de lecture">
          <Button
            size="touch"
            aria-pressed={rehearsal}
            aria-label="Mode répétition"
            title="Mode répétition"
            onClick={() => onRehearsalChange(!rehearsal)}
          >
            Répét.
          </Button>
        </ToolbarGroup>
      )}
    </>
  );
}
