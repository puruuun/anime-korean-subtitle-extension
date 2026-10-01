import { plainText } from '../SubtitleParser';
import { subtitleURL } from './resourceLoader';
export function staticHTML(html: string) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
}
export function attribute(attrs: string, name: string): string | undefined {
  const match = attrs.match(
    new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'=<>]+))', 'i'),
  );
  const value = match?.slice(1).find((v) => v !== undefined);
  return value === undefined ? undefined : plainText(value);
}
export function elementHTML(html: string, className: string): string | undefined {
  const content = staticHTML(html);
  const tags = /<\/?([a-z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  let tag: string | undefined,
    start = 0,
    depth = 0;
  for (const token of content.matchAll(tags)) {
    const closing = token[0].startsWith('</');
    if (!tag && !closing && (attribute(token[2], 'class') ?? '').split(/\s+/).includes(className)) {
      tag = token[1].toLowerCase();
      start = token.index! + token[0].length;
      depth = 1;
    } else if (tag === token[1].toLowerCase()) {
      depth += closing ? -1 : 1;
      if (!depth) return content.slice(start, token.index);
    }
  }
  return undefined;
}
export interface HTMLLink {
  url: string;
  label: string;
  downloadName: string;
}
export function htmlLinks(html: string, base: string): HTMLLink[] {
  const links: HTMLLink[] = [];
  for (const match of staticHTML(html).matchAll(
    /<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a\s*>/gi,
  )) {
    const href = attribute(match[1], 'href');
    if (!href) continue;
    try {
      links.push({
        url: subtitleURL(href, base),
        label: plainText(match[2]).trim(),
        downloadName: attribute(match[1], 'download') ?? '',
      });
    } catch {
      /* Ignore private and non-HTTP links. */
    }
  }
  return links;
}
