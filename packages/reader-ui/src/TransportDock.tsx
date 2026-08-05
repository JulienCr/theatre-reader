/**
 * Dock de transport audio du lecteur : ⏮ ▶/⏸ ⏭, la vitesse et la bascule « Répétition ».
 *
 * Purement présentationnel — il ne connaît ni le `Player` ni son état interne,
 * tout passe par des props. C'est ce qui permet aux deux lecteurs de le composer
 * différemment : le lecteur mobile le place entre le menu et le bord droit d'une
 * barre fixe, le lecteur web l'insère dans sa propre barre du bas.
 *
 * Il rend deux groupes de barre d'outils frères plutôt qu'un seul bloc : la
 * grappe de transport doit pouvoir être centrée dans la barre pendant que les
 * modificateurs sont poussés au bord. Un conteneur unique interdirait ce placement.
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
  /** Vitesse courante. Le bouton n'est rendu qu'avec `onRateCycle`. */
  rate?: number;
  /** Passe à la vitesse suivante du cycle — l'hôte possède la liste et l'ordre. */
  onRateCycle?: () => void;
}

/**
 * `1,5×` et non `1.5x` : virgule décimale française, et le vrai signe multiplié.
 * Formaté à la main plutôt que par `toLocaleString` — trois valeurs connues ne
 * justifient pas de dépendre de l'ICU de la WebView.
 */
const rateLabel = (rate: number): string => `${String(rate).replace('.', ',')}×`;

export function TransportDock({
  playing,
  waiting,
  onPrev,
  onToggle,
  onNext,
  rehearsal = false,
  onRehearsalChange,
  rate = 1,
  onRateCycle,
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

      {(onRateCycle || onRehearsalChange) && (
        <ToolbarGroup className="transport-mode" label="Mode de lecture">
          {onRateCycle && (
            <Button
              size="touch"
              className="btn--rate"
              aria-label={`Vitesse de lecture : ${rateLabel(rate)}`}
              title="Vitesse de lecture"
              onClick={onRateCycle}
            >
              {rateLabel(rate)}
            </Button>
          )}
          {/* Un micro plutôt que « Répét. » : le libellé coûtait 24 px de plus que la
              cible carrée, et à sept contrôles la barre déborde sur un écran de 375 px.
              L'aplat d'accent (aria-pressed) porte l'état, comme partout ailleurs. */}
          {onRehearsalChange && (
            <IconButton
              icon="mic"
              label="Mode répétition"
              size="touch"
              pressed={rehearsal}
              onClick={() => onRehearsalChange(!rehearsal)}
            />
          )}
        </ToolbarGroup>
      )}
    </>
  );
}
