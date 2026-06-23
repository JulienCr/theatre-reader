/** Panneau template : mise en forme (nom, didascalies, en-têtes, page). */
import type { PageStyle, Template } from '@theatre/core';
import { Check, ColorField, NumberField, Row, Select, TextField } from './controls';

export function TemplatePanel({
  template,
  onChange,
}: {
  template: Template;
  onChange: (t: Template) => void;
}) {
  const t = template;
  const setName = (patch: Partial<Template['characterName']>) =>
    onChange({ ...t, characterName: { ...t.characterName, ...patch } });
  const setStage = (patch: Partial<Template['stageDirection']>) =>
    onChange({ ...t, stageDirection: { ...t.stageDirection, ...patch } });
  const setInline = (patch: Partial<Template['inlineStageDirection']>) =>
    onChange({ ...t, inlineStageDirection: { ...t.inlineStageDirection, ...patch } });
  const setScene = (patch: Partial<Template['sceneHeading']>) =>
    onChange({ ...t, sceneHeading: { ...t.sceneHeading, ...patch } });
  const setPage = (patch: Partial<PageStyle>) => onChange({ ...t, page: { ...t.page, ...patch } });

  return (
    <section className="panel">
      <h3>Mise en page</h3>

      <h4>Nom du personnage</h4>
      <Check label="Gras" checked={t.characterName.bold} onChange={(v) => setName({ bold: v })} />
      <Check
        label="Majuscules"
        checked={t.characterName.caps}
        onChange={(v) => setName({ caps: v })}
      />
      <Check
        label="Réplique à la ligne"
        checked={!t.characterName.sameLineAsDialogue}
        onChange={(v) => setName({ sameLineAsDialogue: !v })}
      />
      {t.characterName.sameLineAsDialogue && (
        <Row label="Séparateur">
          <TextField value={t.characterName.suffix} onChange={(v) => setName({ suffix: v })} />
        </Row>
      )}

      <h4>Didascalies (isolées)</h4>
      <Check
        label="Italique"
        checked={t.stageDirection.italic}
        onChange={(v) => setStage({ italic: v })}
      />
      <Check
        label="Indenter"
        checked={t.stageDirection.indent}
        onChange={(v) => setStage({ indent: v })}
      />
      <Check
        label="Masquer"
        checked={t.stageDirection.hidden}
        onChange={(v) => setStage({ hidden: v })}
      />
      <Row label="Couleur">
        <ColorField value={t.stageDirection.color ?? '#6b6b6b'} onChange={(v) => setStage({ color: v })} />
      </Row>

      <h4>Didascalies en incise</h4>
      <Check
        label="Italique"
        checked={t.inlineStageDirection.italic}
        onChange={(v) => setInline({ italic: v })}
      />
      <Check
        label="Masquer"
        checked={t.inlineStageDirection.hidden}
        onChange={(v) => setInline({ hidden: v })}
      />
      <Row label="Couleur">
        <ColorField
          value={t.inlineStageDirection.color ?? '#6b6b6b'}
          onChange={(v) => setInline({ color: v })}
        />
      </Row>

      <h4>Actes &amp; scènes</h4>
      <Check
        label="Afficher la présentation des personnages"
        checked={t.showDistribution !== false}
        onChange={(v) => onChange({ ...t, showDistribution: v })}
      />
      {t.showDistribution !== false && (
        <Check
          label="Saut de page après la distribution"
          checked={t.distributionPageBreak !== false}
          onChange={(v) => onChange({ ...t, distributionPageBreak: v })}
        />
      )}
      <Check
        label="Sommaire (actes/scènes + n° de page)"
        checked={t.showToc !== false}
        onChange={(v) => onChange({ ...t, showToc: v })}
      />
      <Check
        label="Numéroter les pages (page x / y)"
        checked={t.pageNumbers !== false}
        onChange={(v) => onChange({ ...t, pageNumbers: v })}
      />
      <Check
        label="Afficher l'acte avec chaque scène"
        checked={t.sceneHeading.showAct}
        onChange={(v) => setScene({ showAct: v })}
      />

      <h4>Page</h4>
      <Row label="Format">
        <Select<PageStyle['format']>
          value={t.page.format}
          options={[
            { value: 'A4', label: 'A4' },
            { value: 'Letter', label: 'Letter' },
          ]}
          onChange={(v) => setPage({ format: v })}
        />
      </Row>
      <Row label="Police">
        <TextField value={t.page.fontFamily} onChange={(v) => setPage({ fontFamily: v })} />
      </Row>
      <Row label="Taille (pt)">
        <NumberField
          value={t.page.fontSizePt}
          min={6}
          max={32}
          step={0.5}
          onChange={(v) => setPage({ fontSizePt: v })}
        />
      </Row>
      <Row label="Marge (mm)">
        <NumberField
          value={t.page.marginMm}
          min={0}
          max={50}
          onChange={(v) => setPage({ marginMm: v })}
        />
      </Row>
      <Row label="Interligne">
        <NumberField
          value={t.page.lineHeight}
          min={1}
          max={3}
          step={0.05}
          onChange={(v) => setPage({ lineHeight: v })}
        />
      </Row>
    </section>
  );
}
