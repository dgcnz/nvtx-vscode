import * as vscode from 'vscode';
import * as path from 'path';
import { NvtxRangeManager, NvtxRange } from './services/NvtxRangeManager';
import { NvtxDecorationManager } from './services/NvtxDecorationManager';
import { NvtxRangesProvider, NvtxRangeItem } from './views/NvtxTreeView';


let rangeManager: NvtxRangeManager;
let decorationManager: NvtxDecorationManager;
let nvtxRangesProvider: NvtxRangesProvider;

export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "nvtx-manager" is now active!');

  // Initialize services
  rangeManager = new NvtxRangeManager(context);
  decorationManager = new NvtxDecorationManager(rangeManager);
  nvtxRangesProvider = new NvtxRangesProvider(rangeManager);

  // Initialize tree data provider
  vscode.window.registerTreeDataProvider('nvtxRangesView', nvtxRangesProvider);

  // Register CodeLens provider
  const codeLensProvider = decorationManager.getCodeLensProvider();
  const codeLensProviderDisposable = vscode.languages.registerCodeLensProvider('python', codeLensProvider);
  context.subscriptions.push(codeLensProviderDisposable);

  // Initialize file watcher within range manager
  rangeManager.initializeFileWatcher(decorationManager, () => nvtxRangesProvider.refresh());

  // Register commands
  registerCommands(context);
}

function registerCommands(context: vscode.ExtensionContext) {
  // Basic commands
  vscode.commands.registerCommand('nvtx-manager.refreshRanges', () => nvtxRangesProvider.refresh());
  vscode.commands.registerCommand('nvtx-manager.toggleDecorations', () => decorationManager.toggleDecorations());

  // Range creation command
  const createRangeCommand = vscode.commands.registerCommand('nvtx-manager.createRangeFromSelection', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'python') {
      vscode.window.showErrorMessage('Please open a Python file and select code to create an NVTX range.');
      return;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
      vscode.window.showWarningMessage('No text selected. Please select a range of lines to create an NVTX range.');
      return;
    }

    const rangeName = await vscode.window.showInputBox({ prompt: 'Enter NVTX range name' });
    if (!rangeName) {
      return;
    }

    // Convert from VS Code's 0-indexed line numbers to 1-indexed storage
    const startLine = selection.start.line + 1;
    const endLine = selection.end.line + 1;

    if (startLine > endLine) {
      vscode.window.showErrorMessage('Start of selection cannot be after the end of selection.');
      return;
    }

    const newRange = rangeManager.createRange(
      rangeName,
      editor.document.uri.fsPath,
      startLine,
      endLine
    );

    await rangeManager.addRange(newRange);
    nvtxRangesProvider.refresh();
    vscode.window.showInformationMessage(`NVTX Range '${rangeName}' added for lines ${startLine}-${endLine}.`);
  });
  context.subscriptions.push(createRangeCommand);

  // Tree view commands
  vscode.commands.registerCommand('nvtx-manager.deleteRange', async (item: NvtxRangeItem) => {
    if (!item?.rangeData) {
      return;
    }

    const success = await rangeManager.deleteRange(item.rangeData.id);
    if (success) {
      nvtxRangesProvider.refresh();
      vscode.window.showInformationMessage(`Range '${item.rangeData.name}' deleted.`);
    }
  });

  vscode.commands.registerCommand('nvtx-manager.toggleEnableRange', async (item: NvtxRangeItem) => {
    if (!item?.rangeData) {
      return;
    }

    const success = await rangeManager.toggleRangeEnabled(item.rangeData.id);
    if (success) {
      nvtxRangesProvider.refresh();
      const range = (await rangeManager.readRanges()).find(r => r.id === item.rangeData.id);
      if (range) {
        vscode.window.showInformationMessage(`Range '${range.name}' ${range.isEnabled ? 'enabled' : 'disabled'}.`);
      }
    }
  });

  vscode.commands.registerCommand('nvtx-manager.editRangeName', async (item: NvtxRangeItem) => {
    if (!item?.rangeData) {
      return;
    }

    const newName = await vscode.window.showInputBox({
      prompt: "Enter new name for the range",
      value: item.rangeData.name
    });
    if (!newName) {
      return;
    }

    const success = await rangeManager.updateRange(item.rangeData.id, { name: newName });
    if (success) {
      nvtxRangesProvider.refresh();
      vscode.window.showInformationMessage(`Range name updated to '${newName}'.`);
    }
  });

  vscode.commands.registerCommand('nvtx-manager.navigateToRange', async (rangeData: NvtxRange | NvtxRangeItem) => {
    let targetRangeData: NvtxRange;
    if (rangeData instanceof NvtxRangeItem) {
      targetRangeData = rangeData.rangeData;
    } else {
      targetRangeData = rangeData;
    }

    if (!targetRangeData) {
      return;
    }

    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetRangeData.filePath));
      const editor = await vscode.window.showTextDocument(doc);

      // Convert from 1-indexed storage to 0-indexed for VS Code Position API
      const startPosition = new vscode.Position(targetRangeData.startLine - 1, 0);
      let endPosition = startPosition;

      if (targetRangeData.endLine !== undefined) {
        const endLineContent = editor.document.lineAt(targetRangeData.endLine - 1);
        endPosition = new vscode.Position(targetRangeData.endLine - 1, endLineContent.text.length);
      } else {
        const startLineContent = editor.document.lineAt(targetRangeData.startLine - 1);
        endPosition = new vscode.Position(targetRangeData.startLine - 1, startLineContent.text.length);
      }

      editor.selection = new vscode.Selection(startPosition, endPosition);
      editor.revealRange(new vscode.Range(startPosition, endPosition), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } catch (error) {
      vscode.window.showErrorMessage(`Could not open file: ${targetRangeData.filePath}. Error: ${error}`);
      console.error("Error navigating to range:", error);
    }
  });

}

export function deactivate() {
  decorationManager?.dispose();
  rangeManager?.dispose();
}