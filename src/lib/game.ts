import { writable, type Readable } from 'svelte/store';
import { GameEngine } from './engine/engine';
import type { WordNode, Edge } from './engine/types';
import type { Embedder } from './embedder';
import type { ValidationResult } from './dictionary';
import type { Puzzle } from './puzzles';
import { loadStats, saveStats, recordWin, recordSkip, type Stats } from './stats';

export interface GameState {
  targetA: string;
  targetB: string;
  nodes: WordNode[];
  edges: Edge[];
  gap: number;
  solved: boolean;
  wordCount: number;
  lastWord: string | null;
}

export interface SubmitResult {
  ok: boolean;
  reason?: 'malformed' | 'unknown' | 'duplicate';
}

export interface GameDeps {
  embedder: Embedder;
  validateWord: (raw: string) => ValidationResult;
  generatePuzzle: () => Promise<Puzzle>;
}

const EMPTY: GameState = {
  targetA: '', targetB: '', nodes: [], edges: [], gap: 0,
  solved: false, wordCount: 0, lastWord: null,
};

export function createGame(deps: GameDeps) {
  const state = writable<GameState>(EMPTY);
  const stats = writable<Stats>(loadStats());
  let engine: GameEngine | null = null;
  let wonThisGame = false;

  function snapshot(lastWord: string | null): GameState {
    const e = engine!;
    return {
      targetA: e.targetA,
      targetB: e.targetB,
      nodes: e.getNodes(),
      edges: e.getEdges(),
      gap: e.closestGap(),
      solved: e.isSolved(),
      wordCount: e.wordCount(),
      lastWord,
    };
  }

  async function newGame(): Promise<void> {
    const p = await deps.generatePuzzle();
    const [va, vb] = await Promise.all([deps.embedder.embed(p.a), deps.embedder.embed(p.b)]);
    engine = new GameEngine({ word: p.a, vector: va }, { word: p.b, vector: vb });
    wonThisGame = false;
    state.set(snapshot(null));
  }

  async function submitWord(raw: string): Promise<SubmitResult> {
    if (!engine) return { ok: false };
    const v = deps.validateWord(raw);
    if (!v.ok) return { ok: false, reason: v.reason };
    if (engine.has(v.word)) return { ok: false, reason: 'duplicate' };

    const vec = await deps.embedder.embed(v.word);
    engine.addWord(v.word, vec);
    state.set(snapshot(v.word));

    if (engine.isSolved() && !wonThisGame) {
      wonThisGame = true;
      stats.update((s) => {
        const next = recordWin(s, engine!.wordCount());
        saveStats(next);
        return next;
      });
    }
    return { ok: true };
  }

  function skip(): void {
    if (!wonThisGame) {
      stats.update((s) => { const next = recordSkip(s); saveStats(next); return next; });
    }
  }

  return {
    state: state as Readable<GameState>,
    stats: stats as Readable<Stats>,
    newGame,
    submitWord,
    skip,
  };
}
