#!/usr/bin/env python3
"""
NVTX CLI Tool - Standalone tool for running Python scripts with NVTX profiling.

This tool takes VS Code NVTX range definitions and transforms Python scripts
to include NVTX markers for GPU profiling.
"""

import json
import argparse
import sys
import logging
from pathlib import Path
from typing import Dict, List, Any
from collections import defaultdict

from .lib import Event, ContextRange, run, transform_only

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def load_nvtx_ranges(ranges_file: Path) -> List[Dict[str, Any]]:
    """Load NVTX ranges from the VS Code extension JSON format."""
    try:
        with open(ranges_file, 'r') as f:
            ranges = json.load(f)
        logger.info(f"Loaded {len(ranges)} NVTX ranges from {ranges_file}")
        return ranges
    except (FileNotFoundError, json.JSONDecodeError) as e:
        logger.error(f"Failed to load NVTX ranges from {ranges_file}: {e}")
        raise


def create_njkt_config_from_nvtx_ranges(nvtx_ranges: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Create njkt-compatible configuration directly from NVTX ranges.
    This creates the internal config format that lib.run() expects.
    """
    config = {}
    
    # Group ranges by file path
    ranges_by_file = defaultdict(list)
    
    for nvtx_range in nvtx_ranges:
        if not nvtx_range.get('isEnabled', True):
            continue
            
        file_path = str(Path(nvtx_range['filePath']).resolve())
        range_name = nvtx_range['name']
        start_line = nvtx_range['startLine']
        end_line = nvtx_range['endLine']
        
        # Create NVTX context manager expression
        context_expr = f"torch.cuda.nvtx.range('{range_name}')"
        
        # Create ContextRange object
        context_range = ContextRange(
            start_line=start_line,
            end_line=end_line,
            context=context_expr,
            enabled=True
        )
        
        ranges_by_file[file_path].append(context_range)
    
    # Create config in the format expected by lib.run()
    for file_path, ranges in ranges_by_file.items():
        # Add import torch event for each file with NVTX ranges
        import_event = Event(
            line=1,
            expr="import torch",
            post=False  # Insert before line 1
        )
        
        config[file_path] = {
            "events": [import_event],
            "ranges": ranges
        }
    
    logger.info(f"Created njkt config with {sum(len(ranges) for ranges in ranges_by_file.values())} ranges across {len(ranges_by_file)} files")
    logger.info(f"Added 'import torch' statements to {len(ranges_by_file)} files")
    return config


def setup_parser() -> argparse.ArgumentParser:
    """Set up command line argument parser."""
    parser = argparse.ArgumentParser(
        description="NVTX code transformation tool for GPU profiling",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic usage (uses .vscode/nvtx_ranges.json by default)
  njkt script.py
  
  # With script arguments
  njkt script.py arg1 arg2
  
  # Custom ranges file
  njkt --ranges custom_ranges.json script.py
  
  # Transform only (for debugging)
  njkt --transform-only --output transformed.py script.py
  
  # With nsys profiling (run separately)
  nsys profile njkt script.py

The ranges file should contain NVTX ranges in VS Code extension format:
[
  {
    "id": "1748605906948",
    "name": "mul-add",
    "filePath": "/path/to/script.py", 
    "type": "block",
    "startLine": 5,
    "endLine": 7,
    "isEnabled": true
  }
]
        """,
    )

    parser.add_argument(
        "--transform-only", action="store_true",
        help="Only transform the code without running it"
    )
    parser.add_argument(
        "--output", type=Path,
        help="Output file path for transformed code (required with --transform-only)"
    )
    parser.add_argument(
        "--ranges", type=Path, default=Path(".vscode/nvtx_ranges.json"),
        help="Path to nvtx_ranges.json file (default: .vscode/nvtx_ranges.json)"
    )
    parser.add_argument(
        "script", type=Path, help="Python script to run with NVTX profiling"
    )
    parser.add_argument(
        "script_args", nargs="*", help="Arguments to pass to the script"
    )
    
    return parser


def main():
    """Main CLI entry point."""
    parser = setup_parser()
    args = parser.parse_args()

    # Validate transform-only mode requirements
    if args.transform_only and not args.output:
        logger.error("--output is required when using --transform-only")
        sys.exit(1)

    # Validate input files
    if not args.ranges.exists():
        if args.ranges == Path(".vscode/nvtx_ranges.json"):
            logger.error("No NVTX ranges found at .vscode/nvtx_ranges.json")
            logger.error("Create ranges using the VS Code NVTX Range Manager extension first, or specify a custom ranges file with --ranges")
        else:
            logger.error(f"NVTX ranges file not found: {args.ranges}")
        sys.exit(1)

    if not args.script.exists():
        logger.error(f"Script not found: {args.script}")
        sys.exit(1)

    try:
        # Load NVTX ranges from VS Code extension format
        nvtx_ranges = load_nvtx_ranges(args.ranges)
        
        # Convert to njkt configuration format
        njkt_config = create_njkt_config_from_nvtx_ranges(nvtx_ranges)
        
        if args.transform_only:
            # Transform only mode - output transformed code to file
            logger.info(f"Transforming {args.script} and saving to {args.output}...")
            transformed_code = transform_only(njkt_config, args.script)
            
            # Write transformed code to output file
            with open(args.output, 'w') as f:
                f.write(transformed_code)
            
            logger.info(f"Transformed code saved to {args.output}")
        else:
            # Check if torch is available for runtime execution
            try:
                import torch
            except ImportError:
                logger.error("PyTorch is required for runtime execution but not found. Please install PyTorch in your environment:")
                logger.error("  pip install torch")
                logger.error("  # or")
                logger.error("  uv add torch")
                sys.exit(1)
            
            # Run the script with NVTX profiling using njkt
            logger.info(f"Running {args.script} with NVTX profiling...")
            run(njkt_config, args.script, args.script_args)
        
    except Exception as e:
        logger.error(f"Failed to {'transform' if args.transform_only else 'run'} script: {e}")
        sys.exit(1)