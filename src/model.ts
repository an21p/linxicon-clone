// Builds a block-level dependency graph of a q script.
//
// All q understanding (lexing, scopes, namespaces, which identifiers are definitions
// and which references resolve to globals) comes from the parser of the official KX
// language server, vendored unmodified in vendor/kx-parser. This module only decides
// which source lines form a top-level block, and summarises KX's tokens per block.

import { Name, Source, Token, Type } from "../vendor/kx-parser/source";
import { Identifier, LSql, Reserved } from "../vendor/kx-parser/keywords";
import { CharLiteral, CommentLiteral, SymbolLiteral } from "../vendor/kx-parser/literals";
import { CommentBegin, CommentEnd, ExitCommentBegin, StringEnd } from "../vendor/kx-parser/ranges";
import {
  Colon,
  Command,
  DoubleColon,
  SemiColon,
  CommentEndOfLine,
  Documentation,
  EndOfLine,
  LBracket,
  LCurly,
  LParen,
  LineComment,
  StringEscape,
  WhiteSpace,
} from "../vendor/kx-parser/tokens";

/**
 * header     comment at the top of the file
 * system     \l, \p, \c ...; `\d` is 'namespace'
 * constant   name bound to a static value
 * table      table or schema definition
 * computed   name bound to the result of running code (runs on load)
 * statement  top-level expression (runs on load)
 * function   lambda definition
 * handler    .z.* callback, driven by the q runtime
 * comment    free-standing comment (shown as a note on the next block)
 * trailer    everything after the end-of-script `\`
 */
export type Role =
  | "header" | "system" | "namespace" | "constant" | "table" | "computed"
  | "statement" | "function" | "handler" | "comment" | "trailer";

export interface Ref {
  id: number;            // block referred to
  name: string;          // fully-qualified name as written / resolved
  via: "name" | "symbol"; // `f` vs `` `f `` (value`f, .z.ts:`f, @[`f;...])
}

export interface Block {
  id: number;
  role: Role;
  startLine: number;     // 0-based, includes leading comments
  codeLine: number;      // 0-based, first line of code
  endLine: number;       // 0-based, inclusive
  text: string;          // source text, including leading comments
  code: string;          // code with comments removed (what q evaluates)
  namespace: string;     // "" for root, ".ns" otherwise
  names: string[];       // fully-qualified names defined at top level
  label: string;
  refs: Ref[];           // in first-use order, one per target block
  uses: number[];        // ids of referenced blocks (refs[].id)
  usedBy: number[];
  notes: number[];       // free-standing comment blocks shown with this one
}

export interface Model {
  blocks: Block[];
  defs: Map<string, number[]>;
  resolve(name: string): number[] | undefined;
}

const COMMENT_TYPES = new Set([
  LineComment, Documentation, CommentBegin, CommentEnd, CommentLiteral, CommentEndOfLine,
]);
const STRING_BODY = new Set([CharLiteral, StringEscape, StringEnd]);
// Builtins whose result depends on the outside world: binding their result is "computed".
const EFFECTFUL = new Set(["get", "read0", "read1", "hopen", "system", "value", "load", "getenv", "parse", "eval"]);

type LineKind = "blank" | "comment" | "start" | "continue" | "exit" | "command";

/** Classifies each line by the KX tokens on it. */
function classifyLines(lines: string[], tokens: Token[]): LineKind[] {
  const kinds: LineKind[] = lines.map((l) => (l.trim() === "" ? "blank" : "continue"));
  const byLine = new Map<number, Token[]>();
  for (const t of tokens) {
    const line = (t.startLine ?? 1) - 1;
    if (!byLine.has(line)) byLine.set(line, []);
    byLine.get(line)!.push(t);
  }
  let exited = false;
  for (let i = 0; i < lines.length; i++) {
    if (exited) { kinds[i] = "exit"; continue; }
    const toks = (byLine.get(i) || []).filter((t) => Type(t) !== EndOfLine);
    if (!toks.length) continue; // blank, or the inside of a block comment
    const first = toks[0];
    if (Type(first) === ExitCommentBegin) { kinds[i] = "exit"; exited = true; continue; }
    const meaningful = toks.filter((t) => Type(t) !== WhiteSpace);
    if (!meaningful.length) { kinds[i] = "blank"; continue; }
    if (meaningful.every((t) => COMMENT_TYPES.has(Type(t)!))) { kinds[i] = "comment"; continue; }
    if ((first.startColumn ?? 1) !== 1 || Type(first) === WhiteSpace || STRING_BODY.has(Type(first)!)) {
      kinds[i] = "continue"; // indented, or the rest of a multi-line string
      continue;
    }
    kinds[i] = Type(first) === Command ? "command" : "start";
  }
  // lines inside a block comment carry no tokens of their own: mark them as comment
  for (const t of tokens) {
    if (Type(t) === CommentBegin || Type(t) === CommentLiteral || Type(t) === CommentEnd) {
      for (let l = (t.startLine ?? 1) - 1; l <= (t.endLine ?? t.startLine ?? 1) - 1; l++) {
        if (kinds[l] !== "exit") kinds[l] = "comment";
      }
    }
  }
  return kinds;
}

interface Span { kind: "code" | "command" | "comment" | "trailer"; start: number; codeStart: number; end: number }

/** Groups lines into top-level blocks; comments directly above a block belong to it. */
function spans(lines: string[], kinds: LineKind[]): Span[] {
  const out: Span[] = [];
  let comment: { start: number; end: number } | null = null;
  let current: Span | null = null;
  const flushComment = () => {
    if (comment) out.push({ kind: "comment", start: comment.start, codeStart: comment.start, end: comment.end });
    comment = null;
  };
  const flushCode = () => {
    if (!current) return;
    while (current.end > current.codeStart && kinds[current.end] === "blank") current.end--;
    out.push(current);
    current = null;
  };
  for (let i = 0; i < lines.length; i++) {
    switch (kinds[i]) {
      case "exit":
        flushCode(); flushComment();
        out.push({ kind: "trailer", start: i, codeStart: i, end: lines.length - 1 });
        return out;
      case "comment":
        if (current && kinds[i - 1] !== "blank" && /^[ \t]/.test(lines[i])) { current.end = i; break; } // indented comment inside a body
        flushCode();
        if (comment && comment.end === i - 1) comment.end = i;
        else { flushComment(); comment = { start: i, end: i }; }
        break;
      case "blank":
        if (!current) flushComment();
        break;
      case "continue":
        if (current) { current.end = i; break; }
      // falls through: a stray indented line with nothing to continue starts a block
      case "start":
      case "command": {
        flushCode();
        // a comment at the very top of the file describes the file, not the first block
        if (comment && !out.some((s) => s.kind !== "comment")) flushComment();
        const start = comment ? comment.start : i;
        comment = null;
        current = { kind: kinds[i] === "command" ? "command" : "code", start, codeStart: i, end: i };
        break;
      }
    }
  }
  flushCode();
  flushComment();
  return out;
}

function firstLine(text: string, max = 48) {
  const line = text.split("\n")[0].trim();
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

const lineOf = (t: Token) => (t.startLine ?? 1) - 1;
const nsOf = (t: Token) => (t.namespace && t.namespace !== "." ? t.namespace : "");

export function analyze(text: string, uri = "file:///untitled.q"): Model {
  const source = Source.create(uri, text);
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const kinds = classifyLines(lines, source.tokens);

  const blocks: Block[] = spans(lines, kinds).map((s, id) => ({
    id,
    role: s.kind === "trailer" ? "trailer" : s.kind === "comment" ? (id === 0 ? "header" : "comment") : s.kind === "command" ? "system" : "statement",
    startLine: s.start,
    codeLine: s.codeStart,
    endLine: s.end,
    text: lines.slice(s.start, s.end + 1).join("\n"),
    code: "",
    namespace: "",
    names: [],
    label: "",
    refs: [],
    uses: [],
    usedBy: [],
    notes: [],
  }));

  // KX tokens for each block's code lines
  const blockOfLine = new Array<number | undefined>(lines.length);
  for (const b of blocks) for (let l = b.codeLine; l <= b.endLine; l++) blockOfLine[l] = b.id;
  const tokensOf = new Map<number, Token[]>();
  for (const t of source.tokens) {
    const id = blockOfLine[lineOf(t)];
    if (id === undefined) continue;
    if (!tokensOf.has(id)) tokensOf.set(id, []);
    tokensOf.get(id)!.push(t);
  }

  const globalDefs = new Set(source.symbols);
  const globalRefs = new Set(source.references.filter((t) => !t.scope));
  const defs = new Map<string, number[]>();
  const defTokens = new Set<Token>();
  for (const b of blocks) {
    if (b.role === "header" || b.role === "comment" || b.role === "trailer") {
      b.label = firstLine(b.text.replace(/^\/+\s*/, ""));
      continue;
    }
    const toks = tokensOf.get(b.id) || [];
    b.code = toks.filter((t) => !COMMENT_TYPES.has(Type(t)!)).map((t) => t.image).join("").replace(/[ \t]+$/gm, "").trimEnd();
    b.namespace = toks.length ? nsOf(toks[0]) : "";
    if (b.role === "system") {
      if (/^\\d\s/.test(b.code)) b.role = "namespace";
      b.label = firstLine(b.code);
      continue;
    }
    // top-level definitions: global (no lambda scope) and not a table column (no paren/sql mode)
    const own = toks.filter((t) => (globalDefs.has(t) && Type(t) === Identifier && !t.mode) || handlerDef(toks, t));
    own.forEach((t) => defTokens.add(t));
    b.names = [...new Set(own.map((t) => Name(t)))];
    for (const name of b.names) {
      if (!defs.has(name)) defs.set(name, []);
      defs.get(name)!.push(b.id);
    }
    b.label = b.names.length ? b.names.join(", ") : firstLine(b.code);
  }

  // roles of definitions, from what the first definition is bound to
  for (const b of blocks) {
    if (b.role !== "statement" || !b.names.length) continue;
    const toks = tokensOf.get(b.id)!;
    const sig = toks.filter((t) => Type(t) !== WhiteSpace && Type(t) !== EndOfLine && !COMMENT_TYPES.has(Type(t)!));
    const def = sig.findIndex((t) => defTokens.has(t));
    const value = sig.slice(def + 2); // after `name:`
    if (b.names[0].startsWith(".z.")) b.role = "handler";
    else if (Type(value[0]) === LCurly) b.role = "function";
    else if (looksLikeTable(value)) b.role = "table";
    else b.role = "constant";
  }
  const isCallable = (id: number) => blocks[id].role === "function" || blocks[id].role === "handler";
  const callable = new Set(blocks.filter((b) => isCallable(b.id)).flatMap((b) => b.names));

  const resolve = (name: string) => {
    // `cfg.port` on a dictionary `cfg` resolves to `cfg`
    for (let cand = name; cand; ) {
      if (defs.has(cand)) return defs.get(cand);
      const cut = cand.lastIndexOf(".");
      if (cut <= 0) return undefined;
      cand = cand.slice(0, cut);
    }
    return undefined;
  };

  for (const b of blocks) {
    const toks = tokensOf.get(b.id);
    if (!toks || b.role === "system" || b.role === "namespace") continue;
    const refs: Ref[] = [];
    const add = (name: string, via: Ref["via"]) => {
      for (const id of resolve(name) || []) {
        if (id !== b.id && !refs.some((r) => r.id === id)) refs.push({ id, name, via });
      }
    };
    for (const t of toks) {
      if (Type(t) === SymbolLiteral) {
        const sym = t.image.slice(1);
        if (!sym || sym.startsWith(":")) continue;
        const name = sym.startsWith(".") || !nsOf(t) ? sym : `${nsOf(t)}.${sym}`;
        if (callable.has(name)) add(name, "symbol");
      } else if (globalRefs.has(t) && !defTokens.has(t) && Type(t.mode) !== LSql) {
        add(Name(t), "name"); // KX resolved this identifier to a global
      }
    }
    b.refs = refs;
    b.uses = refs.map((r) => r.id);
  }
  for (const b of blocks) for (const id of b.uses) blocks[id].usedBy.push(b.id);

  for (const b of blocks) {
    if (b.role !== "constant") continue;
    const runsCode = b.uses.some((id) => isCallable(id) || blocks[id].role === "computed");
    const effectful = (tokensOf.get(b.id) || []).some((t) => EFFECTFUL.has(t.image) && Type(t) !== Identifier);
    if (runsCode || effectful) b.role = "computed";
  }

  // comments before the first code describe the file, unless they are a section banner
  const banner = (b: Block) => /^\/+\s*([-=*#~_])\1{4,}/m.test(b.text);
  for (const b of blocks) {
    if (b.role !== "comment" && b.role !== "header") break;
    b.role = banner(b) ? "comment" : "header";
  }
  // other free-standing comments become notes on the next block (pure dividers are dropped)
  let pending: number[] = [];
  for (const b of blocks) {
    if (b.role === "comment") {
      if (/[A-Za-z0-9]/.test(b.text.replace(/^\/+/gm, ""))) pending.push(b.id);
      continue;
    }
    if (b.role === "header" || b.role === "trailer" || b.role === "namespace") continue;
    b.notes = pending;
    pending = [];
  }

  return { blocks, defs, resolve };
}

/**
 * KX lexes `.z.pc` etc. as Reserved and does not record assignments to them; a
 * top-level `.z.xx:` (or `::`) at the start of a statement defines a handler.
 */
function handlerDef(toks: Token[], t: Token) {
  if (Type(t) !== Reserved || !t.image.startsWith(".z.") || t.scope || t.mode) return false;
  const sig = toks.filter((x) => Type(x) !== WhiteSpace);
  const i = sig.indexOf(t);
  const next = sig[i + 1], prev = sig[i - 1];
  return (Type(next) === Colon || Type(next) === DoubleColon) &&
    (!prev || Type(prev) === SemiColon || Type(prev) === EndOfLine);
}

function looksLikeTable(value: Token[]) {
  const [a, b] = value;
  const text = value.map((t) => t.image).join(" ");
  return (Type(a) === LParen && Type(b) === LBracket) ||   // ([] ...) and ([k] ...)
    /^\d+ ! \( \[/.test(text) ||                          // 1!([] ...)
    /^flip /.test(text) || /\bxkey\b/.test(text) || /^\.Q\.en /.test(text);
}
