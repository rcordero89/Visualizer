import io
import json
import os
import sys
import traceback
import types

MAX_EVENTS = 25000
MAX_EVENTS_PER_CALL = 250
MAX_DEPTH = 6
MAX_ITEMS = 50
MAX_STR_LEN = 120
MAX_PREVIEW_LEN = 80

SKIP_TYPES = (
    types.ModuleType,
    types.FunctionType,
    types.BuiltinFunctionType,
    types.MethodType,
    type,
)


def truncate_str(s: str, limit: int = MAX_STR_LEN) -> str:
    if len(s) <= limit:
        return s
    return s[: limit - 3] + "..."


def make_preview(val) -> str:
    try:
        if val is None:
            return "None"
        if isinstance(val, bool):
            return "True" if val else "False"
        if isinstance(val, (int, float)):
            return repr(val)
        if isinstance(val, str):
            return truncate_str(repr(val), MAX_PREVIEW_LEN)
        if isinstance(val, list):
            if not val:
                return "[]"
            inner = ", ".join(make_preview(x) for x in val[:5])
            suffix = f", ... (+{len(val) - 5})" if len(val) > 5 else ""
            return truncate_str(f"[{inner}{suffix}]", MAX_PREVIEW_LEN)
        if isinstance(val, tuple):
            if not val:
                return "()"
            inner = ", ".join(make_preview(x) for x in val[:5])
            suffix = f", ... (+{len(val) - 5})" if len(val) > 5 else ""
            if len(val) == 1:
                return f"({inner},)"
            return truncate_str(f"({inner}{suffix})", MAX_PREVIEW_LEN)
        if isinstance(val, set):
            if not val:
                return "set()"
            items = list(val)[:5]
            inner = ", ".join(make_preview(x) for x in items)
            suffix = f", ... (+{len(val) - 5})" if len(val) > 5 else ""
            return truncate_str(f"{{{inner}{suffix}}}", MAX_PREVIEW_LEN)
        if isinstance(val, dict):
            if not val:
                return "{}"
            items = list(val.items())[:4]
            inner = ", ".join(f"{make_preview(k)}: {make_preview(v)}" for k, v in items)
            suffix = f", ... (+{len(val) - 4})" if len(val) > 4 else ""
            return truncate_str(f"{{{inner}{suffix}}}", MAX_PREVIEW_LEN)
        return truncate_str(repr(val), MAX_PREVIEW_LEN)
    except Exception:
        return "<unprintable>"


def serialize_value(val, depth: int = 0, seen: set | None = None) -> dict:
    if seen is None:
        seen = set()

    type_name = type(val).__name__

    if val is None:
        return {"kind": "null", "typeName": "NoneType", "preview": "None"}

    if isinstance(val, (bool, int, float, str)):
        return {
            "kind": "primitive",
            "typeName": type_name,
            "preview": make_preview(val),
        }

    obj_id = id(val)
    if obj_id in seen:
        return {
            "kind": "primitive",
            "typeName": type_name,
            "preview": "<circular ref>",
        }

    if depth >= MAX_DEPTH:
        return {
            "kind": "primitive",
            "typeName": type_name,
            "preview": make_preview(val),
            "truncated": True,
        }

    seen_next = seen | {obj_id}

    if isinstance(val, (list, tuple, set)):
        kind = "list" if isinstance(val, list) else ("tuple" if isinstance(val, tuple) else "set")
        items = list(val)
        entries = []
        for idx, item in enumerate(items[:MAX_ITEMS]):
            access = f"[{idx}]" if kind != "set" else f"list({{var}})[{idx}]"
            entries.append(
                {
                    "key": str(idx),
                    "keyType": "int",
                    "accessExpr": access if kind != "set" else f"[{idx}]",
                    "value": serialize_value(item, depth + 1, seen_next),
                }
            )
        return {
            "kind": kind,
            "typeName": type_name,
            "preview": make_preview(val),
            "length": len(items),
            "entries": entries,
            "truncated": len(items) > MAX_ITEMS,
        }

    if isinstance(val, dict):
        entries = []
        items = list(val.items())
        for k, v in items[:MAX_ITEMS]:
            key_repr = repr(k)
            entries.append(
                {
                    "key": str(k),
                    "keyType": type(k).__name__,
                    "accessExpr": f"[{key_repr}]",
                    "value": serialize_value(v, depth + 1, seen_next),
                }
            )
        return {
            "kind": "dict",
            "typeName": "dict",
            "preview": make_preview(val),
            "length": len(items),
            "entries": entries,
            "truncated": len(items) > MAX_ITEMS,
        }

    if hasattr(val, "__dict__"):
        attrs = [(k, v) for k, v in vars(val).items() if not k.startswith("__")]
        entries = []
        for k, v in attrs[:MAX_ITEMS]:
            entries.append(
                {
                    "key": k,
                    "keyType": "attr",
                    "accessExpr": f".{k}",
                    "value": serialize_value(v, depth + 1, seen_next),
                }
            )
        return {
            "kind": "object",
            "typeName": type_name,
            "preview": make_preview(val),
            "length": len(attrs),
            "entries": entries,
            "truncated": len(attrs) > MAX_ITEMS,
        }

    return {
        "kind": "primitive",
        "typeName": type_name,
        "preview": make_preview(val),
    }


def filter_locals(frame_locals: dict) -> tuple[dict, dict]:
    result = {}
    raw_vars = {}
    elem_id_to_ref = {}

    for k, v in frame_locals.items():
        if k.startswith("__") and k.endswith("__"):
            continue
        if isinstance(v, SKIP_TYPES):
            continue
        result[k] = serialize_value(v)
        raw_vars[k] = v

        if isinstance(v, (list, tuple)):
            for idx, item in enumerate(v[:MAX_ITEMS]):
                if isinstance(item, (list, tuple, dict, set)) or hasattr(item, "__dict__"):
                    elem_id_to_ref.setdefault(id(item), f"{k}[{idx}]")
        elif isinstance(v, dict):
            for dk, dv in list(v.items())[:MAX_ITEMS]:
                if isinstance(dv, (list, tuple, dict, set)) or hasattr(dv, "__dict__"):
                    elem_id_to_ref.setdefault(id(dv), f"{k}[{repr(dk)}]")

    aliases = {}
    for k, v in raw_vars.items():
        ref = elem_id_to_ref.get(id(v))
        if ref and not ref.startswith(f"{k}["):
            aliases[k] = ref

    return result, aliases


def run_trace(code: str, target_file: str, cli_args: list[str] | None = None) -> dict:
    calls = []
    frame_stack = {}
    call_counter = 0
    event_count = 0
    truncated = False
    line_snapshots = {}
    line_run_counts = {}

    abs_target = os.path.abspath(target_file)
    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()

    def summarize_line(
        changed_names: list[str], locals_map: dict, aliases: dict, ret_val=None, printed: str = ""
    ) -> str:
        parts = []
        for name in changed_names[:3]:
            if name in locals_map:
                alias_tag = f" (= {aliases[name]})" if name in aliases else ""
                parts.append(f"{name}{alias_tag} = {locals_map[name]['preview']}")
        if len(changed_names) > 3:
            parts.append(f"+{len(changed_names) - 3} more")
        if printed:
            parts.append(f"print: {truncate_str(printed, MAX_PREVIEW_LEN)}")
        if ret_val is not None:
            parts.append(f"return {ret_val['preview']}")
        return " | ".join(parts)

    def tracer(frame, event, arg):
        nonlocal call_counter, event_count, truncated

        if event_count >= MAX_EVENTS:
            truncated = True
            return None

        if os.path.abspath(frame.f_code.co_filename) != abs_target:
            return None

        event_count += 1
        fid = id(frame)

        if event == "call":
            call_counter += 1
            code_obj = frame.f_code
            arg_count = code_obj.co_argcount + code_obj.co_kwonlyargcount
            arg_names = list(code_obj.co_varnames[:arg_count])
            args_serialized = {}
            for name in arg_names:
                if name in frame.f_locals:
                    args_serialized[name] = serialize_value(frame.f_locals[name])

            call_record = {
                "id": f"call_{call_counter}",
                "name": code_obj.co_name,
                "callLine": frame.f_lineno,
                "depth": len(frame_stack),
                "args": args_serialized,
                "locals": dict(args_serialized),
                "events": [],
            }
            calls.append(call_record)
            frame_stack[fid] = {
                "record": call_record,
                "prev_previews": {k: v["preview"] for k, v in args_serialized.items()},
                "pending_line": None,
                "stdout_pos": len(stdout_buf.getvalue()),
            }
            return tracer

        state = frame_stack.get(fid)
        if state is None:
            return tracer

        if event == "line":
            # Flush previous line's locals AFTER it executed
            if state["pending_line"] is not None:
                prev_line = state["pending_line"]
                cur_locals, aliases = filter_locals(frame.f_locals)
                prev_previews = state["prev_previews"]
                changed = [
                    k
                    for k, v in cur_locals.items()
                    if k not in prev_previews or prev_previews[k] != v["preview"]
                ]
                state["prev_previews"] = {k: v["preview"] for k, v in cur_locals.items()}
                state["record"]["locals"] = cur_locals
                if len(state["record"]["events"]) < MAX_EVENTS_PER_CALL:
                    state["record"]["events"].append(
                        {
                            "line": prev_line,
                            "locals": cur_locals,
                            "changed": changed,
                            "aliases": aliases,
                        }
                    )
                cur_out = stdout_buf.getvalue()
                printed = cur_out[state["stdout_pos"]:].strip().replace("\n", " ↵ ")
                summary = summarize_line(changed, cur_locals, aliases, None, printed)
                if summary:
                    lkey = str(prev_line)
                    line_run_counts[lkey] = line_run_counts.get(lkey, 0) + 1
                    cnt = line_run_counts[lkey]
                    display_summary = f"({cnt}x) {summary}" if cnt > 1 else summary
                    line_snapshots[lkey] = {
                        "line": prev_line,
                        "summary": display_summary,
                        "locals": cur_locals,
                        "changed": changed,
                        "aliases": aliases,
                        "callName": state["record"]["name"],
                        "runCount": cnt,
                    }
                elif str(prev_line) not in line_snapshots:
                    line_snapshots[str(prev_line)] = {
                        "line": prev_line,
                        "summary": summary,
                        "locals": cur_locals,
                        "changed": changed,
                        "aliases": aliases,
                        "callName": state["record"]["name"],
                        "runCount": 1,
                    }

            state["pending_line"] = frame.f_lineno
            state["stdout_pos"] = len(stdout_buf.getvalue())
            return tracer

        if event == "return":
            cur_locals, aliases = filter_locals(frame.f_locals)
            ret_serialized = serialize_value(arg) if arg is not None else None
            if state["pending_line"] is not None:
                prev_line = state["pending_line"]
                prev_previews = state["prev_previews"]
                changed = [
                    k
                    for k, v in cur_locals.items()
                    if k not in prev_previews or prev_previews[k] != v["preview"]
                ]
                if len(state["record"]["events"]) < MAX_EVENTS_PER_CALL:
                    state["record"]["events"].append(
                        {
                            "line": prev_line,
                            "locals": cur_locals,
                            "changed": changed,
                            "aliases": aliases,
                        }
                    )
                is_module = state["record"]["name"] == "<module>"
                cur_out = stdout_buf.getvalue()
                printed = cur_out[state["stdout_pos"]:].strip().replace("\n", " ↵ ")
                summary = summarize_line(
                    changed, cur_locals, aliases, None if is_module else ret_serialized, printed
                )
                snap = {
                    "line": prev_line,
                    "summary": summary,
                    "locals": cur_locals,
                    "changed": changed,
                    "aliases": aliases,
                    "callName": state["record"]["name"],
                }
                if not is_module and ret_serialized is not None:
                    snap["returnValue"] = ret_serialized
                if summary or str(prev_line) not in line_snapshots:
                    line_snapshots[str(prev_line)] = snap

            state["record"]["locals"] = cur_locals
            if state["record"]["name"] != "<module>":
                state["record"]["returnValue"] = (
                    ret_serialized
                    if ret_serialized is not None
                    else {"kind": "null", "typeName": "NoneType", "preview": "None"}
                )
            frame_stack.pop(fid, None)
            return None

        return tracer

    old_stdout, old_stderr, old_argv = sys.stdout, sys.stderr, sys.argv
    sys.stdout, sys.stderr = stdout_buf, stderr_buf
    sys.argv = [target_file] + (cli_args or [])

    error_info = None
    try:
        compiled = compile(code, abs_target, "exec")
        exec_globals = {"__name__": "__main__", "__file__": abs_target}
        sys.settrace(tracer)
        try:
            exec(compiled, exec_globals)
        finally:
            sys.settrace(None)
    except SystemExit as e:
        if e.code not in (None, 0):
            error_info = {
                "kind": "runtime",
                "message": f"Exited with code {e.code}",
            }
    except SyntaxError as e:
        error_info = {
            "kind": "syntax",
            "message": f"SyntaxError: {e.msg}",
            "line": e.lineno,
        }
    except Exception as e:
        tb = traceback.extract_tb(e.__traceback__)
        err_line = None
        for entry in reversed(tb):
            if os.path.abspath(entry.filename) == abs_target:
                err_line = entry.lineno
                break
        error_info = {
            "kind": "runtime",
            "message": f"{type(e).__name__}: {e}",
            "line": err_line,
        }
    finally:
        sys.stdout, sys.stderr, sys.argv = old_stdout, old_stderr, old_argv

    return {
        "language": "python",
        "fileName": target_file,
        "ok": error_info is None,
        "error": error_info,
        "stdout": stdout_buf.getvalue(),
        "stderr": stderr_buf.getvalue(),
        "calls": calls,
        "lineSnapshots": line_snapshots,
        "truncated": truncated,
    }


def main():
    raw = sys.stdin.read()
    payload = json.loads(raw)
    result = run_trace(payload["code"], payload["fileName"], payload.get("args", []))
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
