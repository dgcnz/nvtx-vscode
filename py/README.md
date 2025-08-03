# njkt - NVTX Code Transformation Tool

A standalone CLI tool for transforming Python code with NVTX profiling markers. This tool integrates with the NVTX Range Manager VS Code extension to provide GPU profiling capabilities using NVIDIA NVTX.

## Installation

### Development Installation Only

```bash
# Install directly with uv (recommended)
uv add git+https://github.com/dgcnz/nvtx-vscode.git#subdirectory=py

# Or install with pip
pip install git+https://github.com/dgcnz/nvtx-vscode.git#subdirectory=py
```


## Usage

### Basic Usage

Transform and run a Python script with NVTX profiling:

```bash
# Uses .vscode/nvtx_ranges.json by default
njkt script.py

# Or specify a custom ranges file
njkt --ranges custom_ranges.json script.py
```

### With Script Arguments

Pass arguments to your Python script:

```bash
njkt script.py --batch-size 32 --epochs 10
```

### Transform Only (Debugging)

Generate transformed code without running it:

```bash
njkt --transform-only --output transformed.py script.py
```

### With NVIDIA Nsight Systems

Use with nsys for actual profiling:

```bash
nsys profile njkt script.py
```

## Range Configuration Format

The ranges file (default: `.vscode/nvtx_ranges.json`) should contain NVTX ranges in VS Code extension format:

```json
[
  {
    "id": "1748605906948",
    "name": "forward_pass",
    "filePath": "/path/to/script.py",
    "type": "block", 
    "startLine": 10,
    "endLine": 15,
    "isEnabled": true
  },
  {
    "id": "1748605906949", 
    "name": "backward_pass",
    "filePath": "/path/to/script.py",
    "type": "block",
    "startLine": 20,
    "endLine": 25,
    "isEnabled": true
  }
]
```

## Integration with VS Code Extension

This CLI tool is designed to work with the NVTX Range Manager VS Code extension:

1. Use the VS Code extension to create and manage NVTX ranges visually
2. The extension saves ranges to `.vscode/nvtx_ranges.json`
3. Run the CLI tool: `njkt your_script.py` (automatically uses `.vscode/nvtx_ranges.json`)

## Requirements

- Python 3.9+
- PyTorch (install separately: `pip install torch` or `uv add torch`)
- NVIDIA CUDA-capable GPU (for actual profiling)
- NVIDIA Nsight Systems (for profiling visualization)

**Note**: PyTorch is not bundled with njkt. You need to install it in your environment so that it has access to your script's dependencies.

## How It Works

1. **Range Loading**: Reads NVTX range definitions from JSON file
2. **AST Transformation**: Uses Python's AST module to inject NVTX context managers
3. **Import Injection**: Automatically adds `import torch` to files with NVTX ranges
4. **Code Execution**: Runs the transformed code with proper NVTX markers

## Example Transformation

**Original Code:**
```python
def train_model():
    # Forward pass
    output = model(input_data)
    
    # Backward pass  
    loss = criterion(output, target)
    loss.backward()
```

**Transformed Code:**
```python
import torch

def train_model():
    # Forward pass
    with torch.cuda.nvtx.range('forward_pass'):
        output = model(input_data)
    
    # Backward pass
    with torch.cuda.nvtx.range('backward_pass'):
        loss = criterion(output, target)
        loss.backward()
```

## Environment Variables

- `TRANSFORM_LOG_LEVEL`: Set logging level (DEBUG, INFO, WARNING, ERROR)

```bash
TRANSFORM_LOG_LEVEL=DEBUG njkt script.py
```
