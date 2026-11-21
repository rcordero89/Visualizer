import ast
import builtins
import importlib
import inspect
import json
import sys


def resolve_object(symbol: str, code: str):
    # 1. Check builtins directly (e.g., round, sum, max, print, len)
    if hasattr(builtins, symbol):
        return getattr(builtins, symbol), f"builtins.{symbol}"

    # 2. Check dotted attribute like math.sqrt or list/dict/str method
    if "." in symbol:
        head, attr = symbol.split(".", 1)
        try:
            mod = importlib.import_module(head)
            if hasattr(mod, attr):
                return getattr(mod, attr), symbol
        except Exception:
            pass
        for typ in (list, dict, str, set, tuple):
            if hasattr(typ, attr):
                return getattr(typ, attr), f"{typ.__name__}.{attr}"

    # 3. Check imports in the user's code
    try:
        tree = ast.parse(code)
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    as_name = alias.asname or alias.name.split(".")[0]
                    if symbol.startswith(as_name + "."):
                        _, attr = symbol.split(".", 1)
                        mod = importlib.import_module(alias.name)
                        if hasattr(mod, attr):
                            return getattr(mod, attr), f"{alias.name}.{attr}"
            elif isinstance(node, ast.ImportFrom) and node.module:
                for alias in node.names:
                    as_name = alias.asname or alias.name
                    if as_name == symbol:
                        mod = importlib.import_module(node.module)
                        if hasattr(mod, alias.name):
                            return getattr(mod, alias.name), f"{node.module}.{alias.name}"
    except Exception:
        pass

    return None, symbol


def get_doc_info(symbol: str, code: str) -> dict:
    obj, qualname = resolve_object(symbol, code)
    if obj is None:
        return {"found": False}

    sig_str = ""
    try:
        sig_str = str(inspect.signature(obj))
    except Exception:
        sig_str = "(...)"

    doc = inspect.getdoc(obj) or ""
    lines = [l for l in doc.splitlines() if l.strip()]
    short_doc = "\n".join(lines[:8])
    if len(lines) > 8:
        short_doc += "\n..."

    return {
        "found": True,
        "name": qualname,
        "signature": f"{qualname}{sig_str}",
        "doc": short_doc,
    }


def main():
    raw = sys.stdin.read()
    payload = json.loads(raw)
    res = get_doc_info(payload["symbol"], payload.get("code", ""))
    sys.stdout.write(json.dumps(res))


if __name__ == "__main__":
    main()
