let enabled = false;
export function setDebug(v: boolean) {
  enabled = v;
}
export function log(scope: string, fields: Record<string, string | number | boolean | undefined>) {
  if (enabled) console.debug('[AnimeSub][' + scope + ']', fields);
} // Never log URLs, headers, keys, bodies or subtitle text.
