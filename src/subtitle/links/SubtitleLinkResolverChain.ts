import type { SubtitleSearchResult } from '../../providers/SubtitleProvider';
import type { SubtitleLinkResolver, SubtitleLinkResolution } from './SubtitleLinkResolver';
import { DirectFileResolver } from './DirectFileResolver';
import { GenericHtmlResolver } from './GenericHtmlResolver';
import {
  createResourceLoader,
  SubtitleHostPermission,
  type SubtitleResource,
} from './resourceLoader';
import { AppError } from '../../utils/errors';
import { normalizeEpisode, filenameEpisode } from '../../anime/episodeNormalizer';

export class SubtitleLinkResolverChain {
  constructor(
    private resolvers: SubtitleLinkResolver[] = [
      new DirectFileResolver(),
      new GenericHtmlResolver(),
    ],
    private load: (
      url: string,
      signal?: AbortSignal,
    ) => Promise<SubtitleResource> = createResourceLoader(),
  ) {}
  async resolve(
    candidate: SubtitleSearchResult,
    signal?: AbortSignal,
  ): Promise<SubtitleLinkResolution> {
    const pageUrl = candidate.pageUrl ?? candidate.downloadUrl;
    if (!pageUrl) throw new AppError('URL', '자막 배포 페이지 주소가 없습니다.');
    try {
      signal?.throwIfAborted();
      const resource = await this.load(pageUrl, signal);
      const context = { candidate, signal, load: this.load };
      for (const resolver of this.resolvers) {
        signal?.throwIfAborted();
        const result = await resolver.resolve(resource, context);
        signal?.throwIfAborted();
        if (result?.kind === 'file') {
          const parsed = filenameEpisode(result.name);
          if (
            parsed &&
            (parsed.episode !== normalizeEpisode(candidate.episode) ||
              parsed.special !== candidate.episodeType ||
              (parsed.season !== undefined && parsed.season !== (candidate.season ?? 1)))
          )
            return {
              kind: 'page',
              pageUrl,
              message: '파일 이름의 회차가 다릅니다. 배포 페이지에서 확인하세요.',
            };
        }
        if (result) return result;
      }
      return {
        kind: 'page',
        pageUrl,
        message: '직접 자막 파일을 찾지 못했습니다. 배포 페이지에서 확인하세요.',
      };
    } catch (e) {
      signal?.throwIfAborted();
      if (e instanceof SubtitleHostPermission)
        return {
          kind: 'page',
          pageUrl,
          message: e.message,
          requiredOrigins: [e.origin],
        };
      return {
        kind: 'page',
        pageUrl,
        message: e instanceof AppError ? e.message : '배포 페이지에서 자막을 확인하세요.',
      };
    }
  }
}
