/**
 * Contrôle segmenté (Radix ToggleGroup) — une seule valeur active.
 *
 * Radix apporte ce qu'on ne veut pas réécrire : le focus roving (une seule
 * tabulation pour le groupe, flèches pour changer de segment) et `aria-checked`.
 * Le rendu reste celui des jetons : l'accent marque le segment « en scène ».
 */
import * as ToggleGroup from '@radix-ui/react-toggle-group';

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      className={['seg', className].filter(Boolean).join(' ')}
      value={value}
      aria-label={label}
      // Un groupe à valeur unique renvoie '' quand on reclique le segment actif :
      // on l'ignore, il n'existe pas d'état « aucun mode ».
      onValueChange={(v) => {
        if (v) onChange(v as T);
      }}
    >
      {options.map((o) => (
        <ToggleGroup.Item key={o.value} value={o.value} className="seg-btn">
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
