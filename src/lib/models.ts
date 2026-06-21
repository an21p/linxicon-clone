export type ModelId = 'minilm' | 'numberbatch';

export interface ModelInfo {
  id: ModelId;
  label: string;
  dim: number;
}

export const NUMBERBATCH_DIM = 300;
export const MINILM_DIM = 384;

export const MODELS: Record<ModelId, ModelInfo> = {
  minilm: { id: 'minilm', label: 'all-MiniLM-L6-v2', dim: MINILM_DIM },
  numberbatch: { id: 'numberbatch', label: 'ConceptNet Numberbatch', dim: NUMBERBATCH_DIM },
};

export const MODEL_LIST: ModelInfo[] = Object.values(MODELS);

export const DEFAULT_MODEL: ModelId = 'numberbatch';

export function isModelId(v: unknown): v is ModelId {
  return v === 'minilm' || v === 'numberbatch';
}
