'use strict';
const vscode = require('vscode');
const path = require('path');
const { buildStory } = require('./story');

const SCHEME = 'q-storyline';
const ICONS = {
  system: 'gear', constant: 'symbol-constant', table: 'table', computed: 'symbol-variable',
  statement: 'play', function: 'symbol-function', handler: 'zap', header: 'book', trailer: 'archive',
};

const config = () => vscode.workspace.getConfiguration('qStoryline');
const isQ = (doc) => doc && doc.uri.scheme !== SCHEME && (doc.languageId === 'q' || doc.fileName.endsWith('.q'));

/** Story documents are `q-storyline:/<name>.story?<mode>#<source uri>`. */
function storyUri(sourceUri, mode) {
  const name = path.basename(sourceUri.path, '.q');
  return vscode.Uri.from({
    scheme: SCHEME,
    path: `/${name} (${mode}).story`,
    query: mode,
    fragment: sourceUri.toString(),
  });
}
const sourceOf = (uri) => vscode.Uri.parse(uri.fragment);
const modeOf = (uri) => (uri.query === 'bottom-up' ? 'bottom-up' : 'top-down');

async function storyFor(sourceUri, mode) {
  const doc = await vscode.workspace.openTextDocument(sourceUri);
  return buildStory(doc.getText(), {
    mode,
    annotate: config().get('annotate', true),
    fileName: path.basename(sourceUri.path),
  });
}

class StoryProvider {
  constructor() {
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChange = this._onDidChange.event;
    /** @type {Map<string, ReturnType<typeof buildStory>>} */
    this.cache = new Map();
  }
  async provideTextDocumentContent(uri) {
    const story = await storyFor(sourceOf(uri), modeOf(uri));
    this.cache.set(uri.toString(), story);
    return story.text;
  }
  async get(uri) {
    if (!this.cache.has(uri.toString())) await this.provideTextDocumentContent(uri);
    return this.cache.get(uri.toString());
  }
  refreshFor(sourceUri) {
    const key = sourceUri.toString();
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme === SCHEME && doc.uri.fragment === key) this._onDidChange.fire(doc.uri);
    }
  }
  provideDocumentLinks(doc) {
    const story = this.cache.get(doc.uri.toString());
    if (!story) return [];
    const src = sourceOf(doc.uri);
    return story.links.map((l) => {
      const args = encodeURIComponent(JSON.stringify([src.toString(), l.from, l.to]));
      const link = new vscode.DocumentLink(
        new vscode.Range(l.line, l.start, l.line, l.end),
        vscode.Uri.parse(`command:qStoryline.revealSource?${args}`),
      );
      link.tooltip = 'Show in source';
      return link;
    });
  }
}

async function revealSource(sourceUri, from, to = from) {
  const uri = typeof sourceUri === 'string' ? vscode.Uri.parse(sourceUri) : sourceUri;
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

const flashDecoration = vscode.window.createTextEditorDecorationType({
  backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
  isWholeLine: true,
});
function flash(editor, range) {
  editor.setDecorations(flashDecoration, [range]);
  setTimeout(() => editor.setDecorations(flashDecoration, []), 1200);
}

async function openStory(provider, sourceUri, mode, line) {
  const uri = storyUri(sourceUri, mode);
  const doc = await vscode.workspace.openTextDocument(uri);
  if (doc.languageId !== 'q-storyline') await vscode.languages.setTextDocumentLanguage(doc, 'q-storyline');
  const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
  if (line !== undefined && line !== null) {
    const range = new vscode.Range(line, 0, line, 0);
    editor.selection = new vscode.Selection(range.start, range.start);
    editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
    const story = await provider.get(uri);
    const id = story.blockAt[line];
    if (id !== null && id !== undefined) {
      const first = story.blockAt.indexOf(id);
      const last = story.blockAt.lastIndexOf(id);
      flash(editor, new vscode.Range(first, 0, last, 0));
    }
  }
  return editor;
}

/** Explorer tree: sections, then blocks nested under the block they are a helper of. */
class OutlineProvider {
  constructor() {
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChange.event;
    this.story = null;
    this.sourceUri = null;
  }
  async update(editor) {
    let doc = editor && editor.document;
    if (doc && doc.uri.scheme === SCHEME) doc = await vscode.workspace.openTextDocument(sourceOf(doc.uri));
    if (!isQ(doc)) return; // keep showing the last q file
    this.sourceUri = doc.uri;
    this.story = buildStory(doc.getText(), { mode: config().get('defaultMode', 'top-down') });
    this._onDidChange.fire();
  }
  getChildren(node) {
    if (!this.story) return [];
    if (!node) return this.story.sections.map((s, i) => ({ type: 'section', section: s, index: i }));
    return node.section.items
      .filter((it) => (node.type === 'section' ? it.depth === 0 : it.parent === node.item.id))
      .map((it) => ({ type: 'block', section: node.section, item: it }));
  }
  getTreeItem(node) {
    if (node.type === 'section') {
      const t = new vscode.TreeItem(`${node.index + 1} · ${node.section.title}`, vscode.TreeItemCollapsibleState.Expanded);
      t.tooltip = node.section.blurb;
      t.description = `${node.section.items.length}`;
      return t;
    }
    const b = this.story.blocks[node.item.id];
    const hasKids = node.section.items.some((it) => it.parent === b.id);
    const t = new vscode.TreeItem(
      b.label,
      hasKids ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    );
    t.description = `${b.role} · L${b.codeLine + 1}`;
    t.iconPath = new vscode.ThemeIcon(ICONS[b.role] || 'symbol-misc');
    const uses = b.uses.map((id) => this.story.blocks[id].label).join(', ');
    const usedBy = b.usedBy.map((id) => this.story.blocks[id].label).join(', ');
    t.tooltip = new vscode.MarkdownString(
      `**${b.label}** — ${b.role}${b.namespace ? ` in \`${b.namespace}\`` : ''}\n\n` +
      (uses ? `uses: ${uses}\n\n` : '') + (usedBy ? `used by: ${usedBy}` : ''),
    );
    t.command = {
      command: 'qStoryline.revealSource',
      title: 'Show in source',
      arguments: [this.sourceUri.toString(), b.startLine, b.endLine],
    };
    return t;
  }
}

function activate(context) {
  const provider = new StoryProvider();
  const outline = new OutlineProvider();
  const timers = new Map();

  const sourceEditor = async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;
    if (isQ(editor.document)) return editor;
    vscode.window.showInformationMessage('q Storyline: open a .q file first.');
    return null;
  };

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
    vscode.languages.registerDocumentLinkProvider({ scheme: SCHEME }, provider),
    vscode.window.registerTreeDataProvider('qStoryline.outline', outline),

    vscode.commands.registerCommand('qStoryline.open', async (uri) => {
      const target = uri instanceof vscode.Uri ? uri : (await sourceEditor())?.document.uri;
      if (target) await openStory(provider, target, config().get('defaultMode', 'top-down'));
    }),
    vscode.commands.registerCommand('qStoryline.openBottomUp', async () => {
      const editor = await sourceEditor();
      if (editor) await openStory(provider, editor.document.uri, 'bottom-up');
    }),
    vscode.commands.registerCommand('qStoryline.toggleMode', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.uri.scheme !== SCHEME) return;
      const uri = editor.document.uri;
      const other = modeOf(uri) === 'top-down' ? 'bottom-up' : 'top-down';
      // keep the reader on the same block across modes
      const story = await provider.get(uri);
      const src = story.lineMap[editor.selection.active.line];
      const next = await storyFor(sourceOf(uri), other);
      await openStory(provider, sourceOf(uri), other, src === null ? 0 : next.storyLineOf(src));
    }),
    vscode.commands.registerCommand('qStoryline.goToSource', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.uri.scheme !== SCHEME) return;
      const story = await provider.get(editor.document.uri);
      const line = editor.selection.active.line;
      let src = story.lineMap[line];
      for (let i = line; src === null && i < story.lineMap.length; i++) src = story.lineMap[i];
      if (src !== null && src !== undefined) await revealSource(sourceOf(editor.document.uri), src);
    }),
    vscode.commands.registerCommand('qStoryline.revealInStory', async () => {
      const editor = await sourceEditor();
      if (!editor) return;
      const mode = config().get('defaultMode', 'top-down');
      const story = await storyFor(editor.document.uri, mode);
      await openStory(provider, editor.document.uri, mode, story.storyLineOf(editor.selection.active.line));
    }),
    vscode.commands.registerCommand('qStoryline.revealSource', revealSource),
    vscode.commands.registerCommand('qStoryline.refreshOutline', () => outline.update(vscode.window.activeTextEditor)),

    vscode.window.onDidChangeActiveTextEditor((e) => outline.update(e)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!isQ(e.document)) return;
      const key = e.document.uri.toString();
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(() => {
        provider.refreshFor(e.document.uri);
        if (outline.sourceUri && outline.sourceUri.toString() === key) outline.update({ document: e.document });
      }, 300));
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('qStoryline')) return;
      for (const doc of vscode.workspace.textDocuments) {
        if (doc.uri.scheme === SCHEME) provider._onDidChange.fire(doc.uri);
      }
      outline.update(vscode.window.activeTextEditor);
    }),
    { dispose: () => timers.forEach(clearTimeout) },
  );

  outline.update(vscode.window.activeTextEditor);
}

function deactivate() {}

module.exports = { activate, deactivate };
