import type { VectorTable } from './vectorTable';
import type { ModelId } from '../src/lib/models';

export type LiveEmbed = (word: string) => Promise<Float32Array>;

export interface ServiceDeps {
  numberbatch: VectorTable;
  minilm: VectorTable;
  minilmLive: LiveEmbed; // fallback for words not in the MiniLM table
  dictionary: Set<string>; // valid player words — the pool hints are drawn from
}

export interface EmbeddingsService {
  dim(model: ModelId): number;
  embed(model: ModelId, words: string[]): Promise<(number[] | null)[]>;
  /** Best dictionary word bridging anchors `a` and `b`, excluding words already placed. */
  hint(model: ModelId, a: string, b: string, exclude: string[]): Promise<{ word: string; score: number } | null>;
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
    async hint(model, a, b, exclude) {
      const [av, bv] = await this.embed(model, [a, b]);
      if (!av || !bv) return null;
      const table = tableFor(model);
      const skip = new Set(exclude.map((w) => w.trim().toLowerCase()));
      skip.add(a.trim().toLowerCase());
      skip.add(b.trim().toLowerCase());
      return table.bestBridge(Float32Array.from(av), Float32Array.from(bv), deps.dictionary, skip);
    },
  };
}
