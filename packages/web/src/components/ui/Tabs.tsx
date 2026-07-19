/**
 * Onglets (Radix Tabs) — un seul panneau visible à la fois.
 *
 * Radix apporte le focus roving (une tabulation pour la barre d'onglets, flèches
 * pour changer) et le couple `aria-selected` / `aria-controls`. Il démonte aussi
 * le contenu inactif, et c'est ici l'essentiel : c'est ce démontage qui fait
 * qu'un dock n'accumule plus la hauteur de tous ses panneaux.
 */
import type { ReactNode } from 'react';
import * as RTabs from '@radix-ui/react-tabs';

export function Tabs({
  value,
  onValueChange,
  children,
  className,
}: {
  value: string;
  onValueChange: (v: string) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <RTabs.Root
      className={['tabs', className].filter(Boolean).join(' ')}
      value={value}
      // Radix n'émet jamais de valeur vide sur un groupe d'onglets : pas de
      // garde à prévoir, contrairement au segmenté.
      onValueChange={onValueChange}
    >
      {children}
    </RTabs.Root>
  );
}

export function TabsList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <RTabs.List className="tabs-list" aria-label={label}>
      {children}
    </RTabs.List>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RTabs.Trigger className="tabs-trigger" value={value}>
      {children}
    </RTabs.Trigger>
  );
}

export function TabsContent({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RTabs.Content className="tabs-content" value={value}>
      {children}
    </RTabs.Content>
  );
}
