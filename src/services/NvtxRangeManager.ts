import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { NvtxDecorationManager } from './NvtxDecorationManager';

export interface NvtxRange {
  id: string;
  name: string;
  filePath: string;
  type: 'block' | 'event';
  startLine: number; // 1-indexed (to match Python AST and njkt expectations)
  endLine?: number;  // 1-indexed, only for "block"
  isEnabled: boolean;
}

const RANGES_FILE_NAME = 'nvtx_ranges.json';

export class NvtxRangeManager {
  private fileSystemWatcher?: vscode.FileSystemWatcher;
  private disposables: vscode.Disposable[] = [];
  private decorationManager?: NvtxDecorationManager;
  private onRangesChanged?: () => void;

  constructor(private context: vscode.ExtensionContext) { }

  getRangesFilePath(): string {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      throw new Error("Workspace not found. Please open a folder.");
    }
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    return path.join(workspacePath, '.vscode', RANGES_FILE_NAME);
  }

  async readRanges(): Promise<NvtxRange[]> {
    try {
      const filePath = this.getRangesFilePath();
      if (fs.existsSync(filePath)) {
        const fileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
        const contentString = Buffer.from(fileContent).toString('utf-8').trim();

        // Handle empty files
        if (contentString === '') {
          return [];
        }

        return JSON.parse(contentString) as NvtxRange[];
      }
    } catch (error) {
      console.error("Error reading NVTX ranges:", error);
      vscode.window.showErrorMessage(`Error reading NVTX ranges: ${error}`);
    }
    return [];
  }

  async writeRanges(ranges: NvtxRange[]): Promise<void> {
    try {
      const filePath = this.getRangesFilePath();
      const dirPath = path.dirname(filePath);

      if (!fs.existsSync(dirPath)) {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
      }
      const fileContent = Buffer.from(JSON.stringify(ranges, null, 2), 'utf-8');
      await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), fileContent);
    } catch (error) {
      console.error("Error writing NVTX ranges:", error);
      vscode.window.showErrorMessage(`Error writing NVTX ranges: ${error}`);
    }
  }

  async addRange(range: NvtxRange): Promise<void> {
    const ranges = await this.readRanges();
    ranges.push(range);
    await this.writeRanges(ranges);
  }

  async deleteRange(rangeId: string): Promise<boolean> {
    const ranges = await this.readRanges();
    const initialLength = ranges.length;
    const updatedRanges = ranges.filter(r => r.id !== rangeId);

    if (updatedRanges.length !== initialLength) {
      await this.writeRanges(updatedRanges);
      return true;
    }
    return false;
  }

  async updateRange(rangeId: string, updates: Partial<NvtxRange>): Promise<boolean> {
    const ranges = await this.readRanges();
    const targetRange = ranges.find(r => r.id === rangeId);

    if (targetRange) {
      Object.assign(targetRange, updates);
      await this.writeRanges(ranges);
      return true;
    }
    return false;
  }

  async toggleRangeEnabled(rangeId: string): Promise<boolean> {
    const ranges = await this.readRanges();
    const targetRange = ranges.find(r => r.id === rangeId);

    if (targetRange) {
      targetRange.isEnabled = !targetRange.isEnabled;
      await this.writeRanges(ranges);
      return true;
    }
    return false;
  }

  async getRangesForFile(filePath: string): Promise<NvtxRange[]> {
    const ranges = await this.readRanges();
    return ranges.filter(r => r.filePath === filePath);
  }

  async getEnabledRanges(): Promise<NvtxRange[]> {
    const ranges = await this.readRanges();
    return ranges.filter(r => r.isEnabled);
  }

  async getEnabledBlockRanges(): Promise<NvtxRange[]> {
    const ranges = await this.readRanges();
    return ranges.filter(r => r.isEnabled && r.type === 'block');
  }

  generateUniqueId(): string {
    return Date.now().toString();
  }

  createRange(
    name: string,
    filePath: string,
    startLine: number,
    endLine?: number,
    type: 'block' | 'event' = 'block',
    isEnabled: boolean = true
  ): NvtxRange {
    return {
      id: this.generateUniqueId(),
      name,
      filePath,
      type,
      startLine,
      endLine,
      isEnabled
    };
  }

  validateRange(range: NvtxRange): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!range.id) {
      errors.push('Range ID is required');
    }

    if (!range.name || range.name.trim() === '') {
      errors.push('Range name is required');
    }

    if (!range.filePath) {
      errors.push('File path is required');
    }

    if (range.startLine < 1) {
      errors.push('Start line must be >= 1');
    }

    if (range.type === 'block' && range.endLine !== undefined && range.endLine < range.startLine) {
      errors.push('End line must be >= start line');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  initializeFileWatcher(decorationManager: NvtxDecorationManager, onRangesChanged: () => void): void {
    this.decorationManager = decorationManager;
    this.onRangesChanged = onRangesChanged;

    // Watch for changes to the ranges file
    try {
      const rangesFilePath = this.getRangesFilePath();
      this.fileSystemWatcher = vscode.workspace.createFileSystemWatcher(rangesFilePath);

      this.fileSystemWatcher.onDidChange(() => this.handleRangesFileChanged());
      this.fileSystemWatcher.onDidCreate(() => this.handleRangesFileChanged());
      this.fileSystemWatcher.onDidDelete(() => this.handleRangesFileChanged());

      this.context.subscriptions.push(this.fileSystemWatcher);
    } catch (error) {
      console.warn('Could not create file system watcher for ranges file:', error);
    }

    // Watch for active text editor changes
    const activeEditorDisposable = vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor && this.decorationManager) {
        this.decorationManager.updateDecorations();
      }
    });
    this.disposables.push(activeEditorDisposable);
    this.context.subscriptions.push(activeEditorDisposable);

    // Watch for text document changes and adjust ranges accordingly
    const textChangeDisposable = vscode.workspace.onDidChangeTextDocument(async event => {
      await this.handleTextDocumentChange(event);
    });
    this.disposables.push(textChangeDisposable);
    this.context.subscriptions.push(textChangeDisposable);

    // Initial decoration update
    if (vscode.window.activeTextEditor && this.decorationManager) {
      this.decorationManager.updateDecorations();
    }
  }

  private handleRangesFileChanged(): void {
    if (this.onRangesChanged) {
      this.onRangesChanged();
    }
    if (this.decorationManager) {
      this.decorationManager.updateDecorations();
      const codeLensProvider = this.decorationManager.getCodeLensProvider();
      codeLensProvider.refresh();
    }
  }

  private async handleTextDocumentChange(event: vscode.TextDocumentChangeEvent): Promise<void> {
    if (!vscode.window.activeTextEditor || event.document !== vscode.window.activeTextEditor.document) {
      return;
    }

    const currentFilePath = event.document.uri.fsPath;
    let ranges = await this.readRanges();
    let rangesModified = false;

    for (const change of event.contentChanges) {
      const changeStartLine = change.range.start.line;
      const linesAdded = (change.text.match(/\n/g) || []).length;
      const linesRemoved = change.range.end.line - change.range.start.line;
      const netLineChange = linesAdded - linesRemoved;

      if (netLineChange === 0) {
        continue;
      }

      ranges = ranges.map(range => {
        if (range.filePath !== currentFilePath) {
          return range;
        }

        const rangeStart = range.startLine - 1;
        const rangeEnd = range.endLine ? range.endLine - 1 : rangeStart;
        let newRange = { ...range };

        const adjustment = this.calculateRangeAdjustment(
          changeStartLine,
          netLineChange,
          rangeStart,
          rangeEnd,
          change,
          event.document
        );

        if (adjustment.shouldModify) {
          newRange.startLine += adjustment.startLineDelta;
          if (newRange.endLine && adjustment.endLineDelta !== null) {
            newRange.endLine += adjustment.endLineDelta;
          }
          rangesModified = true;
        }

        return this.validateRangeBounds(newRange);
      });
    }

    if (rangesModified) {
      await this.writeRanges(ranges);
      if (this.onRangesChanged) {
        this.onRangesChanged();
      }
    }

    if (this.decorationManager) {
      this.decorationManager.updateDecorations();
    }
  }

  private calculateRangeAdjustment(
    changeStartLine: number,
    netLineChange: number,
    rangeStart: number,
    rangeEnd: number,
    change: vscode.TextDocumentContentChangeEvent,
    document: vscode.TextDocument
  ): { shouldModify: boolean; startLineDelta: number; endLineDelta: number | null } {
    // Case 1: Change is above range - shift entire range
    if (changeStartLine < rangeStart) {
      return {
        shouldModify: true,
        startLineDelta: netLineChange,
        endLineDelta: netLineChange
      };
    }

    // Case 2a: Change is exactly at range start
    if (changeStartLine === rangeStart) {
      return this.handleChangeAtRangeStart(change, document, changeStartLine, netLineChange);
    }

    // Case 2b: Change is inside range
    if (changeStartLine > rangeStart && changeStartLine < rangeEnd) {
      return {
        shouldModify: true,
        startLineDelta: 0,
        endLineDelta: netLineChange
      };
    }

    // Case 2c: Change is exactly at range end
    if (changeStartLine === rangeEnd) {
      return this.handleChangeAtRangeEnd(change, document, changeStartLine, netLineChange);
    }

    // Case 3: Change is below range - no adjustment needed
    return {
      shouldModify: false,
      startLineDelta: 0,
      endLineDelta: null
    };
  }

  private handleChangeAtRangeStart(
    change: vscode.TextDocumentContentChangeEvent,
    document: vscode.TextDocument,
    changeStartLine: number,
    netLineChange: number
  ): { shouldModify: boolean; startLineDelta: number; endLineDelta: number | null } {
    const insertionColumn = change.range.start.character;

    if (this.isInsertionBeforeContent(document, changeStartLine, insertionColumn)) {
      return {
        shouldModify: true,
        startLineDelta: netLineChange,
        endLineDelta: netLineChange
      };
    } else {
      return {
        shouldModify: true,
        startLineDelta: 0,
        endLineDelta: netLineChange
      };
    }
  }

  private handleChangeAtRangeEnd(
    change: vscode.TextDocumentContentChangeEvent,
    document: vscode.TextDocument,
    changeStartLine: number,
    netLineChange: number
  ): { shouldModify: boolean; startLineDelta: number; endLineDelta: number | null } {
    const insertionColumn = change.range.start.character;

    if (this.shouldExpandRangeAtEnd(change, document, changeStartLine, insertionColumn, netLineChange)) {
      return {
        shouldModify: true,
        startLineDelta: 0,
        endLineDelta: netLineChange
      };
    }

    return {
      shouldModify: false,
      startLineDelta: 0,
      endLineDelta: null
    };
  }

  private validateRangeBounds(range: NvtxRange): NvtxRange {
    const validatedRange = { ...range };

    if (validatedRange.startLine < 1) {
      validatedRange.startLine = 1;
    }
    if (validatedRange.endLine && validatedRange.endLine < validatedRange.startLine) {
      validatedRange.endLine = validatedRange.startLine;
    }

    return validatedRange;
  }

  private isInsertionBeforeContent(
    document: vscode.TextDocument,
    lineNumber: number,
    insertionColumn: number
  ): boolean {
    const lineText = document.lineAt(lineNumber).text;
    const firstNonWhitespace = lineText.search(/\S/);
    return firstNonWhitespace === -1 || insertionColumn <= firstNonWhitespace;
  }

  private isInsertionAfterContent(
    document: vscode.TextDocument,
    lineNumber: number,
    insertionColumn: number
  ): boolean {
    const lineText = document.lineAt(lineNumber).text;
    const lastNonWhitespace = lineText.trimEnd().length;
    return insertionColumn < lastNonWhitespace;
  }

  private shouldExpandRangeAtEnd(
    change: vscode.TextDocumentContentChangeEvent,
    document: vscode.TextDocument,
    changeStartLine: number,
    insertionColumn: number,
    netLineChange: number
  ): boolean {
    if (change.text.includes('\n') && netLineChange > 0) {
      return this.shouldExpandForNewlineInsertion(document, changeStartLine, insertionColumn);
    } else {
      return this.isInsertionAfterContent(document, changeStartLine, insertionColumn);
    }
  }

  private shouldExpandForNewlineInsertion(
    document: vscode.TextDocument,
    changeStartLine: number,
    insertionColumn: number
  ): boolean {
    const currentLineText = document.lineAt(changeStartLine).text;
    const nextLineExists = changeStartLine + 1 < document.lineCount;
    const nextLineText = nextLineExists ? document.lineAt(changeStartLine + 1).text : '';

    const nextLineHasContent = nextLineText.trim().length > 0;
    const currentLineHasContentAfterInsertion = insertionColumn < currentLineText.trimEnd().length;

    return nextLineHasContent || currentLineHasContentAfterInsertion;
  }

  dispose(): void {
    this.disposables.forEach(disposable => disposable.dispose());
    this.disposables = [];

    if (this.fileSystemWatcher) {
      this.fileSystemWatcher.dispose();
      this.fileSystemWatcher = undefined;
    }
  }
}