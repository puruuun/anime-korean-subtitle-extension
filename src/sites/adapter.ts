import { MiruroAdapter } from './miruro/MiruroAdapter';
import { ReAnimeAdapter } from './reanime/ReAnimeAdapter';
export function adapterFor(url: string) {
  return [new MiruroAdapter(), new ReAnimeAdapter()].find((a) => a.matches(url));
}
