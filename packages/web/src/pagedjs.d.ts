declare module 'pagedjs' {
  /** API programmatique minimale utilisée par le mode lecteur. */
  export class Previewer {
    constructor();
    preview(
      content: string | Element,
      stylesheets?: (string | object)[],
      renderTo?: Element,
    ): Promise<{ total: number; pages: unknown[] }>;
  }
}
