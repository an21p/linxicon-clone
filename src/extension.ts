import * as path from "path";
import * as vscode from "vscode";
import { buildStory, Mode, Section, Story } from "./story";

const SCHEME = "q-storyline";
const ICONS: Record<string, string> = {
  system: "gear", constant: "symbol-constant", table: "table", computed: "symbol-variable",
  statement: "play", function: "symbol-function", handler: "zap", header: "book", trailer: "archive",
};

const config = () => vscode.workspace.getConfiguration("qStoryline");
const defaultMode = () => config().get<Mode>("defaultMode", "top-down");
const isQ = (doc?: vscode.TextDocument): doc is vscode.TextDocument =>
  !!doc && doc.uri.scheme !== SCHEME && (doc.languageId === "q" || doc.fileName.endsWith(".q"));

/** Story documents are `q-storyline:/<name> (<mode>).story?<mode>#<source uri>`. */
function storyUri(sourceUri: vscode.Uri, mode: Mode) {
  const name = path.basename(sourceUri.path, ".q");
  return vscode.Uri.from({ scheme: SCHEME, path: `/${name} (${mode}).story`, query: mode, fragment: sourceUri.toString() });
}
const sourceOf = (uri: vscode.Uri) => vscode.Uri.parse(uri.fragment);
const modeOf = (uri: vscode.Uri): Mode => (uri.query === "bottom-up" ? "bottom-up" : "top-down");

async function storyFor(sourceUri: vscode.Uri, mode: Mode) {
  const doc = await vscode.workspace.openTextDocument(sourceUri);
  return buildStory(doc.getText(), {
    mode,
    uri: sourceUri.toString(),
    annotate: config().get("annotate", true),
    fileName: path.basename(sourceUri.path),
  });
}

class StoryProvider implements vscode.TextDocumentContentProvider, vscode.DocumentLinkProvider {
  readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;
  private cache = new Map<string, Story>();

  async provideTextDocumentContent(uri: vscode.Uri) {
    const story = await storyFor(sourceOf(uri), modeOf(uri));
    this.cache.set(uri.toString(), story);
    return story.text;
  }
  async get(uri: vscode.Uri) {
    if (!this.cache.has(uri.toString())) await this.provideTextDocumentContent(uri);
    return this.cache.get(uri.toString())!;
  }
  refreshAll(sourceUri?: vscode.Uri) {
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme === SCHEME && (!sourceUri || doc.uri.fragment === sourceUri.toString())) this.changed.fire(doc.uri);
    }
  }
  provideDocumentLinks(doc: vscode.TextDocument) {
    const story = this.cache.get(doc.uri.toString());
    if (!story) return [];
    const src = sourceOf(doc.uri);
    return story.links.map((l) => {
      const args = encodeURIComponent(JSON.stringify([src.toString(), l.from, l.to]));
      const link = new vscode.DocumentLink(
        new vscode.Range(l.line, l.start, l.line, l.end),
        vscode.Uri.parse(`command:qStoryline.revealSource?${args}`),
      );
      link.tooltip = "Show in source";
      return link;
    });
  }
}

const flashDecoration = vscode.window.createTextEditorDecorationType({
  backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
  isWholeLine: true,
});
function flash(editor: vscode.TextEditor, range: vscode.Range) {
  editor.setDecorations(flashDecoration, [range]);
  setTimeout(() => editor.setDecorations(flashDecoration, []), 1200);
}

async function revealSource(sourceUri: vscode.Uri | string, from: number, to = from) {
  const uri = typeof sourceUri === "string" ? vscode.Uri.parse(sourceUri) : sourceUri;
  const doc = await vscode.workspace.openTextDocument(uri);
  // prefer the column the source is already visible in, otherwise open beside
  const visible = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri.toString());
  const editor = await vscode.window.showTextDocument(doc, {
    viewColumn: visible ? visible.viewColumn : vscode.ViewColumn.Beside,
    preserveFocus: false,
  });
  const range = new vscode.Range(from, 0, to, doc.lineAt(Math.min(to, doc.lineCount - 1)).text.length);
  editor.selection = new vscode.Selection(range.start, range.start);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  flash(editor, range);
}

async function openStory(provider: StoryProvider, sourceUri: vscode.Uri, mode: Mode, line?: number | null) {
  const uri = storyUri(sourceUri, mode);
  const doc = await vscode.workspace.openTextDocument(uri);
  if (doc.languageId !== "q-storyline") await vscode.languages.setTextDocumentLanguage(doc, "q-storyline");
  const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
  if (line !== undefined && line !== null) {
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
    const story = await provider.get(uri);
    const id = story.blockAt[line];
    if (id !== null && id !== undefined) {
      flash(editor, new vscode.Range(story.blockAt.indexOf(id), 0, story.blockAt.lastIndexOf(id), 0));
    }
  }
  return editor;
}

type Node =
  | { type: "section"; section: Section; index: number }
  | { type: "block"; section: Section; id: number };

/** Explorer tree: sections, then blocks nested under the block they are a helper of. */
class OutlineProvider implements vscode.TreeDataProvider<Node> {
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  story: Story | null = null;
  sourceUri: vscode.Uri | null = null;

  async update(doc?: vscode.TextDocument) {
    if (doc && doc.uri.scheme === SCHEME) doc = await vscode.workspace.openTextDocument(sourceOf(doc.uri));
    if (!isQ(doc)) return; // keep showing the last q file
    this.sourceUri = doc.uri;
    this.story = buildStory(doc.getText(), { mode: defaultMode(), uri: doc.uri.toString() });
    this.changed.fire();
  }
  getChildren(node?: Node): Node[] {
    if (!this.story) return [];
    if (!node) return this.story.sections.map((section, index) => ({ type: "section", section, index }));
    return node.section.items
      .filter((it) => (node.type === "section" ? it.depth === 0 : it.parent === node.id))
      .map((it) => ({ type: "block", section: node.section, id: it.id }));
  }
  getTreeItem(node: Node): vscode.TreeItem {
    if (node.type === "section") {
      const t = new vscode.TreeItem(`${node.index + 1} · ${node.section.title}`, vscode.TreeItemCollapsibleState.Expanded);
      t.tooltip = node.section.blurb;
      t.description = `${node.section.items.length}`;
      return t;
    }
    const blocks = this.story!.blocks;
    const b = blocks[node.id];
    const hasKids = node.section.items.some((it) => it.parent === b.id);
    const t = new vscode.TreeItem(b.label, hasKids ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    t.description = `${b.role} · L${b.codeLine + 1}`;
    t.iconPath = new vscode.ThemeIcon(ICONS[b.role] || "symbol-misc");
    const uses = b.uses.map((id) => blocks[id].label).join(", ");
    const usedBy = b.usedBy.map((id) => blocks[id].label).join(", ");
    t.tooltip = new vscode.MarkdownString(
      `**${b.label}** — ${b.role}${b.namespace ? ` in \`${b.namespace}\`` : ""}\n\n` +
      (uses ? `uses: ${uses}\n\n` : "") + (usedBy ? `used by: ${usedBy}` : ""),
    );
    t.command = { command: "qStoryline.revealSource", title: "Show in source", arguments: [this.sourceUri!.toString(), b.startLine, b.endLine] };
    return t;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new StoryProvider();
  const outline = new OutlineProvider();
  const timers = new Map<string, NodeJS.Timeout>();

  const sourceEditor = () => {
    const editor = vscode.window.activeTextEditor;
    if (editor && isQ(editor.document)) return editor;
    vscode.window.showInformationMessage("q Storyline: open a .q file first.");
    return undefined;
  };
  const storyEditor = () => {
    const editor = vscode.window.activeTextEditor;
    return editor && editor.document.uri.scheme === SCHEME ? editor : undefined;
  };

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
    vscode.languages.registerDocumentLinkProvider({ scheme: SCHEME }, provider),
    vscode.window.registerTreeDataProvider("qStoryline.outline", outline),

    vscode.commands.registerCommand("qStoryline.open", async (uri?: vscode.Uri) => {
      const target = uri instanceof vscode.Uri ? uri : sourceEditor()?.document.uri;
      if (target) await openStory(provider, target, defaultMode());
    }),
    vscode.commands.registerCommand("qStoryline.openBottomUp", async () => {
      const editor = sourceEditor();
      if (editor) await openStory(provider, editor.document.uri, "bottom-up");
    }),
    vscode.commands.registerCommand("qStoryline.toggleMode", async () => {
      const editor = storyEditor();
      if (!editor) return;
      const uri = editor.document.uri;
      const other: Mode = modeOf(uri) === "top-down" ? "bottom-up" : "top-down";
      // keep the reader on the same block across modes
      const story = await provider.get(uri);
      const src = story.lineMap[editor.selection.active.line];
      const next = await storyFor(sourceOf(uri), other);
      await openStory(provider, sourceOf(uri), other, src === null ? 0 : next.storyLineOf(src));
    }),
    vscode.commands.registerCommand("qStoryline.goToSource", async () => {
      const editor = storyEditor();
      if (!editor) return;
      const story = await provider.get(editor.document.uri);
      let src: number | null = null;
      for (let i = editor.selection.active.line; src === null && i < story.lineMap.length; i++) src = story.lineMap[i];
      if (src !== null) await revealSource(sourceOf(editor.document.uri), src);
    }),
    vscode.commands.registerCommand("qStoryline.revealInStory", async () => {
      const editor = sourceEditor();
      if (!editor) return;
      const story = await storyFor(editor.document.uri, defaultMode());
      await openStory(provider, editor.document.uri, defaultMode(), story.storyLineOf(editor.selection.active.line));
    }),
    vscode.commands.registerCommand("qStoryline.revealSource", revealSource),
    vscode.commands.registerCommand("qStoryline.refreshOutline", () => outline.update(vscode.window.activeTextEditor?.document)),

    vscode.window.onDidChangeActiveTextEditor((e) => outline.update(e?.document)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!isQ(e.document)) return;
      const key = e.document.uri.toString();
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(() => {
        provider.refreshAll(e.document.uri);
        if (outline.sourceUri?.toString() === key) outline.update(e.document);
      }, 300));
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("qStoryline")) return;
      provider.refreshAll();
      outline.update(vscode.window.activeTextEditor?.document);
    }),
    { dispose: () => timers.forEach(clearTimeout) },
  );

  outline.update(vscode.window.activeTextEditor?.document);
}

export function deactivate() {}
