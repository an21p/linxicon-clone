// Orders analyzed blocks into a storyline and renders it as a reading view.
//
// Top-down (default): context first (overview, setup, configuration, data), then what
// the script *does*, each step immediately followed by the helpers it relies on
// ("stepdown rule"), then the event handlers and externally-called entry points.
//
// Bottom-up: the same context, then building blocks leaves-first so every function is
// introduced before anything that calls it, ending with the program's main flow.

import { analyze, Block, Model, Role } from "./model";

export type Mode = "top-down" | "bottom-up";

type SectionKey = "overview" | "setup" | "config" | "data" | "main" | "handlers" | "api" | "blocks" | "other" | "appendix";

const SECTIONS: Record<SectionKey, [string, string]> = {
  overview: ["Overview", "what this file is about"],
  setup: ["Setup", "loads and system settings"],
  config: ["Configuration", "constants the rest of the code reads"],
  data: ["Data model", "tables and schemas"],
  main: ["Main flow", "what runs when the script loads, in order; each step is followed by the helpers it uses"],
  handlers: ["Event handlers", ".z.* callbacks: what runs on IPC messages, timers and connections"],
  api: ["Entry points", "functions nothing in this file calls: invoked from outside (IPC, other scripts) or unused"],
  blocks: ["Building blocks", "functions, leaves first: each one only uses what is already above it"],
  other: ["Other definitions", "only reachable through each other (mutual recursion)"],
  appendix: ["Appendix", "trailing comments, and text after the end-of-script \\ (ignored by q)"],
};

const TOP_DOWN: SectionKey[] = ["overview", "setup", "config", "data", "main", "handlers", "api", "other", "appendix"];
const BOTTOM_UP: SectionKey[] = ["overview", "setup", "config", "data", "blocks", "other", "handlers", "main", "appendix"];

export interface Item { id: number; depth: number; parent: number | null }
export interface Section { key: SectionKey; title: string; blurb: string; items: Item[] }

export function order(blocks: Block[], mode: Mode): Section[] {
  const placed = new Set<number>();
  const buckets = Object.fromEntries(Object.keys(SECTIONS).map((k) => [k, [] as Item[]])) as Record<SectionKey, Item[]>;
  const put = (key: SectionKey, id: number, depth = 0, parent: number | null = null) => {
    placed.add(id);
    buckets[key].push({ id, depth, parent });
  };
  const byRole = (...roles: Role[]) => blocks.filter((b) => roles.includes(b.role)).map((b) => b.id);
  const isHelper = (id: number) => blocks[id].role === "function";

  byRole("header").forEach((id) => put("overview", id));
  byRole("system").forEach((id) => put("setup", id));
  byRole("namespace").forEach((id) => placed.add(id)); // shown as "in .ns" on each block
  const noted = new Set(blocks.flatMap((b) => b.notes));
  byRole("comment").forEach((id) => (noted.has(id) ? placed.add(id) : put("appendix", id))); // notes, or trailing comments
  byRole("constant").forEach((id) => put("config", id));
  byRole("table").forEach((id) => put("data", id));
  byRole("trailer").forEach((id) => put("appendix", id));
  buckets.appendix.sort((a, b) => a.id - b.id);

  const steps = byRole("statement", "computed");
  const handlers = byRole("handler");
  const roots = () => byRole("function").filter((id) => !placed.has(id) && blocks[id].usedBy.length === 0);

  if (mode === "bottom-up") {
    // post-order: callees before callers
    const visiting = new Set<number>();
    const visit = (id: number) => {
      if (placed.has(id) || visiting.has(id)) return;
      visiting.add(id);
      blocks[id].uses.filter(isHelper).forEach(visit);
      visiting.delete(id);
      if (isHelper(id)) put("blocks", id);
    };
    [...steps, ...handlers].forEach((id) => blocks[id].uses.filter(isHelper).forEach(visit));
    roots().forEach(visit);
    byRole("function").filter((id) => !placed.has(id)).forEach((id) => put("other", id));
    handlers.forEach((id) => put("handlers", id));
    steps.forEach((id) => put("main", id));
  } else {
    // pre-order: each block followed by the helpers it uses, in first-use order
    const tell = (key: SectionKey, id: number, depth: number, parent: number | null) => {
      if (placed.has(id)) return;
      put(key, id, depth, parent);
      blocks[id].uses.filter(isHelper).forEach((u) => tell(key, u, depth + 1, id));
    };
    steps.forEach((id) => tell("main", id, 0, null));
    handlers.forEach((id) => tell("handlers", id, 0, null));
    roots().forEach((id) => tell("api", id, 0, null));
    byRole("function").filter((id) => !placed.has(id)).forEach((id) => tell("other", id, 0, null));
  }

  return (mode === "bottom-up" ? BOTTOM_UP : TOP_DOWN)
    .map((key) => {
      const [title, blurb] = SECTIONS[key];
      const plain = mode === "bottom-up" && key === "main" ? blurb.replace(/; each step.*$/, "") : blurb;
      return { key, title, blurb: plain, items: buckets[key] };
    })
    .filter((s) => s.items.length);
}

const RULE = "/ " + "═".repeat(76);

function shortLabel(b: Block, max = 24) {
  return b.label.length > max ? b.label.slice(0, max - 1) + "…" : b.label;
}

function list(ids: number[], blocks: Block[], max = 5) {
  const uniq = [...new Set(ids.map((id) => blocks[id].names[0] || shortLabel(blocks[id])))];
  return uniq.length > max ? uniq.slice(0, max).join(", ") + `, +${uniq.length - max}` : uniq.join(", ");
}

function lineRange(b: Block) {
  return b.startLine === b.endLine ? `L${b.startLine + 1}` : `L${b.startLine + 1}-${b.endLine + 1}`;
}

export interface Link { line: number; start: number; end: number; from: number; to: number }

export interface Story {
  text: string;
  sections: Section[];
  model: Model;
  blocks: Block[];
  lineMap: (number | null)[];   // story line -> source line
  blockAt: (number | null)[];   // story line -> block id
  links: Link[];
  storyLineOf(sourceLine: number): number | null;
}

export interface StoryOptions { mode?: Mode; fileName?: string; annotate?: boolean; uri?: string }

export function buildStory(source: string, opts: StoryOptions = {}): Story {
  const mode = opts.mode || "top-down";
  const annotate = opts.annotate !== false;
  const model = analyze(source, opts.uri);
  const { blocks } = model;
  const sections = order(blocks, mode);

  const out: string[] = [];
  const lineMap: (number | null)[] = [];
  const blockAt: (number | null)[] = [];
  const links: Link[] = [];
  const emit = (text: string, src: number | null = null, block: number | null = null) => {
    out.push(text); lineMap.push(src); blockAt.push(block);
  };
  const emitBlockText = (b: Block) => b.text.split("\n").forEach((l, k) => emit(l, b.startLine + k, b.id));

  const code = blocks.filter((b) => !["header", "comment", "trailer", "namespace"].includes(b.role));
  const fns = code.filter((b) => b.role === "function" || b.role === "handler").length;
  emit(`/ q storyline · ${mode} · ${opts.fileName || "untitled"} · ${code.length} blocks, ${fns} functions`);
  emit("/ reading view: blocks are reordered for understanding, not for execution");

  sections.forEach((section, n) => {
    emit("");
    emit(RULE);
    emit(`/ ${n + 1} · ${section.title.toUpperCase()} — ${section.blurb}`);
    emit(RULE);
    for (const item of section.items) {
      const b = blocks[item.id];
      emit("");
      if (annotate && section.key !== "overview" && section.key !== "appendix") {
        const marker = item.depth ? "  ".repeat(item.depth - 1) + "↳" : "▸";
        const range = lineRange(b);
        let header = `/ ${marker} ${b.label} · `;
        const start = header.length;
        header += range;
        links.push({ line: out.length, start, end: start + range.length, from: b.startLine, to: b.endLine });
        header += ` · ${b.role}`;
        if (b.namespace) header += ` in ${b.namespace}`;
        if (item.parent !== null) header += ` · helper of ${list([item.parent], blocks)}`;
        const uses = list(b.uses, blocks);
        const usedBy = list(b.usedBy.filter((id) => id !== item.parent), blocks);
        if (uses) header += ` · uses ${uses}`;
        if (usedBy) header += ` · ${item.parent !== null ? "also used by" : "used by"} ${usedBy}`;
        else if (!b.usedBy.length && (b.role === "constant" || b.role === "table")) header += " · unused";
        emit(header, null, b.id);
      }
      for (const noteId of b.notes) emitBlockText(blocks[noteId]);
      emitBlockText(b);
    }
  });
  emit("");

  const storyLineOf = (sourceLine: number) => {
    const exact = lineMap.indexOf(sourceLine);
    if (exact >= 0) return exact;
    // a blank or dropped line: fall back to the nearest mapped line above it
    let best: number | null = null, bestSrc = -1;
    lineMap.forEach((src, i) => { if (src !== null && src <= sourceLine && src > bestSrc) { best = i; bestSrc = src; } });
    return best;
  };

  return { text: out.join("\n"), sections, model, blocks, lineMap, blockAt, links, storyLineOf };
}
