<script lang="ts">
  import Graph from './components/Graph.svelte';
  import Hud from './components/Hud.svelte';
  import WinModal from './components/WinModal.svelte';
  import { createGame } from './lib/game';
  import { createEmbeddings } from './lib/embeddings';
  import { validateWord } from './lib/dictionary';
  import { generatePuzzle } from './lib/puzzles';

  const emb = createEmbeddings();
  const game = createGame({
    embedder: emb.embedder,
    validateWord,
    generatePuzzle: () => generatePuzzle(emb.embedder),
  });
  const { state, stats } = game;

  let progress = 0;
  let ready = false;
  let error: string | null = null;

  emb.onProgress((p) => (progress = p));
  emb.onReady(async () => { ready = true; await game.newGame(); });

  async function onSubmit(e: CustomEvent<string>) {
    error = null;
    const res = await game.submitWord(e.detail);
    if (!res.ok) {
      error = res.reason === 'duplicate' ? 'already on the board'
        : res.reason === 'unknown' ? 'not a recognized word'
        : 'enter a single word';
    }
  }

  function onNewGame() { game.skip(); error = null; game.newGame(); }
</script>

<main>
  {#if !ready}
    <div class="loading">
      <h1>Linxicon</h1>
      <p>Loading word model… {Math.round(progress)}%</p>
    </div>
  {:else}
    <Hud
      targetA={$state.targetA} targetB={$state.targetB}
      wordCount={$state.wordCount} gap={$state.gap}
      best={$stats.best} {error}
      on:submit={onSubmit} on:newgame={onNewGame} />
    <div class="canvas">
      <Graph
        nodes={$state.nodes} edges={$state.edges}
        targetA={$state.targetA} targetB={$state.targetB}
        lastWord={$state.lastWord} />
    </div>
    {#if $state.solved}
      <WinModal wordCount={$state.wordCount} best={$stats.best} on:again={onNewGame} />
    {/if}
  {/if}
</main>

<style>
  :global(body) { margin: 0; background: #0b0e1f; }
  main { display: flex; flex-direction: column; height: 100vh; }
  .canvas { flex: 1; padding: 12px; }
  .loading { display: grid; place-items: center; height: 100vh; color: #eaeefb; font-family: system-ui, sans-serif; text-align: center; }
  h1 { color: #e8c547; }
</style>
