'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { splitBlocks, tokenize } = require('../src/parser');
const { analyze } = require('../src/analyze');
const { buildStory } = require('../src/story');

const byName = (blocks, name) => blocks.find((b) => b.names.includes(name));
const labelsIn = (story, key) =>
  story.sections.find((s) => s.key === key).items.map((it) => story.blocks[it.id].label);

test('multi-line definitions continue on indented lines, across blank lines', () => {
  const blocks = splitBlocks('f:{[x]\n  a:x+1;\n\n  a*2 }\ng:1\n');
  assert.deepEqual(blocks.map((b) => [b.startLine, b.endLine]), [[0, 3], [4, 4]]);
});

test('comments directly above a block attach to it; a blank line detaches them', () => {
  const blocks = splitBlocks('/ about f\nf:{x}\n\n/ loose note\n\ng:{y}\n');
  assert.equal(blocks[0].leading, '/ about f');
  assert.equal(blocks[0].code, 'f:{x}');
  assert.equal(blocks[1].kind, 'comment');
  assert.equal(blocks[2].leading, '');
});

test('block comments and end-of-script are recognised', () => {
  const src = 'a:1\n/\nf:{x}\nnot code\n\\\n\nb:2\n\\\nignored:3\n';
  const blocks = splitBlocks(src);
  assert.deepEqual(blocks.map((b) => b.kind), ['code', 'comment', 'code', 'trailer']);
  assert.equal(blocks[1].text, '/\nf:{x}\nnot code\n\\');
  assert.equal(blocks[3].text, '\\\nignored:3\n');
});

test('\\d sets the namespace for following blocks', () => {
  const blocks = splitBlocks('\\d .cfg\nport:5010\n\\d .\nf:{x}\n');
  assert.deepEqual(blocks.map((b) => b.namespace), ['', '.cfg', '.cfg', '']);
});

test('tokenizer skips strings, trailing comments and keeps symbols and numbers whole', () => {
  const toks = tokenize('f:{g "h i" `j`k.l; 2024.01.01 + .5} / call g\n  x /y');
  const text = toks.filter((t) => t.type !== 'punct').map((t) => `${t.type}:${t.text}`);
  assert.deepEqual(text, [
    'ident:f', 'ident:g', 'string:"h i"', 'symbol:j', 'symbol:k.l',
    'number:2024.01.01', 'number:.5', 'ident:x',
  ]);
});

test('roles: function, table, constant, computed, statement, handler, system', () => {
  const { blocks } = analyze([
    '\\l util.q',
    'n:10',
    't:([] a:`long$())',
    'f:{x+n}',
    'v:f 1',
    'cfg:get `:cfg',
    '.z.ts:{f 2}',
    'f 3',
  ].join('\n'));
  assert.deepEqual(blocks.map((b) => b.role),
    ['system', 'constant', 'table', 'function', 'computed', 'computed', 'handler', 'statement']);
});

test('references respect lambda locals, namespaces and symbol references', () => {
  const { blocks } = analyze([
    'a:1',
    'b:2',
    '\\d .ns',
    'h:{[a] a+b}',          // param a shadows global a; b resolves to root b
    'g:{c:1; c+h[1]}',      // local c; h resolves to .ns.h
    '\\d .',
    '.z.ts:{value `.ns.g}', // symbol reference to a function
  ].join('\n'));
  const names = (b) => b.uses.map((id) => blocks[id].names[0]);
  assert.deepEqual(names(byName(blocks, '.ns.h')), ['b']);
  assert.deepEqual(names(byName(blocks, '.ns.g')), ['.ns.h']);
  assert.deepEqual(names(byName(blocks, '.z.ts')), ['.ns.g']);
});

test('top-down: each main step is followed by its helpers, depth-first in first-use order', () => {
  const src = [
    'leaf:{x}',
    'helperB:{leaf x}',
    'helperA:{x+1}',
    'run:{helperA helperB x}',
    'api:{x}',
    'run 1',
  ].join('\n');
  const story = buildStory(src);
  assert.deepEqual(labelsIn(story, 'main'), ['run 1', 'run', 'helperA', 'helperB', 'leaf']);
  assert.deepEqual(labelsIn(story, 'api'), ['api']);
  const depths = story.sections.find((s) => s.key === 'main').items.map((i) => i.depth);
  assert.deepEqual(depths, [0, 1, 2, 2, 3]);
});

test('bottom-up: every function appears after everything it uses', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'examples', 'rdb.q'), 'utf8');
  const story = buildStory(src, { mode: 'bottom-up' });
  const seen = new Set();
  for (const s of story.sections) {
    for (const { id } of s.items) {
      const b = story.blocks[id];
      if (b.role === 'function') {
        for (const u of b.uses) if (story.blocks[u].role === 'function') assert.ok(seen.has(u), `${b.label} before its dependency`);
      }
      seen.add(id);
    }
  }
});

test('every source line appears exactly once in the story (nothing lost, nothing duplicated)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'examples', 'rdb.q'), 'utf8');
  const lines = src.split('\n');
  for (const mode of ['top-down', 'bottom-up']) {
    const story = buildStory(src, { mode });
    const blocks = story.blocks;
    const expected = new Set();
    for (const b of blocks) {
      const dropped = b.role === 'namespace' ||
        (b.role === 'comment' && !blocks.some((o) => o.notes.includes(b.id)));
      if (!dropped) for (let l = b.startLine; l <= b.endLine; l++) expected.add(l);
    }
    const mapped = story.lineMap.filter((l, i) => l !== null && story.text.split('\n')[i] === lines[l]);
    assert.equal(mapped.length, expected.size, mode);
    assert.deepEqual(new Set(mapped), expected, mode);
  }
});

test('story lines map back to source and links point at the block range', () => {
  const story = buildStory('f:{x}\n\ng:{f x}\ng 1\n');
  const storyLine = story.storyLineOf(2);
  assert.equal(story.text.split('\n')[storyLine], 'g:{f x}');
  const link = story.links.find((l) => l.from === 2);
  assert.equal(story.text.split('\n')[link.line].slice(link.start, link.end), 'L3');
});

test('several definitions on one line, and symbol references inside @[...]', () => {
  const { blocks } = analyze('a:1;b:2\nf:{x}\ng:{@[`f;x;0]}\n');
  assert.deepEqual(blocks[0].names, ['a', 'b']);
  assert.deepEqual(byName(blocks, 'g').uses, [byName(blocks, 'f').id]);
});
