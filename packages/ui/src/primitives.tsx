/**
 * Primitives d'interface sans aucune dépendance externe.
 *
 * Contrainte forte : ce fichier est bundlé aussi bien par Vite (app web, React
 * 19) que par esbuild avec un alias vers `preact/compat` (lecteur mobile inliné
 * dans un .html hors-ligne). Il ne doit donc utiliser **que** JSX + hooks de
 * base — pas de `use()`, pas d'Actions, pas de portails, aucune lib tierce.
 * Les composants qui ont besoin de Radix (menus, modales, popovers) vivent côté
 * web dans `packages/web/src/components/ui/`.
 *
 * `Toolbar` / `ToolbarGroup` sont la pièce maîtresse : les anciennes barres
 * étaient un unique `flex` avec `flex-wrap`, ce qui laissait les contrôles se
 * réagencer au gré de la largeur et du contenu. Ici, un groupe est une unité
 * indivisible ; c'est lui qui porte l'alignement.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { FILLED_ICONS, ICONS, type IconName } from './icons';

export function Icon({
  name,
  size = 20,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const filled = FILLED_ICONS.has(name);
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

export type ButtonVariant = 'primary' | 'neutral' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /**
   * `touch` porte les cibles à 44 px : à utiliser sur le lecteur mobile.
   * `hero` (56 px, rond) est réservé à l'action centrale d'une barre — au plus
   * une par écran, cf. la règle d'usage de l'accent dans `tokens.ts`.
   */
  size?: 'sm' | 'md' | 'touch' | 'hero';
  icon?: IconName;
  children?: ReactNode;
}

/** Taille de l'icône par taille de bouton — l'icône doit grandir avec la cible. */
const ICON_SIZE: Record<NonNullable<ButtonProps['size']>, number> = {
  sm: 15,
  md: 17,
  touch: 22,
  hero: 26,
};

export function Button({
  variant = 'neutral',
  size = 'md',
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={['btn', `btn--${variant}`, `btn--${size}`, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {icon && <Icon name={icon} size={ICON_SIZE[size]} />}
      {children}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon'> {
  icon: IconName;
  /** Obligatoire : un bouton sans texte doit être nommé pour l'accessibilité. */
  label: string;
  /** État actif (mode répétition, panneau ouvert…) — porte l'accent. */
  pressed?: boolean;
}

export function IconButton({ icon, label, pressed, className, ...rest }: IconButtonProps) {
  return (
    <Button
      {...rest}
      className={['btn--icon', className].filter(Boolean).join(' ')}
      aria-label={label}
      title={rest.title ?? label}
      aria-pressed={pressed}
      icon={icon}
    />
  );
}

export function Toolbar({
  children,
  className,
  'aria-label': ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <div className={['toolbar', className].filter(Boolean).join(' ')} role="toolbar" aria-label={ariaLabel}>
      {children}
    </div>
  );
}

/**
 * Unité indivisible d'une barre. `label` nomme le groupe pour les lecteurs
 * d'écran (« Recherche », « Lecture audio »…) et documente l'intention.
 */
export function ToolbarGroup({
  children,
  label,
  grow,
  className,
}: {
  children: ReactNode;
  label?: string;
  /** Occupe l'espace disponible — un seul groupe par barre devrait le faire. */
  grow?: boolean;
  className?: string;
}) {
  return (
    <div
      className={['toolbar-group', grow ? 'toolbar-group--grow' : null, className]
        .filter(Boolean)
        .join(' ')}
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  );
}

export function ToolbarSpacer() {
  return <div className="toolbar-spacer" />;
}

export function ToolbarSeparator() {
  return <div className="toolbar-sep" role="separator" aria-orientation="vertical" />;
}

/**
 * Panneau glissant depuis le bas (mobile) ou latéral (web étroit).
 *
 * Volontairement sans portail ni focus trap : le lecteur mobile n'a qu'une
 * sheet ouverte à la fois et doit rester minuscule. Côté web, les vraies
 * modales passent par Radix Dialog.
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div
        className={`sheet-backdrop${open ? ' is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`sheet${open ? ' is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-hidden={!open}
      >
        <div className="sheet-head">
          <h2 className="sheet-title">{title}</h2>
          <IconButton icon="x" label="Fermer" variant="ghost" size="touch" onClick={onClose} />
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </>
  );
}
