/**
 * The workbench normally owns the document. The userscript mounts it inside a
 * shadow root, so global queries must look there first and fall back to the
 * document for the standalone app.
 */
const HOST_ID = 'intentflow-userscript-root';

export function appRoot(): ParentNode {
  const host = document.getElementById(HOST_ID);
  return host?.shadowRoot ?? document;
}

export function appQuery<T extends Element>(selector: string): T | null {
  return appRoot().querySelector<T>(selector);
}

export function appActiveElement(): Element | null {
  const host = document.getElementById(HOST_ID);
  return host?.shadowRoot?.activeElement ?? document.activeElement;
}
