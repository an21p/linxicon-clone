'use strict';
// Turns raw blocks into a dependency graph with a semantic role for each block.

const { splitBlocks, tokenize } = require('./parser');

/**
 * Roles, roughly in the order a reader wants them:
 *   header     comment at the top of the file
 *   system     \l, \p, \c ... (setup);  \d is kept as 'namespace'
 *   constant   name bound to a literal / static value
 *   table      table or schema definition
 *   computed   name bound to the result of running code (executes on load)
 *   statement  top-level expression that executes on load
 *   function   lambda definition
 *   handler    .z.* callback (entry point driven by the q runtime)
 *   comment    free-standing comment (attached as a note to the next block)
 *   trailer    text after the end-of-script `\`
 *
 * @typedef {import('./parser').RawBlock & {
 *   role: string,
 *   names: string[],          // fully-qualified names this block defines
 *   label: string,            // short display name
 *   uses: number[],           // ids of blocks this one references, in first-use order
 *   usedBy: number[],         // ids of blocks that reference this one
 *   notes: number[],          // ids of free-standing comment blocks shown with this one
 * }} Block
 */

// Builtins whose result depends on the outside world: binding their result is "computed".
const EFFECTFUL = new Set(['get', 'read0', 'read1', 'hopen', 'system', 'value', 'load', 'getenv', 'parse', 'eval', 'hsym']);

const qualify = (name, ns) => (name.startsWith('.') || !ns ? name : `${ns}.${name}`);

/** Finds bracket depth for every token, and top-level statement boundaries. */
function structure(tokens) {
  const depth = new Array(tokens.length);
  const braceDepth = new Array(tokens.length);
  let d = 0, b = 0;
  const starts = [0];
  tokens.forEach((t, i) => {
    if (t.type === 'punct' && (t.text === '}' || t.text === ']' || t.text === ')')) {
      d = Math.max(0, d - 1);
      if (t.text === '}') b = Math.max(0, b - 1);
    }
    depth[i] = d;
    braceDepth[i] = b;
    if (t.type === 'punct' && (t.text === '{' || t.text === '[' || t.text === '(')) {
      d++;
      if (t.text === '{') b++;
    }
    if (t.type === 'punct' && t.text === ';' && d === 0) starts.push(i + 1);
  });
  return { depth, braceDepth, starts };
}

/** Names that are local to some lambda in this block: params, `x:` assignments, implicit x y z. */
function lambdaLocals(tokens, braceDepth) {
  const locals = new Set(['x', 'y', 'z']);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'punct' && t.text === '{' && tokens[i + 1] && tokens[i + 1].text === '[') {
      for (let j = i + 2; j < tokens.length && tokens[j].text !== ']'; j++) {
        if (tokens[j].type === 'ident') locals.add(tokens[j].text);
      }
    }
    if (t.type === 'ident' && braceDepth[i] > 0 && !t.text.includes('.') &&
        tokens[i + 1] && tokens[i + 1].text === ':') {
      locals.add(t.text);
    }
  }
  return locals;
}

/** Definitions made by top-level statements: `name:...`, `name::...`, `` `name set ...``. */
function topLevelDefs(tokens, starts) {
  const defs = [];
  for (const s of starts) {
    const a = tokens[s], b = tokens[s + 1];
    if (!a || !b) continue;
    if (a.type === 'ident' && b.type === 'punct' && (b.text === ':' || b.text === '::')) {
      defs.push({ name: a.text, tokenIndex: s, rhs: s + 2 });
    } else if (a.type === 'symbol' && a.text && !a.text.startsWith(':') &&
               b.type === 'ident' && b.text === 'set') {
      defs.push({ name: a.text, tokenIndex: s, rhs: s + 2 });
    }
  }
  return defs;
}

function rhsText(code, tokens, from) {
  const t = tokens[from];
  return t ? code.slice(t.offset).trimStart() : '';
}

function looksLikeTable(rhs) {
  return /^(\d+!\s*)?\(\[/.test(rhs) || /^flip\s*`/.test(rhs) || /^`[\w`]*\s*xkey\b/.test(rhs) ||
         /^\.Q\.en\b/.test(rhs);
}

function firstLine(code, max = 48) {
  const line = code.split('\n')[0].trim();
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

/**
 * @param {string} source
 * @returns {{ blocks: Block[], defs: Map<string, number[]> }}
 */
function analyze(source) {
  /** @type {Block[]} */
  const blocks = splitBlocks(source).map((b) => ({
    ...b, role: b.kind, names: [], label: '', uses: [], usedBy: [], notes: [],
  }));
  const defs = new Map();
  const scratch = new Map(); // id -> { tokens, refTokens, rhs }

  // Pass 1: definitions and roles that don't depend on the graph.
  for (const b of blocks) {
    if (b.kind === 'comment') {
      b.role = b.id === 0 ? 'header' : 'comment';
      b.label = firstLine(b.text.replace(/^\/+\s*/, ''));
      continue;
    }
    if (b.kind === 'trailer') { b.label = 'after end of script'; continue; }
    if (b.kind === 'system') {
      b.role = /^\\d\s/.test(b.code) ? 'namespace' : 'system';
      b.label = firstLine(b.code);
      continue;
    }
    const tokens = tokenize(b.code);
    const { braceDepth, starts } = structure(tokens);
    const locals = lambdaLocals(tokens, braceDepth);
    const found = topLevelDefs(tokens, starts);
    const defTokens = new Set(found.map((d) => d.tokenIndex));
    const refTokens = tokens
      .map((t, i) => ({ t, i }))
      .filter(({ t, i }) => !defTokens.has(i) &&
        (t.type === 'symbol' ? t.text && !t.text.startsWith(':')
          : t.type === 'ident' && !(braceDepth[i] > 0 && locals.has(t.text))));

    b.names = found.map((d) => qualify(d.name, b.namespace));
    for (const name of b.names) {
      if (!defs.has(name)) defs.set(name, []);
      defs.get(name).push(b.id);
    }
    const rhs = found.length ? rhsText(b.code, tokens, found[0].rhs) : '';
    if (!found.length) b.role = 'statement';
    else if (b.names[0].startsWith('.z.')) b.role = 'handler';
    else if (rhs.startsWith('{')) b.role = 'function';
    else if (looksLikeTable(rhs)) b.role = 'table';
    else b.role = 'constant'; // may be upgraded to 'computed' once references are known
    b.label = found.length ? b.names.join(', ') : firstLine(b.code);
    scratch.set(b.id, { tokens, refTokens, rhsTokens: found.length ? tokens.slice(found[0].rhs) : tokens });
  }

  // Pass 2: resolve references against definitions.
  const resolve = (name, ns) => {
    const candidates = name.startsWith('.') ? [name] : ns ? [`${ns}.${name}`, name] : [name];
    for (let cand of candidates) {
      while (cand) {
        if (defs.has(cand)) return defs.get(cand);
        const cut = cand.lastIndexOf('.');
        if (cut <= 0) break;
        cand = cand.slice(0, cut);
      }
    }
    return null;
  };
  const isCallable = (id) => blocks[id].role === 'function' || blocks[id].role === 'handler';

  for (const b of blocks) {
    const s = scratch.get(b.id);
    if (!s) continue;
    const uses = [];
    for (const { t } of s.refTokens) {
      const targets = resolve(t.text, b.namespace);
      if (!targets) continue;
      for (const id of targets) {
        if (id === b.id || uses.includes(id)) continue;
        // a symbol only counts as a reference when it names a function (`value`f`, .z.ts:`f)
        if (t.type === 'symbol' && !isCallable(id)) continue;
        uses.push(id);
      }
    }
    b.uses = uses;
    for (const id of uses) blocks[id].usedBy.push(b.id);
  }

  // Pass 3: a binding whose value runs code is a step of the program, not configuration.
  for (const b of blocks) {
    if (b.role !== 'constant') continue;
    const s = scratch.get(b.id);
    const callsCode = b.uses.some((id) => isCallable(id) || blocks[id].role === 'computed');
    const effectful = s.rhsTokens.some((t) => t.type === 'ident' && EFFECTFUL.has(t.text));
    if (callsCode || effectful) b.role = 'computed';
  }

  // Free-standing comments become notes on the next code block (pure dividers are dropped).
  let pending = [];
  for (const b of blocks) {
    if (b.role === 'comment') {
      const body = b.text.replace(/^\/+/gm, '').replace(/^\\$/gm, '');
      if (/[A-Za-z0-9]/.test(body)) pending.push(b.id);
      continue;
    }
    if (b.role === 'header' || b.role === 'trailer') continue;
    b.notes = pending;
    pending = [];
  }

  return { blocks, defs };
}

module.exports = { analyze };
