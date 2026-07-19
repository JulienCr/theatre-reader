/**
 * Menus déroulants — Radix DropdownMenu habillé aux jetons de @theatre/ui.
 *
 * Vit côté web et non dans @theatre/ui : ce paquet est aussi bundlé sous
 * `preact/compat` pour le lecteur mobile et doit rester sans dépendance externe.
 *
 * Le contenu coupe la propagation des touches (`stopPropagation`) pour la même
 * raison que la palette de commandes : les raccourcis du lecteur sont posés sur
 * `window`, et sans cela Échap fermerait le lecteur en plus du menu, `n`
 * sauterait au résultat suivant pendant qu'on navigue au clavier dans le menu.
 * C'est sans danger pour Radix, qui écoute Échap en phase de **capture** sur le
 * document : sa propre fermeture s'est déjà produite quand l'événement remonte.
 */
import * as DM from '@radix-ui/react-dropdown-menu';
import type { ReactElement, ReactNode } from 'react';

export function Menu({
  trigger,
  align = 'start',
  children,
}: {
  trigger: ReactElement;
  align?: 'start' | 'center' | 'end';
  children: ReactNode;
}) {
  return (
    <DM.Root>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content
          className="menu"
          align={align}
          sideOffset={6}
          collisionPadding={10}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {children}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

/** Libellé d'un item, avec sa ligne d'aide optionnelle en dessous. */
function ItemText({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <span className="menu-text">
      <span>{children}</span>
      {hint && <span className="menu-hint">{hint}</span>}
    </span>
  );
}

export function MenuItem({
  children,
  hint,
  onSelect,
  disabled,
}: {
  children: ReactNode;
  hint?: string;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <DM.Item className="menu-item" disabled={disabled} onSelect={onSelect}>
      <span className="menu-tick" />
      <ItemText hint={hint}>{children}</ItemText>
    </DM.Item>
  );
}

/**
 * Option à cocher. `onSelect` est neutralisé : cocher une option ne doit pas
 * refermer le menu, sinon on ne peut pas régler puis lancer dans la foulée.
 */
export function MenuCheckItem({
  children,
  hint,
  checked,
  onCheckedChange,
}: {
  children: ReactNode;
  hint?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <DM.CheckboxItem
      className="menu-item"
      checked={checked}
      onCheckedChange={onCheckedChange}
      onSelect={(e) => e.preventDefault()}
    >
      <span className="menu-tick">
        <DM.ItemIndicator>✓</DM.ItemIndicator>
      </span>
      <ItemText hint={hint}>{children}</ItemText>
    </DM.CheckboxItem>
  );
}

export function MenuRadioGroup({
  value,
  onValueChange,
  children,
}: {
  value: string;
  onValueChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <DM.RadioGroup value={value} onValueChange={onValueChange}>
      {children}
    </DM.RadioGroup>
  );
}

export function MenuRadioItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <DM.RadioItem className="menu-item" value={value}>
      <span className="menu-tick">
        <DM.ItemIndicator>✓</DM.ItemIndicator>
      </span>
      <ItemText>{children}</ItemText>
    </DM.RadioItem>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DM.Label className="menu-label">{children}</DM.Label>;
}

export function MenuSeparator() {
  return <DM.Separator className="menu-sep" />;
}
