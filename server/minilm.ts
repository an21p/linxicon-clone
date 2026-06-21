import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { LiveEmbed } from './embeddings';

env.allowLocalModels = false; // fetch from the HF hub / CDN, server-side, once

// Cap the live-inference memo so adversarial distinct words on a public tunnel
// can't grow it unbounded (~1.5 KB/entry). Crude full-clear on overflow is fine —
// misses simply recompute.
const MEMO_CAP = 10_000;

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
    if (memo.size >= MEMO_CAP) memo.clear();
    memo.set(word, v);
    return v;
  };
}
