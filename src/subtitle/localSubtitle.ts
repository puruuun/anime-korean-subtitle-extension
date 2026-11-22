import type { SubtitleCue } from './SubtitleCue';
import { parseSubtitle } from './SubtitleParser';
import { decodeSubtitle } from '../utils/encoding';
import { AppError } from '../utils/errors';

export const MAX_LOCAL_SUBTITLE_BYTES = 5 * 1024 * 1024;
export const SUPPORTED_LOCAL_EXTENSIONS = ['.srt', '.ass', '.ssa', '.smi', '.sami', '.vtt'] as const;

const EXTENSION_FORMAT: Record<(typeof SUPPORTED_LOCAL_EXTENSIONS)[number], string> = {
  '.srt': 'srt',
  '.ass': 'ass',
  '.ssa': 'ssa',
  '.smi': 'smi',
  '.sami': 'smi',
  '.vtt': 'vtt',
};

const BASE64_CHUNK_SIZE = 0x4000;

export function encodeBytesToBase64(bytes: Uint8Array): string {
  // Process in bounded chunks to avoid call-stack overflow on multi-megabyte buffers.
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_SIZE));
  }
  return btoa(binary);
}

export function decodeBase64ToBytes(base64: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(base64.trim());
  } catch {
    throw new AppError('PARSE', '자막 파일 데이터를 읽을 수 없습니다.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeLocalText(bytes: Uint8Array): string {
  try {
    return decodeSubtitle(bytes, 'ko');
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'ENCODING') throw error;
    return decodeSubtitle(bytes, 'ja');
  }
}

export function parseLocalSubtitleBytes(
  fileName: string,
  bytes: Uint8Array,
): { cues: SubtitleCue[]; format: string } {
  const dot = fileName.lastIndexOf('.');
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
  const format = EXTENSION_FORMAT[ext as (typeof SUPPORTED_LOCAL_EXTENSIONS)[number]];
  if (!format) {
    throw new AppError(
      'FORMAT',
      '지원하는 텍스트 자막 파일(.srt, .ass, .ssa, .smi, .vtt)만 불러올 수 있습니다.',
    );
  }
  if (bytes.byteLength === 0) {
    throw new AppError('PARSE', '자막 파일이 비어 있습니다.');
  }
  if (bytes.byteLength > MAX_LOCAL_SUBTITLE_BYTES) {
    throw new AppError('SIZE', '자막 파일 크기는 최대 5MB까지 지원합니다.');
  }

  const text = decodeLocalText(bytes);
  let cues: SubtitleCue[];
  try {
    cues = parseSubtitle(text, format);
  } catch (error) {
    if (error instanceof AppError && error.code === 'FORMAT') {
      throw new AppError('PARSE', '자막 파일에서 유효한 대사를 찾지 못했습니다.');
    }
    throw error;
  }
  if (cues.length === 0) {
    throw new AppError('PARSE', '자막 파일에서 유효한 대사를 찾지 못했습니다.');
  }
  return { cues, format };
}
