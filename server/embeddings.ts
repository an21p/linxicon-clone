import type { VectorTable } from './vectorTable';
import type { ModelId } from '../src/lib/models';

export type LiveEmbed = (word: string) => Promise<Float32Array>;

export interface ServiceDeps {
  numberbatch: VectorTable;
  minilm: VectorTable;
  minilmLive: LiveEmbed; // fallback for words not in the MiniLM table
}

export interface EmbeddingsService {
  dim(model: ModelId): number;
  embed(model: ModelId, words: string[]): Promise<(number[] | null)[]>;
}

export function createService(deps: ServiceDeps): EmbeddingsService {
  const tableFor = (model: ModelId): VectorTable =>
    model === 'numberbatch' ? deps.numberbatch : deps.minilm;

  return {
    dim(model) {
      return tableFor(model).dim;
    },
    async embed(model, words) {
      const t = tableFor(model);
      const out: (number[] | null)[] = [];
      for (const raw of words) {
        const word = raw.trim().toLowerCase();
        const hit = t.lookup(word);
        if (hit) {
          out.push(Array.from(hit));
        } else if (model === 'minilm') {
          out.push(Array.from(await deps.minilmLive(word)));
        } else {
          out.push(null);
        }
      }
      return out;
    },
  };
}
