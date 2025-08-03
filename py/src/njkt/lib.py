#!/usr/bin/env python3
"""
Lightweight Python code transformer for injecting debug statements and context managers.
"""

import ast
import json
import logging
import sys
import runpy
import os
from pathlib import Path
from typing import Dict, List, Any, Optional
from dataclasses import dataclass
from contextlib import contextmanager

# Configure logging
log_level = getattr(
    logging, os.environ.get("TRANSFORM_LOG_LEVEL", "INFO").upper(), logging.INFO
)
logging.basicConfig(level=log_level, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Constants
DEFAULT_POST_INJECTION = True
DEFAULT_CONTEXT_ENABLED = True


@dataclass
class Event:
    line: int
    expr: str  # Python expression to execute
    post: bool = DEFAULT_POST_INJECTION

    def __post_init__(self):
        if self.line <= 0:
            raise ValueError(f"Line number must be positive, got {self.line}")
        if not self.expr.strip():
            raise ValueError("Expression cannot be empty")


@dataclass
class ContextRange:
    start_line: int
    end_line: int
    context: str
    enabled: bool = DEFAULT_CONTEXT_ENABLED

    def __post_init__(self):
        if self.start_line <= 0 or self.end_line <= 0:
            raise ValueError("Line numbers must be positive")
        if self.start_line > self.end_line:
            raise ValueError(
                f"Start line ({self.start_line}) cannot be greater than end line ({self.end_line})"
            )
        if not self.context.strip():
            raise ValueError("Context expression cannot be empty")


class CodeTransformer(ast.NodeTransformer):
    """Handles both event injection and context manager wrapping."""

    def __init__(self, events: List[Event], ranges: List[ContextRange]):
        self.events = {e.line: e for e in events}
        self.ranges = sorted(
            [r for r in ranges if r.enabled], key=lambda r: r.start_line
        )
        self.applied_ranges = set()

    def visit_Module(self, node: ast.Module) -> ast.Module:
        node.body = self._process_body(node.body)
        return self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> ast.FunctionDef:
        logger.debug(
            f"Processing function {node.name} with {len(node.body)} statements"
        )
        node.body = self._process_body(node.body)
        return self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> ast.ClassDef:
        node.body = self._process_body(node.body)
        return self.generic_visit(node)

    def visit_If(self, node: ast.If) -> ast.If:
        node.body = self._inject_events(node.body)
        if node.orelse:
            node.orelse = self._inject_events(node.orelse)
        return self.generic_visit(node)

    def visit_For(self, node: ast.For) -> ast.For:
        node.body = self._inject_events(node.body)
        if node.orelse:
            node.orelse = self._inject_events(node.orelse)
        return self.generic_visit(node)

    def visit_While(self, node: ast.While) -> ast.While:
        node.body = self._inject_events(node.body)
        if node.orelse:
            node.orelse = self._inject_events(node.orelse)
        return self.generic_visit(node)

    def visit_With(self, node: ast.With) -> ast.With:
        node.body = self._inject_events(node.body)
        return self.generic_visit(node)

    def _process_body(self, statements: List[ast.stmt]) -> List[ast.stmt]:
        """Common processing for statement bodies: wrap ranges then inject events."""
        statements = self._wrap_ranges(statements)
        return self._inject_events(statements)

    def _inject_events(self, statements: List[ast.stmt]) -> List[ast.stmt]:
        """Inject arbitrary expressions for events."""
        result = []
        for stmt in statements:
            if hasattr(stmt, "lineno") and stmt.lineno in self.events:
                event = self.events[stmt.lineno]
                logger.debug(f"Injecting event at line {stmt.lineno}: {event.expr}")

                try:
                    # Try parsing as an expression first (for simple cases like function calls)
                    try:
                        parsed = ast.parse(event.expr, mode="eval")
                        expr_stmt = ast.Expr(value=parsed.body)
                    except SyntaxError:
                        # If expression parsing fails, try as statement(s)
                        parsed = ast.parse(event.expr, mode="exec")
                        if len(parsed.body) == 1:
                            expr_stmt = parsed.body[0]
                        else:
                            # Multiple statements - we'll insert all of them
                            if event.post:
                                result.extend([stmt] + parsed.body)
                            else:
                                result.extend(parsed.body + [stmt])
                            continue
                except SyntaxError as e:
                    logger.error(
                        f"Invalid syntax in event at line {stmt.lineno}: {event.expr}"
                    )
                    logger.error(f"Syntax error: {e}")
                    # Skip this event if the expression is invalid
                    result.append(stmt)
                    continue

                if event.post:
                    result.extend([stmt, expr_stmt])
                else:
                    result.extend([expr_stmt, stmt])
            else:
                if hasattr(stmt, "lineno"):
                    logger.debug(f"No event for line {stmt.lineno}")
                result.append(stmt)
        return result

    def _wrap_ranges(self, statements: List[ast.stmt]) -> List[ast.stmt]:
        """Wrap statement ranges in context managers."""
        if not self.ranges:
            return statements

        result = []
        i = 0

        while i < len(statements):
            stmt = statements[i]
            stmt_line = getattr(stmt, "lineno", None)

            # Check if this statement starts a context manager range
            matching_range = next(
                (
                    r
                    for r in self.ranges
                    if stmt_line == r.start_line
                    and (r.start_line, r.end_line, r.context) not in self.applied_ranges
                ),
                None,
            )

            if matching_range:
                # Mark range as applied
                self.applied_ranges.add(
                    (
                        matching_range.start_line,
                        matching_range.end_line,
                        matching_range.context,
                    )
                )

                # Collect all statements in the range
                range_stmts = [
                    s
                    for s in statements[i:]
                    if hasattr(s, "lineno")
                    and matching_range.start_line <= s.lineno <= matching_range.end_line
                ]

                # Skip past all statements in this range
                i += len(
                    [
                        s
                        for s in statements[i:]
                        if hasattr(s, "lineno") and s.lineno <= matching_range.end_line
                    ]
                )

                try:
                    # Create with statement
                    context_expr = ast.parse(matching_range.context, mode="eval").body
                    with_stmt = ast.With(
                        items=[
                            ast.withitem(context_expr=context_expr, optional_vars=None)
                        ],
                        body=range_stmts,
                    )
                    result.append(with_stmt)
                except (SyntaxError, ValueError) as e:
                    logger.warning(
                        f"Failed to create context manager for '{matching_range.context}': {e}"
                    )
                    result.extend(range_stmts)
            else:
                # Regular statement, add as-is
                result.append(stmt)
                i += 1

        return result


def transform_and_execute(
    source_code: str,
    file_path: str,
    file_config: Dict[str, Any],
    execution_globals: Optional[Dict[str, Any]] = None,
) -> bool:
    """
    Transform source code and execute it. Returns True if successful, False if transformation failed.

    Args:
        source_code: The Python source code to transform
        file_path: Path to the file being transformed (for debugging and compilation)
        file_config: Configuration containing events and ranges
        execution_globals: Globals dict for execution (if None, creates a new module dict)
    """
    try:
        tree = ast.parse(source_code, filename=file_path)
        transformer = CodeTransformer(file_config["events"], file_config["ranges"])
        transformed = transformer.visit(tree)
        ast.fix_missing_locations(transformed)

        if logger.isEnabledFor(logging.DEBUG):
            logger.debug(f"Transformed {file_path}:")
            logger.debug("\n" + ast.unparse(transformed))

        code = compile(transformed, file_path, "exec")

        if execution_globals is not None:
            exec(code, execution_globals)
        else:
            # Create a new module-like namespace
            module_globals = {}
            exec(code, module_globals)

        return True

    except SyntaxError as e:
        logger.error(f"Syntax error in {file_path}: {e}")
        return False
    except (ValueError, TypeError) as e:
        logger.error(f"Configuration error for {file_path}: {e}")
        return False
    except Exception as e:
        logger.warning(f"Transform failed for {file_path}: {e}")
        return False


class SimpleImportHook:
    """Minimal import hook that transforms files with events."""

    def __init__(self, config):
        self.config = config

    @contextmanager
    def install(self):
        """Context manager to temporarily install the import hook."""
        from importlib.machinery import SourceFileLoader

        original_exec_module = SourceFileLoader.exec_module

        def patched_exec_module(self, module):
            file_path = str(Path(self.path).resolve())

            if file_path in hook.config:
                # Transform the file
                with open(self.path, "r") as f:
                    source = f.read()

                file_config = hook.config[file_path]
                if transform_and_execute(
                    source, self.path, file_config, module.__dict__
                ):
                    return
                else:
                    # Fall back to original execution without transformation
                    logger.info(f"Falling back to normal execution for {file_path}")
                    code = compile(source, self.path, "exec")
                    exec(code, module.__dict__)
                    return

            # Fall back to original behavior
            original_exec_module(self, module)

        hook = self
        SourceFileLoader.exec_module = patched_exec_module

        try:
            yield
        finally:
            SourceFileLoader.exec_module = original_exec_module


def transform_only(config: Dict[str, Any], script: Path) -> str:
    """
    Transform source code and return the transformed code as a string.
    
    Args:
        config: Configuration containing events and ranges
        script: Path to the script to transform
    
    Returns:
        Transformed source code as a string
    """
    script_path_resolved = str(script.resolve())
    
    # Read the source code
    with open(script) as f:
        source = f.read()
    
    # Check if we need to transform this script
    if script_path_resolved in config:
        file_config = config[script_path_resolved]
        
        try:
            tree = ast.parse(source, filename=str(script))
            transformer = CodeTransformer(file_config["events"], file_config["ranges"])
            transformed = transformer.visit(tree)
            ast.fix_missing_locations(transformed)
            
            # Return the transformed code as a string
            return ast.unparse(transformed)
            
        except (SyntaxError, ValueError, TypeError) as e:
            logger.error(f"Failed to transform {script}: {e}")
            # Return original code if transformation fails
            return source
    else:
        # No transformation needed, return original code
        return source


def run(config: Dict[str, Any], script: Path, script_args: List[str]):
    # Set up arguments for the script
    sys.argv = [str(script)] + script_args
    
    # Fix sys.path[0] to match script's directory for proper module resolution
    script_dir = str(script.parent.resolve())
    original_path_0 = sys.path[0]
    sys.path[0] = script_dir
    
    try:
        hook = SimpleImportHook(config)
        script_path_resolved = str(script.resolve())
        with hook.install():
            # Check if we need to transform the entry script
            if script_path_resolved in hook.config:
                # Transform and execute the entry script directly
                with open(script) as f:
                    source = f.read()

                logger.info(f"Transforming entry script: {script}")
                file_config = hook.config[script_path_resolved]
                script_globals = {"__name__": "__main__", "__file__": str(script)}

                if not transform_and_execute(
                    source, str(script), file_config, script_globals
                ):
                    # Fallback to normal execution if transformation failed
                    logger.info("Falling back to normal execution")
                    runpy.run_path(str(script), run_name="__main__")
            else:
                # No transformation needed, run normally
                runpy.run_path(str(script), run_name="__main__")
    finally:
        # Restore original sys.path[0]
        sys.path[0] = original_path_0