import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { LiveEmbed } from './embeddings';

env.allowLocalModels = false; // fetch from the HF hub / CDN, server-side, once

/** Lazily-loaded, memoized MiniLM live embedder for non-curated words. */
export function createMinilmLive(): LiveEmbed {
  let pipe: Promise<FeatureExtractionPipeline> | null = null;
  const memo = new Map<string, Float32Array>();
  return async (word: string): Promise<Float32Array> => {
    const cached = memo.get(word);
    if (cached) return cached;
    if (!pipe) pipe = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    const ex = await pipe;
    const out = await ex(word, { pooling: 'mean', normalize: true });
    const v = Float32Array.from(out.data as Float32Array);
    memo.set(word, v);
    return v;
  };
}
