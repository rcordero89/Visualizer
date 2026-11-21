import io
import json
import os
import sys

from python_runner import MAX_EVENTS, serialize_value


def eval_at_line(code: str, target_file: str, target_line: int, expr: str, cli_args: list[str]) -> dict:
    abs_target = os.path.abspath(target_file)
    event_count = 0
    captured = {"done": False, "value": None, "error": None}

    def tracer(frame, event, arg):
        nonlocal event_count
        if captured["done"]:
            return None
        if event_count >= MAX_EVENTS:
            return None
        if os.path.abspath(frame.f_code.co_filename) != abs_target:
            return None
        event_count += 1

        if event == "line" and frame.f_lineno == target_line:
            try:
                val = eval(expr, frame.f_globals, frame.f_locals)
                if isinstance(val, range):
                    items = list(val)[:50]
                    captured["value"] = {
                        "kind": "list",
                        "typeName": "range",
                        "preview": f"{repr(val)} -> {repr(items[:6])}",
                        "length": len(val),
                        "entries": [
                            {
                                "key": str(idx),
                                "keyType": "int",
                                "accessExpr": f"[{idx}]",
                                "value": serialize_value(item),
                            }
                            for idx, item in enumerate(items)
                        ],
                        "truncated": len(val) > 50,
                    }
                else:
                    captured["value"] = serialize_value(val)
            except Exception as e:
                captured["error"] = f"{type(e).__name__}: {e}"
            captured["done"] = True
            return None

        return tracer

    old_stdout, old_stderr, old_argv = sys.stdout, sys.stderr, sys.argv
    sys.stdout, sys.stderr = io.StringIO(), io.StringIO()
    sys.argv = [target_file] + cli_args

    try:
        compiled = compile(code, abs_target, "exec")
        exec_globals = {"__name__": "__main__", "__file__": abs_target}
        sys.settrace(tracer)
        try:
            exec(compiled, exec_globals)
        finally:
            sys.settrace(None)
    except SystemExit:
        pass
    except Exception as e:
        if not captured["done"]:
            captured["error"] = f"{type(e).__name__}: {e}"
    finally:
        sys.stdout, sys.stderr, sys.argv = old_stdout, old_stderr, old_argv

    return {
        "ok": captured["value"] is not None,
        "value": captured["value"],
        "error": captured["error"],
    }


def main():
    raw = sys.stdin.read()
    payload = json.loads(raw)
    res = eval_at_line(
        payload["code"],
        payload["fileName"],
        int(payload["line"]),
        payload["expr"],
        payload.get("args", []),
    )
    sys.stdout.write(json.dumps(res))


if __name__ == "__main__":
    main()
