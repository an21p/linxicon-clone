export type ModelId = 'minilm' | 'numberbatch';

export interface ModelInfo {
  id: ModelId;
  label: string;
  dim: number;
  /** Cosine similarity at/above which two words are linked (and the win bar). */
  threshold: number;
}

export const NUMBERBATCH_DIM = 300;
export const MINILM_DIM = 384;

// Both models default to the same connect/win threshold. It remains adjustable
// per-model at runtime via the in-app link % slider.
export const MINILM_THRESHOLD = 0.41;
export const NUMBERBATCH_THRESHOLD = 0.41;

export const MODELS: Record<ModelId, ModelInfo> = {
  minilm: { id: 'minilm', label: 'all-MiniLM-L6-v2', dim: MINILM_DIM, threshold: MINILM_THRESHOLD },
  numberbatch: {
    id: 'numberbatch',
    label: 'ConceptNet Numberbatch',
    dim: NUMBERBATCH_DIM,
    threshold: NUMBERBATCH_THRESHOLD,
  },
};

export const MODEL_LIST: ModelInfo[] = Object.values(MODELS);

export const DEFAULT_MODEL: ModelId = 'numberbatch';

export function isModelId(v: unknown): v is ModelId {
  return v === 'minilm' || v === 'numberbatch';
}
