'use strict';
// Splits a q script into top-level blocks and tokenizes their code.
//
// q script layout rules this relies on:
//   - a statement starts in column 0; lines starting with whitespace continue it
//   - a line starting with `/` is a comment; ` /` (whitespace then slash) starts a
//     trailing comment
//   - a line that is exactly `/` opens a block comment, closed by a line that is
//     exactly `\`
//   - outside a block comment, a line that is exactly `\` ends the script
//   - `\d .ns` switches the namespace that unqualified definitions land in

/**
 * @typedef {{type: 'ident'|'symbol'|'string'|'number'|'punct', text: string, offset: number}} Token
 * @typedef {{
 *   id: number,
 *   kind: 'code'|'system'|'comment'|'trailer',
 *   startLine: number,        // 0-based, first line including leading comments
 *   codeLine: number,         // 0-based, first line of code (== startLine for comments)
 *   endLine: number,          // 0-based, inclusive
 *   text: string,             // full text including leading comments
 *   code: string,             // code only (no leading comments)
 *   leading: string,          // leading comment text ('' if none)
 *   namespace: string,        // active `\d` namespace ('' for root)
 * }} RawBlock
 */

const isBlank = (line) => line.trim() === '';
const isLineComment = (line) => line.startsWith('/');
const isIndented = (line) => /^[ \t]/.test(line);

/**
 * @param {string} source
 * @returns {RawBlock[]}
 */
function splitBlocks(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  /** @type {RawBlock[]} */
  const blocks = [];
  let namespace = '';
  let pendingComment = null; // { start, end } of comment lines directly above
  let current = null;        // code block being built: { start, end, codeStart }

  const push = (kind, start, codeStart, end) => {
    const slice = lines.slice(start, end + 1);
    const codeSlice = lines.slice(codeStart, end + 1);
    blocks.push({
      id: blocks.length,
      kind,
      startLine: start,
      codeLine: codeStart,
      endLine: end,
      text: slice.join('\n'),
      code: kind === 'comment' || kind === 'trailer' ? '' : codeSlice.join('\n'),
      leading: codeStart > start ? lines.slice(start, codeStart).join('\n') : '',
      namespace,
    });
  };
  const flushComment = () => {
    if (pendingComment) push('comment', pendingComment.start, pendingComment.start, pendingComment.end);
    pendingComment = null;
  };
  const flushCode = () => {
    if (!current) return;
    let end = current.end;
    while (end > current.codeStart && isBlank(lines[end])) end--;
    const first = lines[current.codeStart];
    const kind = first.startsWith('\\') ? 'system' : 'code';
    push(kind, current.start, current.codeStart, end);
    if (kind === 'system') {
      const m = /^\\d\s+(\S+)/.exec(first);
      if (m) namespace = m[1] === '.' ? '' : m[1];
    }
    current = null;
  };
  const addComment = (start, end) => {
    if (pendingComment && pendingComment.end === start - 1) pendingComment.end = end;
    else { flushComment(); pendingComment = { start, end }; }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    if (trimmed === '/') {
      // block comment: runs to a line that is exactly `\` (or EOF)
      flushCode();
      let j = i + 1;
      while (j < lines.length && lines[j].trimEnd() !== '\\') j++;
      const end = Math.min(j, lines.length - 1);
      addComment(i, end);
      i = end;
      continue;
    }
    if (trimmed === '\\') {
      // end of script: everything after is ignored by q
      flushCode();
      flushComment();
      push('trailer', i, i, lines.length - 1);
      break;
    }
    if (isLineComment(line)) {
      flushCode();
      addComment(i, i);
      continue;
    }
    if (isBlank(line)) {
      if (current) continue; // may still be continued by an indented line
      flushComment();        // a blank line detaches a comment from what follows
      continue;
    }
    if (isIndented(line) && current) {
      current.end = i;
      continue;
    }
    // a new top-level statement (or a stray indented line with nothing to continue)
    flushCode();
    const start = pendingComment ? pendingComment.start : i;
    pendingComment = null;
    current = { start, codeStart: i, end: i };
  }
  flushCode();
  flushComment();
  return blocks;
}

const IDENT_START = /[A-Za-z]/;
const IDENT_CHAR = /[A-Za-z0-9_.]/;

/**
 * Tokenizes q code. Comments are dropped; strings and symbols become single tokens.
 * @param {string} code
 * @returns {Token[]}
 */
function tokenize(code) {
  /** @type {Token[]} */
  const tokens = [];
  const n = code.length;
  let i = 0;
  while (i < n) {
    const c = code[i];
    const prev = i === 0 ? '\n' : code[i - 1];

    if (c === '/' && /\s/.test(prev)) { // comment to end of line
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') {
      const start = i++;
      while (i < n && code[i] !== '"') i += code[i] === '\\' ? 2 : 1;
      i++;
      tokens.push({ type: 'string', text: code.slice(start, i), offset: start });
      continue;
    }
    if (c === '`') {
      const start = i++;
      while (i < n && /[A-Za-z0-9_.:/]/.test(code[i])) i++;
      tokens.push({ type: 'symbol', text: code.slice(start + 1, i), offset: start });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(code[i + 1] || ''))) {
      const start = i;
      while (i < n && /[A-Za-z0-9_.:]/.test(code[i])) i++;
      tokens.push({ type: 'number', text: code.slice(start, i), offset: start });
      continue;
    }
    if (IDENT_START.test(c) || (c === '.' && IDENT_START.test(code[i + 1] || ''))) {
      const start = i++;
      while (i < n && IDENT_CHAR.test(code[i])) i++;
      // `a.` is not a name; leave a trailing dot as punctuation
      let end = i;
      if (code[end - 1] === '.') end--;
      tokens.push({ type: 'ident', text: code.slice(start, end), offset: start });
      i = end;
      continue;
    }
    if (c === ':' && code[i + 1] === ':') {
      tokens.push({ type: 'punct', text: '::', offset: i });
      i += 2;
      continue;
    }
    tokens.push({ type: 'punct', text: c, offset: i });
    i++;
  }
  return tokens;
}

module.exports = { splitBlocks, tokenize };
