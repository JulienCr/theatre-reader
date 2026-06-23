/** Petits contrôles de formulaire réutilisables pour les panneaux de réglages. */
import type { ReactNode } from 'react';

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="ctrl-row">
      <span className="ctrl-label">{label}</span>
      <span className="ctrl-field">{children}</span>
    </label>
  );
}

export function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="ctrl-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function TextField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />;
}

export function ColorField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="ctrl-color"
    />
  );
}

/** Case à cocher qui, lorsqu'elle est active, expose un sélecteur de couleur. */
export function ToggleColor({
  label,
  value,
  defaultColor,
  onChange,
}: {
  label: string;
  value: string | undefined;
  defaultColor: string;
  onChange: (v: string | undefined) => void;
}) {
  const on = value != null;
  return (
    <div className="ctrl-togglecolor">
      <Check label={label} checked={on} onChange={(c) => onChange(c ? defaultColor : undefined)} />
      {on && <ColorField value={value} onChange={(v) => onChange(v)} />}
    </div>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
