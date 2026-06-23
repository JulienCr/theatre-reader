import { useEffect, useRef, useState } from 'react';
import type { Character, Template } from '@theatre/core';
import * as api from './api';
import { Preview } from './components/Preview';
import { CharactersPanel } from './components/CharactersPanel';
import { TemplatePanel } from './components/TemplatePanel';

interface PlayState {
  slug: string;
  name: string;
  fountain: string;
  characters: Character[];
  template: Template;
}

export function App() {
  const [summaries, setSummaries] = useState<api.PlaySummary[]>([]);
  const [play, setPlay] = useState<PlayState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.listPlays().then(setSummaries).catch(() => setMessage('Serveur injoignable.'));
  }, []);

  // Aperçu débattu : on évite de re-parser à chaque frappe.
  const [previewFountain, setPreviewFountain] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setPreviewFountain(play?.fountain ?? ''), 200);
    return () => clearTimeout(id);
  }, [play?.fountain]);

  const flash = (m: string) => {
    setMessage(m);
    setTimeout(() => setMessage((cur) => (cur === m ? null : cur)), 4000);
  };

  const onImport = async (file: File) => {
    setBusy('Import en cours…');
    try {
      const r = await api.importPdf(file);
      setPlay({
        slug: r.slug,
        name: r.meta.name,
        fountain: r.fountain,
        characters: r.meta.characters,
        template: r.meta.template,
      });
      setSummaries(await api.listPlays());
      flash(
        `Importé : ${r.characterCount} personnages · normalisation ${r.usedLlm ? 'LLM' : 'heuristique'}.`,
      );
    } catch (e) {
      flash(`Échec de l'import : ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const onSelect = async (slug: string) => {
    if (!slug) return;
    setBusy('Chargement…');
    try {
      const { fountain, meta } = await api.loadPlay(slug);
      setPlay({ slug, name: meta.name, fountain, characters: meta.characters, template: meta.template });
    } catch (e) {
      flash(`Échec du chargement : ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const onSave = async () => {
    if (!play) return;
    setBusy('Sauvegarde…');
    try {
      await api.savePlay(play.slug, play.fountain, {
        name: play.name,
        characters: play.characters,
        template: play.template,
      });
      flash('Sauvegardé.');
    } catch (e) {
      flash(String(e));
    } finally {
      setBusy(null);
    }
  };

  const onExport = async () => {
    if (!play) return;
    setBusy('Export PDF…');
    try {
      const blob = await api.exportPdf(play.fountain, play.characters, play.template);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      flash(String(e));
    } finally {
      setBusy(null);
    }
  };

  const setTemplate = (template: Template) => setPlay((p) => (p ? { ...p, template } : p));
  const setCharacters = (characters: Character[]) =>
    setPlay((p) => (p ? { ...p, characters } : p));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Theatre&nbsp;Reader</div>
        <select
          className="play-select"
          value={play?.slug ?? ''}
          onChange={(e) => onSelect(e.target.value)}
        >
          <option value="">— ouvrir une pièce —</option>
          {summaries.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport(f);
            e.target.value = '';
          }}
        />
        <button onClick={() => fileInput.current?.click()}>Importer un PDF</button>
        <div className="spacer" />
        {play && (
          <>
            <label className="toggle">
              <input
                type="checkbox"
                checked={showEditor}
                onChange={(e) => setShowEditor(e.target.checked)}
              />
              Éditeur
            </label>
            <button onClick={onSave}>Sauvegarder</button>
            <button className="primary" onClick={onExport}>
              Exporter en PDF
            </button>
          </>
        )}
        {busy && <span className="busy">{busy}</span>}
        {message && <span className="message">{message}</span>}
      </header>

      {!play ? (
        <div className="empty">
          <div>
            <h1>Theatre Reader</h1>
            <p>Importe un texte de théâtre (PDF) pour le mettre en page et l'exporter.</p>
            <button className="primary" onClick={() => fileInput.current?.click()}>
              Importer un PDF
            </button>
          </div>
        </div>
      ) : (
        <main className="workspace">
          <aside className="sidebar">
            <CharactersPanel
              characters={play.characters}
              template={play.template}
              onChange={setTemplate}
              onCharactersChange={setCharacters}
            />
            <TemplatePanel template={play.template} onChange={setTemplate} />
          </aside>

          {showEditor && (
            <section className="editor-pane">
              <div className="pane-title">Source (Fountain)</div>
              <textarea
                className="editor"
                value={play.fountain}
                spellCheck={false}
                onChange={(e) => setPlay((p) => (p ? { ...p, fountain: e.target.value } : p))}
              />
            </section>
          )}

          <section className="preview-pane">
            <div className="pane-title">Aperçu</div>
            <Preview
              fountain={previewFountain}
              characters={play.characters}
              template={play.template}
            />
          </section>
        </main>
      )}
    </div>
  );
}
