import * as vscode from 'vscode';
import { NvtxRange, NvtxRangeManager } from '../services/NvtxRangeManager';

export class NvtxRangesProvider implements vscode.TreeDataProvider<NvtxRangeItem | FileItem | WorkspaceItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<NvtxRangeItem | FileItem | WorkspaceItem | undefined | null | void> = new vscode.EventEmitter<NvtxRangeItem | FileItem | WorkspaceItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<NvtxRangeItem | FileItem | WorkspaceItem | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor(private rangeManager: NvtxRangeManager) { }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: NvtxRangeItem | FileItem | WorkspaceItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: NvtxRangeItem | FileItem | WorkspaceItem): Promise<(NvtxRangeItem | FileItem | WorkspaceItem)[]> {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      vscode.window.showInformationMessage('No workspace found for NVTX ranges.');
      return [];
    }

    if (!element) {
      return [new WorkspaceItem(vscode.workspace.workspaceFolders[0].name, vscode.TreeItemCollapsibleState.Expanded)];
    }

    if (element instanceof WorkspaceItem) {
      const ranges = await this.rangeManager.readRanges();
      const filesWithRanges = new Map<string, NvtxRange[]>();
      ranges.forEach(range => {
        if (!filesWithRanges.has(range.filePath)) {
          filesWithRanges.set(range.filePath, []);
        }
        filesWithRanges.get(range.filePath)!.push(range);
      });

      return Array.from(filesWithRanges.entries()).map(([filePath, fileRanges]) => {
        const relativePath = vscode.workspace.asRelativePath(filePath, false);
        return new FileItem(relativePath, vscode.TreeItemCollapsibleState.Collapsed, filePath, fileRanges);
      });
    }

    if (element instanceof FileItem) {
      return element.ranges.map(range => new NvtxRangeItem(range));
    }

    return [];
  }
}

export class WorkspaceItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.tooltip = this.label;
    this.contextValue = 'workspaceItem';
  }
}

export class FileItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly absolutePath: string,
    public readonly ranges: NvtxRange[]
  ) {
    super(label, collapsibleState);
    this.tooltip = this.absolutePath;
    this.description = `${ranges.length} range(s)`;
    this.contextValue = 'fileItem';
    this.iconPath = vscode.ThemeIcon.File;
  }
}

export class NvtxRangeItem extends vscode.TreeItem {
  constructor(public readonly rangeData: NvtxRange) {
    super(rangeData.name, vscode.TreeItemCollapsibleState.None);
    this.id = rangeData.id;
    this.tooltip = `${rangeData.name} (${rangeData.filePath}:${rangeData.startLine}${rangeData.endLine !== undefined ? '-' + rangeData.endLine : ''})`;
    this.description = `L${rangeData.startLine}${rangeData.endLine !== undefined ? '-L' + rangeData.endLine : ''} (${rangeData.isEnabled ? "Enabled" : "Disabled"})`;
    this.contextValue = 'nvtxRangeItem';
    this.iconPath = rangeData.isEnabled ? new vscode.ThemeIcon('debug-breakpoint-log') : new vscode.ThemeIcon('debug-breakpoint-log-unverified');
  }
}