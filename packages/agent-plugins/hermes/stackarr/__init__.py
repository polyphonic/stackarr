"""Hermes plugin for Stackarr.

This plugin exposes a small native Hermes tool surface that delegates to
Stackarr's local stdio MCP server.  It intentionally does not expose shell or
Docker primitives; all actions go through Stackarr's typed/audited MCP tools.
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
from pathlib import Path
from shutil import which
from typing import Any, Dict, Iterable, Optional

from tools.registry import tool_error, tool_result

_PLUGIN_DIR = Path(__file__).resolve().parent
_LOCK = threading.Lock()
_TOOLS_CACHE: Optional[list[dict[str, Any]]] = None


def _load_command_config() -> dict[str, Any]:
    config_path = _PLUGIN_DIR / "stackarr-command.json"
    if config_path.exists():
        try:
            loaded = json.loads(config_path.read_text())
            if isinstance(loaded, dict):
                return loaded
        except Exception:
            pass

    repo_env = os.getenv("STACKARR_REPO") or os.getenv("STACKARR_REPO_ROOT")
    repo = Path(repo_env).expanduser() if repo_env else None
    return {
        "command": os.getenv("STACKARR_COMMAND") or "stackarr",
        "args": ["mcp", "serve"],
        "cwd": str(repo) if repo else None,
        "env": {"STACKARR_REPO_ROOT": str(repo)} if repo else {},
    }


def _command_config() -> dict[str, Any]:
    config = _load_command_config()
    command = str(config.get("command") or "stackarr")
    repo_env = os.getenv("STACKARR_REPO") or os.getenv("STACKARR_REPO_ROOT")
    if command == "stackarr" and which("stackarr") is None and repo_env:
        fallback = Path(repo_env).expanduser() / "bin" / "stackarr"
        if fallback.exists():
            command = str(fallback)
    return {**config, "command": command, "args": list(config.get("args") or ["mcp", "serve"])}


def _check_available() -> bool:
    config = _command_config()
    command = str(config.get("command") or "")
    return bool(command and (Path(command).exists() or which(command)))


def _jsonrpc(method: str, params: Optional[dict[str, Any]] = None, *, request_id: int = 2, timeout: int = 120) -> dict[str, Any]:
    """Call the Stackarr MCP server over stdio using a fresh process.

    A fresh process per tool call is slower than a long-lived client but makes
    the plugin robust inside Hermes' synchronous tool execution model and avoids
    leaking subprocesses across sessions.
    """
    config = _command_config()
    command = str(config.get("command") or "")
    args = [str(arg) for arg in config.get("args", ["mcp", "serve"])]
    cwd = str(config.get("cwd") or os.getcwd())
    raw_env = config.get("env")
    extra_env: dict[str, Any] = raw_env if isinstance(raw_env, dict) else {}
    if not _check_available():
        raise FileNotFoundError(
            f"Stackarr command not found: {command}. Run `stackarr plugins install hermes` from a Stackarr install, "
            "or set STACKARR_COMMAND to the Stackarr executable."
        )

    initialize = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "hermes-stackarr-plugin", "version": "0.1.0"},
        },
    }
    initialized = {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}
    request = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}}
    payload = "\n".join(json.dumps(msg) for msg in (initialize, initialized, request)) + "\n"

    proc = subprocess.Popen(
        [command, *args],
        cwd=cwd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env={**os.environ, **{str(k): str(v) for k, v in extra_env.items()}},
    )
    try:
        stdout, stderr = proc.communicate(payload, timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        stdout, stderr = proc.communicate(timeout=5)
        raise TimeoutError(f"Stackarr MCP call timed out after {timeout}s; stderr: {stderr[-800:]}")

    responses: list[dict[str, Any]] = []
    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            responses.append(parsed)

    wanted = [r for r in responses if r.get("id") == request_id]
    if not wanted:
        detail = stderr.strip() or stdout[-1000:]
        raise RuntimeError(f"No JSON-RPC response for {method}. {detail}")
    response = wanted[-1]
    if "error" in response:
        raise RuntimeError(json.dumps(response["error"], ensure_ascii=False))
    return response.get("result", {})


def _extract_content(result: dict[str, Any]) -> Any:
    content = result.get("content") if isinstance(result, dict) else None
    if not isinstance(content, list) or not content:
        return result
    first = content[0]
    if isinstance(first, dict) and first.get("type") == "text":
        text = first.get("text", "")
        try:
            return json.loads(text)
        except Exception:
            return text
    return content


def _call_tool(name: str, arguments: Optional[dict[str, Any]] = None, *, timeout: int = 120) -> Any:
    result = _jsonrpc("tools/call", {"name": name, "arguments": arguments or {}}, timeout=timeout)
    return _extract_content(result)


def _safe_call(name: str, arguments: Optional[dict[str, Any]] = None, *, timeout: int = 120) -> str:
    try:
        return tool_result(_call_tool(name, arguments, timeout=timeout))
    except Exception as exc:
        return tool_error(f"Stackarr MCP tool failed: {type(exc).__name__}: {exc}")


def _list_tools() -> list[dict[str, Any]]:
    global _TOOLS_CACHE
    with _LOCK:
        if _TOOLS_CACHE is None:
            result = _jsonrpc("tools/list", {}, request_id=2, timeout=120)
            tools = result.get("tools", []) if isinstance(result, dict) else []
            _TOOLS_CACHE = tools if isinstance(tools, list) else []
        return list(_TOOLS_CACHE)


def _tool_names() -> list[str]:
    return [str(t.get("name")) for t in _list_tools() if isinstance(t, dict) and t.get("name")]


def _handle_list_mcp_tools(args: Dict[str, Any], **_: Any) -> str:
    try:
        include_schema = bool(args.get("includeSchema", False))
        tools = _list_tools()
        if not include_schema:
            tools = [{"name": t.get("name"), "description": t.get("description", "")} for t in tools if isinstance(t, dict)]
        return tool_result({"count": len(tools), "tools": tools})
    except Exception as exc:
        return tool_error(f"Failed to list Stackarr MCP tools: {type(exc).__name__}: {exc}")


def _handle_mcp_call(args: Dict[str, Any], **_: Any) -> str:
    name = str(args.get("tool") or args.get("name") or "").strip()
    if not name:
        return tool_error("Missing required `tool` name.")
    if name not in _tool_names():
        return tool_error(f"Unknown Stackarr MCP tool: {name}")
    arguments = args.get("arguments") or {}
    if not isinstance(arguments, dict):
        return tool_error("`arguments` must be an object.")
    timeout = int(args.get("timeout") or 120)
    return _safe_call(name, arguments, timeout=timeout)


def _handle_status(args: Dict[str, Any], **_: Any) -> str:
    return _safe_call("stackarr_get_system_status", {}, timeout=int(args.get("timeout") or 120))


def _handle_setup_profile(args: Dict[str, Any], **_: Any) -> str:
    return _safe_call("stackarr_get_setup_profile", {}, timeout=int(args.get("timeout") or 120))


def _handle_setup_media_server(args: Dict[str, Any], **_: Any) -> str:
    payload = dict(args)
    payload.pop("timeout", None)
    # Stackarr's MCP action defaults to dryRun; preserve that safety default
    # unless the caller explicitly sets dryRun false plus confirmSetup true.
    return _safe_call("stackarr_setup_media_server", payload, timeout=int(args.get("timeout") or 300))


def _pre_llm_call(user_message: str = "", **_: Any) -> dict[str, str] | None:
    if not isinstance(user_message, str) or "stackarr" not in user_message.lower():
        return None
    return {
        "context": (
            "Stackarr plugin available: use `stackarr_get_status`, `stackarr_get_setup_profile`, "
            "`stackarr_setup_media_server` (dry-run by default), `stackarr_list_mcp_tools`, or "
            "`stackarr_mcp_call` for typed Stackarr MCP actions. Dangerous Stackarr MCP actions "
            "require their explicit confirmation arguments. Do not use generic shell/Docker actions "
            "when a Stackarr MCP tool exists."
        )
    }


def _schema(name: str, description: str, properties: dict[str, Any], required: Optional[Iterable[str]] = None) -> dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": list(required or []),
        },
    }


def register(ctx) -> None:
    ctx.register_hook("pre_llm_call", _pre_llm_call)

    ctx.register_tool(
        name="stackarr_list_mcp_tools",
        toolset="stackarr",
        schema=_schema(
            "stackarr_list_mcp_tools",
            "List tools exposed by the local Stackarr MCP server.",
            {"includeSchema": {"type": "boolean", "description": "Include full input schemas."}},
        ),
        handler=_handle_list_mcp_tools,
        check_fn=_check_available,
        emoji="📚",
    )
    ctx.register_tool(
        name="stackarr_mcp_call",
        toolset="stackarr",
        schema=_schema(
            "stackarr_mcp_call",
            "Call any typed Stackarr MCP tool by name with JSON arguments.",
            {
                "tool": {"type": "string", "description": "Stackarr MCP tool name, e.g. stackarr_get_system_status."},
                "arguments": {"type": "object", "description": "Tool arguments object.", "additionalProperties": True},
                "timeout": {"type": "integer", "description": "Timeout in seconds.", "default": 120},
            },
            ["tool"],
        ),
        handler=_handle_mcp_call,
        check_fn=_check_available,
        emoji="🧰",
    )
    ctx.register_tool(
        name="stackarr_get_status",
        toolset="stackarr",
        schema=_schema("stackarr_get_status", "Get Stackarr system status via MCP.", {"timeout": {"type": "integer", "default": 120}}),
        handler=_handle_status,
        check_fn=_check_available,
        emoji="🟢",
    )
    ctx.register_tool(
        name="stackarr_get_setup_profile",
        toolset="stackarr",
        schema=_schema("stackarr_get_setup_profile", "Get Stackarr onboarding questions and defaults via MCP.", {"timeout": {"type": "integer", "default": 120}}),
        handler=_handle_setup_profile,
        check_fn=_check_available,
        emoji="🧭",
    )
    ctx.register_tool(
        name="stackarr_setup_media_server",
        toolset="stackarr",
        schema=_schema(
            "stackarr_setup_media_server",
            "Run Stackarr's opinionated setup workflow via MCP. Safe by default: dryRun remains true unless explicitly disabled with confirmSetup true.",
            {
                "torrentClient": {"type": "string", "enum": ["transmission", "qbittorrent"]},
                "mediaRoot": {"type": "string"},
                "downloadsRoot": {"type": "string"},
                "backupRoot": {"type": "string"},
                "enabledMediaTypes": {"type": "array", "items": {"type": "string", "enum": ["movies", "tv", "music"]}},
                "enableMovies": {"type": "boolean"},
                "enableTvShows": {"type": "boolean"},
                "enableLidarr": {"type": "boolean"},
                "enable4kServarr": {"type": "boolean"},
                "enableBazarr": {"type": "boolean"},
                "enableTinyMediaManager": {"type": "boolean"},
                "enableRecyclarr": {"type": "boolean"},
                "enableFlaresolverr": {"type": "boolean"},
                "enableTidarr": {"type": "boolean"},
                "enableSeerr": {"type": "boolean"},
                "enablePulsarr": {"type": "boolean"},
                "installStartup": {"type": "boolean"},
                "installBackup": {"type": "boolean"},
                "installUpdates": {"type": "boolean"},
                "agentPluginIntegrations": {"type": "array", "items": {"type": "string", "enum": ["hermes", "openclaw"]}},
                "dryRun": {"type": "boolean", "default": True},
                "confirmSetup": {"type": "boolean"},
                "timeout": {"type": "integer", "default": 300},
            },
        ),
        handler=_handle_setup_media_server,
        check_fn=_check_available,
        emoji="🚀",
    )
