import type { SubtitleSearchResult } from '../../providers/SubtitleProvider';
import type { SubtitleResource } from './resourceLoader';
import { AppError } from '../../utils/errors';

export interface ResolvedSubtitleFile {
  kind: 'file';
  url: string;
  name: string;
  buffer: ArrayBuffer;
}
export interface UnresolvedSubtitlePage {
  kind: 'page';
  pageUrl: string;
  message: string;
  requiredOrigins?: string[];
}
export type SubtitleLinkResolution = ResolvedSubtitleFile | UnresolvedSubtitlePage;
export interface ResolverContext {
  candidate: SubtitleSearchResult;
  signal?: AbortSignal;
  load: (url: string, signal?: AbortSignal) => Promise<SubtitleResource>;
}
export interface SubtitleLinkResolver {
  id: string;
  resolve(
    resource: SubtitleResource,
    context: ResolverContext,
  ): Promise<SubtitleLinkResolution | undefined>;
}
export class SubtitleLinkUnavailable extends AppError {
  constructor(public resolution: UnresolvedSubtitlePage) {
    super('SUBTITLE_PAGE', resolution.message);
  }
}
