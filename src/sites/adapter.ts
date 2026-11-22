import type { SiteAdapter } from './types';
import { MiruroAdapter } from './miruro/MiruroAdapter';
import { ReAnimeAdapter } from './reanime/ReAnimeAdapter';
import { GenericVideoAdapter } from './generic/GenericVideoAdapter';

const specializedAdapters = [new MiruroAdapter(), new ReAnimeAdapter()];

function matchSpecialized(url?: string): SiteAdapter | undefined {
  if (!url) return undefined;
  return specializedAdapters.find((a) => {
    try {
      return a.matches(url);
    } catch {
      return false;
    }
  });
}

export function isSpecializedSite(url?: string): boolean {
  return Boolean(matchSpecialized(url));
}

export function isWebVideoUrl(url?: string): boolean {
  try {
    const u = new URL(url ?? '');
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function adapterFor(url: string, allowGeneric = false): SiteAdapter | undefined {
  const specialized = matchSpecialized(url);
  if (specialized) return specialized;
  if (allowGeneric && isWebVideoUrl(url)) {
    const generic = new GenericVideoAdapter();
    if (generic.matches(url)) return generic;
  }
  return undefined;
}
