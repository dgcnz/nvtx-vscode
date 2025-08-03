# NVTX Range Manager

<p align="center">
  <img src="media/logo.png" width="200" alt="NVTX Range Manager Logo">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/release-v0.0.1-green" alt="Release"/>
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License"/>
</p>

<p align="center">
  <strong>Visual GPU profiling for Python developers</strong><br>
  Create NVIDIA NVTX ranges directly in VS Code, then profile with Nsight Systems without modifying source code.
</p>

<p align="center">
  <img src="media/demo.gif" alt="NVTX Range Manager Demo" width="800">
</p>


## Features

- **Visual Range Creation**: Select code and create NVTX ranges directly in VS Code
- **Persistent Workspace Storage**: Ranges are saved per project and can be toggled on/off
- **Clear Visual Indicators**: See exactly where your profiling ranges start and end
- **Non-Intrusive Workflow**: Profile without changing your source code
- **Standalone CLI Tool**: Run profiling from command line with `njkt`
- **PyTorch Integration**: Works seamlessly with CUDA NVTX and Nsight Systems

## Quick Start

1. **Install the VS Code extension** from the marketplace
2. **Install the CLI tool** for code transformation and execution on your script's workspace:
   ```bash
   # Using uv (recommended)
   uv add git+https://github.com/dgcnz/nvtx-vscode.git#subdirectory=py
   
   # Or using pip
   pip install git+https://github.com/dgcnz/nvtx-vscode.git#subdirectory=py
   ```
3. **Create profiling ranges**: Select Python code in VS Code and run "NVTX: Create Range from Selection"
4. **Execute with profiling**: Run, profile and dynamically inject nvtx ranges (preferrably with `uv run`):
   ```bash
   nsys profile uv run njkt your_script.py
   ```

## Requirements

- **Python 3.9+** with PyTorch (CUDA support required for GPU profiling)
- **NVIDIA Nsight Systems** for profiling execution
- **VS Code 1.87.0+** for the extension
- **`njkt` CLI tool** (installed separately via pip/uv)

## Structure

The project consists of two main components:

- **VS Code Extension** (`src/`): Provides the visual interface for creating and managing NVTX ranges
- **Python CLI Tool** (`py/`): Handles code transformation and execution with NVTX profiling
  - Install: `uv add git+https://github.com/dgcnz/nvtx-vscode.git#subdirectory=py`
  - Usage: `njkt script.py` (automatically reads `.vscode/nvtx_ranges.json`)

## CLI Usage

The `njkt` command-line tool transforms and executes your Python code with NVTX profiling:

```bash
# Basic execution with default ranges
njkt your_script.py

# Pass arguments to your script
njkt train.py --batch-size 32 --lr 0.001

# Use custom ranges file
njkt --ranges custom_ranges.json script.py

# Debug transformation (output transformed code)
njkt --transform-only --output transformed.py script.py

# Full profiling
nsys profile uv run njkt script.py
```