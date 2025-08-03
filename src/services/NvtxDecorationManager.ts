import * as vscode from 'vscode';
import { NvtxRange, NvtxRangeManager } from './NvtxRangeManager';

export class NvtxCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  constructor(
    private rangeManager: NvtxRangeManager,
    private decorationManager: NvtxDecorationManager
  ) { }

  public refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
    if (!this.decorationManager.areDecorationsVisible() || document.languageId !== 'python') {
      return [];
    }

    const ranges = await this.rangeManager.readRanges();
    const rangesInThisFile = ranges.filter(r => r.filePath === document.uri.fsPath && r.type === 'block');

    const codeLenses: vscode.CodeLens[] = [];

    rangesInThisFile.forEach(range => {
      // Convert from 1-indexed storage to 0-indexed for VS Code Position API
      const startLineIndex = range.startLine - 1;
      const position = new vscode.Position(startLineIndex, 0);
      const codeLensRange = new vscode.Range(position, position);

      const statusText = range.isEnabled ? '' : ' (disabled)';
      const codeLens = new vscode.CodeLens(codeLensRange, {
        title: `    ${range.name}${statusText}`,
        command: 'nvtx-manager.navigateToRange',
        arguments: [range]
      });

      codeLenses.push(codeLens);
    });

    return codeLenses;
  }
}

export class NvtxDecorationManager {
  private decorationsVisible = true;
  private rangeDecorationTypes = new Map<string, vscode.TextEditorDecorationType>();
  private codeLensProvider: NvtxCodeLensProvider;

  constructor(private rangeManager: NvtxRangeManager) {
    this.codeLensProvider = new NvtxCodeLensProvider(rangeManager, this);
  }

  getCodeLensProvider(): NvtxCodeLensProvider {
    return this.codeLensProvider;
  }

  areDecorationsVisible(): boolean {
    return this.decorationsVisible;
  }

  toggleDecorations(): void {
    this.decorationsVisible = !this.decorationsVisible;
    if (vscode.window.activeTextEditor) {
      this.updateDecorations();
    }
    this.codeLensProvider.refresh();
  }

  private getOrCreateRangeDecoration(isEnabled: boolean): vscode.TextEditorDecorationType {
    const key = `range-${isEnabled}`;

    if (!this.rangeDecorationTypes.has(key)) {
      const decoration = vscode.window.createTextEditorDecorationType({
        border: isEnabled ? '3px solid #00D4AA' : '3px solid #888888',
        borderWidth: '0 0 0 3px',
        backgroundColor: isEnabled ? 'rgba(0, 212, 170, 0.05)' : 'rgba(136, 136, 136, 0.05)',
        overviewRulerColor: isEnabled ? '#00D4AA' : '#888888',
        overviewRulerLane: vscode.OverviewRulerLane.Left,
      });
      this.rangeDecorationTypes.set(key, decoration);
    }

    return this.rangeDecorationTypes.get(key)!;
  }

  async updateDecorations(): Promise<void> {
    if (!vscode.window.activeTextEditor) {
      return;
    }

    const activeEditor = vscode.window.activeTextEditor;
    const currentFilePath = activeEditor.document.uri.fsPath;
    const ranges = await this.rangeManager.readRanges();
    const rangesInThisFile = ranges.filter(r => r.filePath === currentFilePath);

    // Clear all existing decorations first
    this.rangeDecorationTypes.forEach(decoration => {
      activeEditor.setDecorations(decoration, []);
    });

    // If decorations are hidden, don't apply any new ones
    if (!this.decorationsVisible) {
      return;
    }

    // Group ranges by decoration type to apply them together
    const decorationGroups = new Map<vscode.TextEditorDecorationType, Array<{ range: vscode.Range, hoverMessage: vscode.MarkdownString }>>();

    rangesInThisFile.forEach(range => {
      if (range.type === 'block') {
        // Convert from 1-indexed storage to 0-indexed for VS Code Position API
        const startLineIndex = range.startLine - 1;
        const endLineIndex = range.endLine ? range.endLine - 1 : startLineIndex;

        // Create decoration for the block span
        const startPosition = new vscode.Position(startLineIndex, 0);
        const endPosition = new vscode.Position(endLineIndex, activeEditor.document.lineAt(endLineIndex).text.length);
        const blockRange = new vscode.Range(startPosition, endPosition);

        const hoverMessage = new vscode.MarkdownString(`**NVTX Range: ${range.name}** (${range.isEnabled ? 'Enabled' : 'Disabled'})`);

        // Get the decoration type for the range border and background
        const rangeDecoration = this.getOrCreateRangeDecoration(range.isEnabled);

        // Group decorations by type
        if (!decorationGroups.has(rangeDecoration)) {
          decorationGroups.set(rangeDecoration, []);
        }
        decorationGroups.get(rangeDecoration)!.push({ range: blockRange, hoverMessage });
      }
    });

    // Apply all decorations grouped by type
    decorationGroups.forEach((decorationOptions, decorationType) => {
      activeEditor.setDecorations(decorationType, decorationOptions);
    });
  }

  dispose(): void {
    this.rangeDecorationTypes.forEach(decoration => decoration.dispose());
    this.rangeDecorationTypes.clear();
  }
}