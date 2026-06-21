<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  export let wordCount = 0;
  export let best: number | null = null;
  const dispatch = createEventDispatcher<{ again: void; trace: void }>();
  $: isBest = best == null || wordCount <= best;
</script>

<div class="backdrop" on:click|self={() => dispatch('again')} role="presentation">
  <div class="modal" role="dialog" aria-modal="true" aria-label="constellation complete">
    <div class="crest">
      <svg viewBox="0 0 120 60" class="constellation" aria-hidden="true">
        <line x1="10" y1="44" x2="38" y2="20" />
        <line x1="38" y1="20" x2="64" y2="38" />
        <line x1="64" y1="38" x2="86" y2="14" />
        <line x1="86" y1="14" x2="110" y2="30" />
        {#each [[10,44],[38,20],[64,38],[86,14],[110,30]] as [cx, cy], i}
          <circle {cx} {cy} r={i === 0 || i === 4 ? 4 : 2.4} style={`--d:${i * 0.12}s`} />
        {/each}
      </svg>
    </div>

    <span class="eyebrow">constellation complete</span>
    <h2>The stars align.</h2>
    <p class="lede">
      You bridged the void with <b>{wordCount}</b> star{wordCount === 1 ? '' : 's'}.
    </p>

    <div class="score">
      <span class="badge" class:best={isBest}>{isBest ? '★ new best' : `best · ${best}`}</span>
    </div>

    <div class="actions">
      <button class="ghost" on:click={() => dispatch('trace')}>trace the bridge</button>
      <button on:click={() => dispatch('again')}>chart another →</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: radial-gradient(120% 120% at 50% 30%, rgba(8, 10, 20, 0.7), rgba(4, 5, 12, 0.92));
    backdrop-filter: blur(6px);
    display: grid;
    place-items: center;
    animation: veil 0.5s ease;
    padding: 20px;
  }
  .modal {
    position: relative;
    max-width: 380px;
    width: 100%;
    padding: 36px 40px 32px;
    text-align: center;
    background: linear-gradient(180deg, rgba(20, 25, 50, 0.85), rgba(10, 13, 28, 0.9));
    border: 1px solid rgba(240, 198, 116, 0.28);
    border-radius: 18px;
    box-shadow:
      0 0 80px -20px rgba(240, 198, 116, 0.4),
      0 40px 80px -30px rgba(0, 0, 0, 0.9);
    animation: rise 0.6s cubic-bezier(0.2, 0.9, 0.2, 1);
  }

  .crest { display: grid; place-items: center; margin-bottom: 6px; }
  .constellation { width: 150px; height: 75px; overflow: visible; }
  .constellation line {
    stroke: var(--cyan);
    stroke-width: 1;
    stroke-opacity: 0.5;
    stroke-dasharray: 160;
    stroke-dashoffset: 160;
    animation: draw 1.1s ease forwards 0.2s;
  }
  .constellation circle {
    fill: var(--gold-bright);
    filter: drop-shadow(0 0 5px rgba(240, 198, 116, 0.9));
    opacity: 0;
    animation: spark 0.5s ease forwards var(--d, 0s);
  }

  .eyebrow {
    font-family: var(--mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.34em;
    color: var(--gold);
  }
  h2 {
    font-family: var(--display);
    font-weight: 400;
    font-size: 34px;
    color: var(--star);
    margin: 8px 0 10px;
    letter-spacing: 0.01em;
  }
  .lede { color: var(--star-dim); font-size: 14px; margin: 0; line-height: 1.5; }
  .lede b { color: var(--gold-bright); font-weight: 400; font-size: 18px; }

  .score { margin: 20px 0 24px; }
  .badge {
    display: inline-block;
    font-family: var(--mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    padding: 7px 14px;
    border-radius: 999px;
    color: var(--star-dim);
    border: 1px solid var(--panel-line);
  }
  .badge.best {
    color: #2a1c06;
    background: linear-gradient(180deg, var(--gold-bright), var(--gold));
    border-color: transparent;
    box-shadow: 0 0 24px -4px rgba(240, 198, 116, 0.7);
  }

  .actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
  button {
    font-family: var(--mono);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 13px;
    padding: 13px 26px;
    border: 1px solid rgba(240, 198, 116, 0.4);
    border-radius: 10px;
    background: transparent;
    color: var(--gold-bright);
    cursor: pointer;
    transition: all 0.22s ease;
  }
  button:hover {
    background: rgba(240, 198, 116, 0.12);
    box-shadow: 0 0 30px -8px rgba(240, 198, 116, 0.6);
  }
  button.ghost {
    border-color: var(--panel-line);
    color: var(--star-dim);
  }
  button.ghost:hover {
    color: var(--star);
    background: rgba(150, 168, 224, 0.08);
    box-shadow: none;
  }

  @keyframes veil { from { opacity: 0; } to { opacity: 1; } }
  @keyframes rise { from { opacity: 0; transform: translateY(24px) scale(0.96); } to { opacity: 1; transform: none; } }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  @keyframes spark { from { opacity: 0; transform: scale(0); } to { opacity: 1; transform: scale(1); } }
</style>
