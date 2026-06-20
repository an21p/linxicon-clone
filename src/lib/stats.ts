export interface Stats {
  played: number;
  won: number;
  best: number | null;   // lowest word count across wins
  streak: number;
}

const KEY = 'linxicon:stats';

export function loadStats(): Stats {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Stats;
  } catch { /* ignore */ }
  return { played: 0, won: 0, best: null, streak: 0 };
}

export function saveStats(stats: Stats): void {
  try { localStorage.setItem(KEY, JSON.stringify(stats)); } catch { /* ignore */ }
}

export function recordWin(stats: Stats, wordCount: number): Stats {
  return {
    played: stats.played + 1,
    won: stats.won + 1,
    best: stats.best === null ? wordCount : Math.min(stats.best, wordCount),
    streak: stats.streak + 1,
  };
}

export function recordSkip(stats: Stats): Stats {
  return { ...stats, played: stats.played + 1, streak: 0 };
}
