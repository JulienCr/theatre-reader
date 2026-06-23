/** Client HTTP du serveur local (proxifié via Vite en dev). */

import type { Character, Note, Template } from '@theatre/core';

export interface PlaySummary {
  slug: string;
  name: string;
}

export interface PlayMeta {
  name: string;
  characters: Character[];
  template: Template;
}

export interface ImportResponse {
  slug: string;
  fountain: string;
  meta: PlayMeta;
  usedLlm: boolean;
  characterCount: number;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export async function listPlays(): Promise<PlaySummary[]> {
  const { plays } = await json<{ plays: PlaySummary[] }>(await fetch('/api/plays'));
  return plays;
}

export async function importPdf(file: File): Promise<ImportResponse> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/import', { method: 'POST', body: form });
  return json<ImportResponse>(res);
}

export async function loadPlay(slug: string): Promise<{ fountain: string; meta: PlayMeta }> {
  return json(await fetch(`/api/plays/${encodeURIComponent(slug)}`));
}

export async function savePlay(slug: string, fountain: string, meta: PlayMeta): Promise<void> {
  const res = await fetch(`/api/plays/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fountain, meta }),
  });
  if (!res.ok) throw new Error(`Échec de la sauvegarde (${res.status})`);
}

export async function exportPdf(
  fountain: string,
  characters: Character[],
  template: Template,
): Promise<Blob> {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fountain, characters, template }),
  });
  if (!res.ok) throw new Error(`Échec de l'export (${res.status})`);
  return res.blob();
}

export async function exportReader(
  fountain: string,
  characters: Character[],
  template: Template,
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch('/api/export/reader', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fountain, characters, template }),
  });
  if (!res.ok) throw new Error(`Échec de l'export lecteur (${res.status})`);
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? 'lecteur-mobile.html';
  return { blob: await res.blob(), filename };
}

export async function loadNotes(slug: string): Promise<Note[]> {
  const { notes } = await json<{ notes: Note[] }>(
    await fetch(`/api/plays/${encodeURIComponent(slug)}/notes`),
  );
  return notes;
}

export async function saveNotes(slug: string, notes: Note[]): Promise<void> {
  const res = await fetch(`/api/plays/${encodeURIComponent(slug)}/notes`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ notes }),
  });
  if (!res.ok) throw new Error(`Échec de la sauvegarde des notes (${res.status})`);
}
