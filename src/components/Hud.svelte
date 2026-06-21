<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  export let targetA = '';
  export let targetB = '';
  export let wordCount = 0;
  export let gap = 0;
  export let best: number | null = null;
  export let error: string | null = null;
  export let disabled = false;

  let value = '';
  const dispatch = createEventDispatcher<{ submit: string; newgame: void }>();

  // gap is the widest path's similarity; the puzzle is solved at >= 0.41.
  // surface it as "proximity" so the bar fills toward the join.
  const THRESHOLD = 0.41;
  $: proximity = Math.max(0, Math.min(1, gap / THRESHOLD));
  $: pct = (gap * 100).toFixed(1);

  function submit() {
    const w = value.trim();
    if (!w) return;
    dispatch('submit', w);
    value = '';
  }
</script>

<header class="hud">
  <div class="bar">
    <div class="brand">
      <span class="mark">✷</span>
      <span class="name">Linxicon</span>
    </div>
    <div class="readouts">
      <span class="ro"><b>{wordCount}</b><i>stars placed</i></span>
      <span class="div">·</span>
      <span class="ro"><b>{best ?? '—'}</b><i>best</i></span>
    </div>
  </div>

  <div class="targets">
    <div class="target">
      <span class="eyebrow">from</span>
      <span class="word">{targetA}</span>
    </div>

    <div class="meridian">
      <div class="track">
        <div class="fill" style={`width:${proximity * 100}%`}></div>
      </div>
      <span class="gap" class:close={proximity > 0.66}>
        gap&nbsp;<b>{pct}%</b>&nbsp;/&nbsp;{(THRESHOLD * 100).toFixed(0)}%
      </span>
    </div>

    <div class="target right">
      <span class="eyebrow">to</span>
      <span class="word">{targetB}</span>
    </div>
  </div>

  <form on:submit|preventDefault={submit}>
    <div class="field" class:err={!!error}>
      <span class="prompt">✶</span>
      <input
        bind:value
        placeholder="inscribe a word to chart…"
        {disabled}
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        aria-label="add a word" />
      <button type="submit" class="add" {disabled} aria-label="place word">place</button>
    </div>
    <button type="button" class="ghost" on:click={() => dispatch('newgame')}>new chart</button>
  </form>

  <p class="status" aria-live="polite">
    {#if error}<span class="error">⚠ {error}</span>{/if}
  </p>
</header>

<style>
  .hud {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px 20px 6px;
    color: var(--parchment);
  }

  .bar {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    border-bottom: 1px solid var(--panel-line);
    padding-bottom: 12px;
  }
  .brand { display: flex; align-items: baseline; gap: 10px; }
  .mark { color: var(--gold); font-size: 14px; transform: translateY(-1px); }
  .name {
    font-family: var(--display);
    font-weight: 500;
    font-size: 26px;
    letter-spacing: 0.01em;
    color: var(--star);
  }
  .readouts { display: flex; align-items: baseline; gap: 12px; font-size: 11px; }
  .ro { display: inline-flex; align-items: baseline; gap: 6px; color: var(--muted); }
  .ro b { color: var(--gold-bright); font-size: 14px; font-weight: 400; }
  .ro i { font-style: normal; text-transform: uppercase; letter-spacing: 0.14em; }
  .div { color: var(--panel-line); }

  .targets {
    display: grid;
    grid-template-columns: 1fr minmax(140px, 1.4fr) 1fr;
    align-items: center;
    gap: 18px;
  }
  .target { display: flex; flex-direction: column; gap: 2px; }
  .target.right { text-align: right; align-items: flex-end; }
  .eyebrow {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.34em;
    color: var(--muted);
  }
  .word {
    font-family: var(--display);
    font-weight: 400;
    font-size: clamp(28px, 6vw, 52px);
    line-height: 1;
    color: var(--gold-bright);
    text-shadow: 0 0 26px rgba(240, 198, 116, 0.4);
  }

  .meridian { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .track {
    width: 100%;
    height: 2px;
    background:
      repeating-linear-gradient(90deg, var(--panel-line) 0 5px, transparent 5px 11px);
    position: relative;
  }
  .track::before,
  .track::after {
    content: '';
    position: absolute;
    top: 50%;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    transform: translateY(-50%);
    background: var(--gold);
    box-shadow: 0 0 10px rgba(240, 198, 116, 0.8);
  }
  .track::before { left: -1px; }
  .track::after { right: -1px; }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    height: 2px;
    top: 0;
    background: linear-gradient(90deg, var(--gold), var(--cyan));
    box-shadow: 0 0 12px rgba(116, 227, 218, 0.6);
    transition: width 0.6s cubic-bezier(0.2, 0.9, 0.2, 1);
  }
  .gap {
    font-size: 10.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .gap b { color: var(--star); font-weight: 400; }
  .gap.close { color: var(--cyan); }
  .gap.close b { color: var(--cyan); }

  form {
    display: flex;
    gap: 10px;
    justify-content: center;
    align-items: stretch;
    flex-wrap: wrap;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: min(420px, 78vw);
    padding: 0 12px;
    background: var(--panel);
    border: 1px solid var(--panel-line);
    border-radius: 10px;
    backdrop-filter: blur(8px);
    transition: border-color 0.25s, box-shadow 0.25s;
  }
  .field:focus-within {
    border-color: rgba(240, 198, 116, 0.55);
    box-shadow: 0 0 0 1px rgba(240, 198, 116, 0.25), 0 0 30px -8px rgba(240, 198, 116, 0.45);
  }
  .field.err {
    border-color: rgba(255, 158, 141, 0.6);
    box-shadow: 0 0 22px -8px rgba(255, 158, 141, 0.5);
  }
  .prompt { color: var(--gold); font-size: 13px; }
  input {
    flex: 1;
    padding: 13px 2px;
    border: none;
    background: transparent;
    color: var(--star);
    font-family: var(--mono);
    font-size: 15px;
    letter-spacing: 0.02em;
  }
  input::placeholder { color: var(--muted); }
  input:focus { outline: none; }

  button {
    font-family: var(--mono);
    cursor: pointer;
    transition: all 0.2s ease;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-size: 12px;
  }
  button:disabled { opacity: 0.4; cursor: progress; }

  .add {
    border: none;
    margin: 5px 0;
    padding: 0 16px;
    border-radius: 7px;
    background: linear-gradient(180deg, var(--gold-bright), var(--gold));
    color: #2a1c06;
    font-weight: 400;
  }
  .add:not(:disabled):hover { box-shadow: 0 0 24px -4px rgba(240, 198, 116, 0.7); }

  .ghost {
    padding: 0 18px;
    border-radius: 10px;
    border: 1px solid var(--panel-line);
    background: var(--panel);
    color: var(--star-dim);
    backdrop-filter: blur(8px);
  }
  .ghost:hover { color: var(--star); border-color: rgba(150, 168, 224, 0.4); }

  .status { min-height: 18px; text-align: center; margin: 0; }
  .error {
    color: var(--danger);
    font-size: 12px;
    letter-spacing: 0.06em;
    animation: shake 0.4s ease;
  }
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-4px); }
    75% { transform: translateX(4px); }
  }

  @media (max-width: 640px) {
    .targets { grid-template-columns: 1fr; gap: 10px; text-align: center; }
    .target,
    .target.right { align-items: center; text-align: center; }
    .meridian { order: 3; }
  }
</style>
