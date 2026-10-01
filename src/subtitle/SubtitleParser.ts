import type { SubtitleCue } from './SubtitleCue';
import { AppError } from '../utils/errors';
export function plainText(text: string) {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(
      /&(?:amp|lt|gt|quot|apos|nbsp);/g,
      (m) =>
        ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[
          m
        ] ?? m,
    )
    .replace(/&#(x[\da-f]+|\d+);/gi, (_m, n: string) => {
      const v = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
      return v > 0 && v <= 0x10ffff ? String.fromCodePoint(v) : '';
    })
    .trim();
}
export function timestamp(value: string): number {
  const p = value.trim().replace(',', '.').split(':');
  if (p.length < 2 || p.length > 3) throw new AppError('FORMAT', '자막 포맷을 읽을 수 없습니다.');
  const n = p.map(Number);
  if (n.some((x) => !Number.isFinite(x) || x < 0) || n.at(-1)! >= 60 || n.at(-2)! >= 60)
    throw new AppError('FORMAT', '자막 시간 코드가 잘못되었습니다.');
  return n.reduce((sum, v) => sum * 60 + v, 0);
}
function valid(c: SubtitleCue) {
  return (
    Number.isFinite(c.startTime) &&
    Number.isFinite(c.endTime) &&
    c.startTime >= 0 &&
    c.endTime > c.startTime &&
    !!c.text.trim()
  );
}
export function parseSubtitle(raw: string, format?: string): SubtitleCue[] {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const cues: SubtitleCue[] = [];
  if (format === 'smi' || /<sami(?:\s|>)/i.test(text) || /<sync\s[^>]*start\s*=/i.test(text)) {
    const clean = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    const syncs = [...clean.matchAll(/<sync\b[^>]*\bstart\s*=\s*["']?(\d+)["']?[^>]*>/gi)];
    for (let i = 0; i < syncs.length; i++) {
      const current = syncs[i];
      const next = syncs[i + 1];
      const startTime = Number(current[1]) / 1000;
      const endTime = next ? Number(next[1]) / 1000 : startTime + 4;
      const block = clean.slice(current.index! + current[0].length, next?.index ?? clean.length);
      const paragraphs = [...block.matchAll(/<p\b([^>]*)>([\s\S]*?)(?=<p\b|$)/gi)];
      const chosen =
        paragraphs.find((p) => /\bclass\s*=\s*["']?(?:kr|ko)/i.test(p[1])) ?? paragraphs[0];
      const body = (chosen?.[2] ?? block).replace(/<br\s*\/?\s*>/gi, '\n');
      const cue = { id: cues.length + 1, startTime, endTime, text: plainText(body) };
      if (valid(cue)) cues.push(cue);
    }
  } else if (
    format === 'ass' ||
    format === 'ssa' ||
    /^\[Script Info\]/m.test(text) ||
    /^\[Events\]/m.test(text)
  ) {
    let inEvents = false,
      fields = [
        'layer',
        'start',
        'end',
        'style',
        'name',
        'marginl',
        'marginr',
        'marginv',
        'effect',
        'text',
      ];
    for (const line of text.split('\n')) {
      if (/^\[/.test(line)) {
        inEvents = /^\[Events\]/i.test(line);
        continue;
      }
      if (!inEvents) continue;
      if (/^Format:/i.test(line)) {
        fields = line
          .slice(line.indexOf(':') + 1)
          .split(',')
          .map((x) => x.trim().toLowerCase());
        continue;
      }
      if (!/^Dialogue:/i.test(line)) continue;
      const cells = line
        .slice(line.indexOf(':') + 1)
        .trimStart()
        .split(',');
      const ti = fields.indexOf('text');
      if (ti < 0 || fields.indexOf('start') < 0 || fields.indexOf('end') < 0) continue;
      const txt = plainText(
        cells
          .slice(ti)
          .join(',')
          .replace(/\{[^}]*\}/g, '')
          .replace(/\\[Nn]/g, '\n')
          .replace(/\\h/g, ' '),
      );
      const cue = {
        id: cues.length + 1,
        startTime: timestamp(cells[fields.indexOf('start')] ?? ''),
        endTime: timestamp(cells[fields.indexOf('end')] ?? ''),
        text: txt,
      };
      if (valid(cue)) cues.push(cue);
    }
  } else {
    for (const block of text.split(/\n[ \t]*\n/)) {
      const lines = block.trim().split('\n');
      if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0] ?? '')) continue;
      const index = lines.findIndex((l) => l.includes('-->'));
      if (index < 0) continue;
      const match = lines[index].match(/^(\S+)\s+-->\s+(\S+)/);
      if (!match) continue;
      const cue = {
        id: cues.length + 1,
        startTime: timestamp(match[1]),
        endTime: timestamp(match[2]),
        text: plainText(lines.slice(index + 1).join('\n')),
      };
      if (valid(cue)) cues.push(cue);
    }
  }
  if (!cues.length)
    throw new AppError(
      'FORMAT',
      '자막 포맷을 읽을 수 없습니다. SMI / SRT / VTT / ASS 파일인지 확인하세요.',
    );
  if (cues.length > 30000) throw new AppError('SIZE', '자막 Cue 개수가 너무 많습니다.');
  return cues.sort((a, b) => a.startTime - b.startTime || a.id - b.id);
}
