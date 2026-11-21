#ifndef SCOPEVIZ_TRACE_H
#define SCOPEVIZ_TRACE_H

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef __cplusplus
#include <array>
#include <iostream>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace scopeviz {

inline int& event_counter() {
  static int cnt = 0;
  return cnt;
}

inline std::string json_escape(const std::string& s) {
  std::string out;
  out.reserve(s.size() + 8);
  for (unsigned char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char buf[8];
          snprintf(buf, sizeof(buf), "\\u%04x", c);
          out += buf;
        } else {
          out += static_cast<char>(c);
        }
    }
  }
  return out;
}

inline std::string truncate_str(const std::string& s, size_t limit = 80) {
  if (s.size() <= limit) return s;
  return s.substr(0, limit - 3) + "...";
}

// Type trait helpers
template <typename T, typename = void>
struct is_vector : std::false_type {};
template <typename T, typename A>
struct is_vector<std::vector<T, A>> : std::true_type {};

template <typename T>
struct is_std_array : std::false_type {};
template <typename T, std::size_t N>
struct is_std_array<std::array<T, N>> : std::true_type {};

template <typename T>
struct is_map_like : std::false_type {};
template <typename K, typename V, typename C, typename A>
struct is_map_like<std::map<K, V, C, A>> : std::true_type {};
template <typename K, typename V, typename H, typename E, typename A>
struct is_map_like<std::unordered_map<K, V, H, E, A>> : std::true_type {};

template <typename T>
struct is_set_like : std::false_type {};
template <typename K, typename C, typename A>
struct is_set_like<std::set<K, C, A>> : std::true_type {};
template <typename K, typename H, typename E, typename A>
struct is_set_like<std::unordered_set<K, H, E, A>> : std::true_type {};

template <typename T>
struct is_pair : std::false_type {};
template <typename A, typename B>
struct is_pair<std::pair<A, B>> : std::true_type {};

template <typename T>
std::string make_preview(const T& val, int depth = 0);

template <typename T>
std::string serialize_json(const T& val, int depth = 0);

template <typename T>
std::string type_label() {
  using D = std::decay_t<T>;
  if constexpr (std::is_same_v<D, bool>) return "bool";
  else if constexpr (std::is_same_v<D, char>) return "char";
  else if constexpr (std::is_same_v<D, int>) return "int";
  else if constexpr (std::is_same_v<D, long>) return "long";
  else if constexpr (std::is_same_v<D, long long>) return "long long";
  else if constexpr (std::is_same_v<D, unsigned int>) return "unsigned int";
  else if constexpr (std::is_same_v<D, float>) return "float";
  else if constexpr (std::is_same_v<D, double>) return "double";
  else if constexpr (std::is_same_v<D, std::string>) return "std::string";
  else if constexpr (std::is_same_v<D, const char*> || std::is_same_v<D, char*>) return "const char*";
  else if constexpr (is_vector<D>::value) return "std::vector";
  else if constexpr (is_std_array<D>::value) return "std::array";
  else if constexpr (is_map_like<D>::value) return "std::map";
  else if constexpr (is_set_like<D>::value) return "std::set";
  else if constexpr (is_pair<D>::value) return "std::pair";
  else return "value";
}

template <typename T>
std::string make_preview(const T& val, int depth) {
  using D = std::decay_t<T>;
  if (depth > 4) return "...";
  if constexpr (std::is_same_v<D, bool>) {
    return val ? "true" : "false";
  } else if constexpr (std::is_same_v<D, char>) {
    return std::string("'") + val + "'";
  } else if constexpr (std::is_arithmetic_v<D>) {
    std::ostringstream oss;
    oss << val;
    return oss.str();
  } else if constexpr (std::is_same_v<D, std::string>) {
    return truncate_str("\"" + val + "\"");
  } else if constexpr (std::is_same_v<D, const char*> || std::is_same_v<D, char*>) {
    if (!val) return "nullptr";
    return truncate_str(std::string("\"") + val + "\"");
  } else if constexpr (is_vector<D>::value || is_std_array<D>::value) {
    if (val.empty()) return "[]";
    std::string out = "[";
    size_t i = 0;
    for (const auto& item : val) {
      if (i > 0) out += ", ";
      if (i >= 5) {
        out += "... (+" + std::to_string(val.size() - 5) + ")";
        break;
      }
      out += make_preview(item, depth + 1);
      ++i;
    }
    out += "]";
    return truncate_str(out);
  } else if constexpr (is_map_like<D>::value) {
    if (val.empty()) return "{}";
    std::string out = "{";
    size_t i = 0;
    for (const auto& kv : val) {
      if (i > 0) out += ", ";
      if (i >= 4) {
        out += "... (+" + std::to_string(val.size() - 4) + ")";
        break;
      }
      out += make_preview(kv.first, depth + 1) + ": " + make_preview(kv.second, depth + 1);
      ++i;
    }
    out += "}";
    return truncate_str(out);
  } else if constexpr (is_set_like<D>::value) {
    if (val.empty()) return "{}";
    std::string out = "{";
    size_t i = 0;
    for (const auto& item : val) {
      if (i > 0) out += ", ";
      if (i >= 5) {
        out += "... (+" + std::to_string(val.size() - 5) + ")";
        break;
      }
      out += make_preview(item, depth + 1);
      ++i;
    }
    out += "}";
    return truncate_str(out);
  } else if constexpr (is_pair<D>::value) {
    return "(" + make_preview(val.first, depth + 1) + ", " + make_preview(val.second, depth + 1) + ")";
  } else {
    return "<object>";
  }
}

template <typename T>
std::string serialize_json(const T& val, int depth) {
  using D = std::decay_t<T>;
  std::string tname = type_label<D>();
  std::string prev = make_preview(val);

  if (depth >= 5) {
    return "{\"kind\":\"primitive\",\"typeName\":\"" + json_escape(tname) +
           "\",\"preview\":\"" + json_escape(prev) + "\",\"truncated\":true}";
  }

  if constexpr (std::is_same_v<D, bool> || std::is_same_v<D, char> ||
                std::is_arithmetic_v<D> || std::is_same_v<D, std::string> ||
                std::is_same_v<D, const char*> || std::is_same_v<D, char*>) {
    return "{\"kind\":\"primitive\",\"typeName\":\"" + json_escape(tname) +
           "\",\"preview\":\"" + json_escape(prev) + "\"}";
  } else if constexpr (is_vector<D>::value || is_std_array<D>::value) {
    std::string entries = "[";
    size_t idx = 0;
    bool trunc = val.size() > 50;
    for (const auto& item : val) {
      if (idx >= 50) break;
      if (idx > 0) entries += ",";
      std::string k = std::to_string(idx);
      entries += "{\"key\":\"" + k + "\",\"keyType\":\"size_t\",\"accessExpr\":\"[" + k +
                 "]\",\"value\":" + serialize_json(item, depth + 1) + "}";
      ++idx;
    }
    entries += "]";
    return "{\"kind\":\"list\",\"typeName\":\"" + json_escape(tname) +
           "\",\"preview\":\"" + json_escape(prev) + "\",\"length\":" +
           std::to_string(val.size()) + ",\"entries\":" + entries +
           (trunc ? ",\"truncated\":true" : "") + "}";
  } else if constexpr (is_map_like<D>::value) {
    std::string entries = "[";
    size_t idx = 0;
    bool trunc = val.size() > 50;
    for (const auto& kv : val) {
      if (idx >= 50) break;
      if (idx > 0) entries += ",";
      std::string kprev = make_preview(kv.first);
      entries += "{\"key\":\"" + json_escape(kprev) + "\",\"keyType\":\"" +
                 json_escape(type_label<decltype(kv.first)>()) +
                 "\",\"accessExpr\":\"" + json_escape("[" + kprev + "]") +
                 "\",\"value\":" + serialize_json(kv.second, depth + 1) + "}";
      ++idx;
    }
    entries += "]";
    return "{\"kind\":\"dict\",\"typeName\":\"" + json_escape(tname) +
           "\",\"preview\":\"" + json_escape(prev) + "\",\"length\":" +
           std::to_string(val.size()) + ",\"entries\":" + entries +
           (trunc ? ",\"truncated\":true" : "") + "}";
  } else if constexpr (is_set_like<D>::value) {
    std::string entries = "[";
    size_t idx = 0;
    bool trunc = val.size() > 50;
    for (const auto& item : val) {
      if (idx >= 50) break;
      if (idx > 0) entries += ",";
      std::string k = std::to_string(idx);
      entries += "{\"key\":\"" + k + "\",\"keyType\":\"item\",\"accessExpr\":\"[" + k +
                 "]\",\"value\":" + serialize_json(item, depth + 1) + "}";
      ++idx;
    }
    entries += "]";
    return "{\"kind\":\"set\",\"typeName\":\"" + json_escape(tname) +
           "\",\"preview\":\"" + json_escape(prev) + "\",\"length\":" +
           std::to_string(val.size()) + ",\"entries\":" + entries +
           (trunc ? ",\"truncated\":true" : "") + "}";
  } else if constexpr (is_pair<D>::value) {
    std::string entries =
        "[{\"key\":\"first\",\"keyType\":\"member\",\"accessExpr\":\".first\",\"value\":" +
        serialize_json(val.first, depth + 1) +
        "},{\"key\":\"second\",\"keyType\":\"member\",\"accessExpr\":\".second\",\"value\":" +
        serialize_json(val.second, depth + 1) + "}]";
    return "{\"kind\":\"tuple\",\"typeName\":\"std::pair\",\"preview\":\"" +
           json_escape(prev) + "\",\"length\":2,\"entries\":" + entries + "}";
  } else {
    return "{\"kind\":\"object\",\"typeName\":\"" + json_escape(tname) +
           "\",\"preview\":\"" + json_escape(prev) + "\"}";
  }
}

// Overload for C-style fixed arrays (excluding char arrays treated as strings)
template <typename T, std::size_t N>
std::string serialize_array_json(const T (&arr)[N], int depth = 0) {
  if constexpr (std::is_same_v<std::decay_t<T>, char>) {
    std::string s(arr);
    return serialize_json(s, depth);
  } else {
    std::string prev = "[";
    for (size_t i = 0; i < N && i < 5; ++i) {
      if (i > 0) prev += ", ";
      prev += make_preview(arr[i], depth + 1);
    }
    if (N > 5) prev += ", ... (+" + std::to_string(N - 5) + ")";
    prev += "]";
    std::string entries = "[";
    for (size_t i = 0; i < N && i < 50; ++i) {
      if (i > 0) entries += ",";
      std::string k = std::to_string(i);
      entries += "{\"key\":\"" + k + "\",\"keyType\":\"size_t\",\"accessExpr\":\"[" + k +
                 "]\",\"value\":" + serialize_json(arr[i], depth + 1) + "}";
    }
    entries += "]";
    return "{\"kind\":\"list\",\"typeName\":\"" + type_label<T>() + "[" + std::to_string(N) +
           "]\",\"preview\":\"" + json_escape(truncate_str(prev)) + "\",\"length\":" +
           std::to_string(N) + ",\"entries\":" + entries + "}";
  }
}

template <typename T>
inline void log_var(int line, const char* name, const T& val) {
  if (event_counter() >= 1500) return;
  ++event_counter();
  std::string val_json;
  if constexpr (std::is_array_v<T>) {
    val_json = serialize_array_json(val);
  } else {
    val_json = serialize_json(val);
  }
  fprintf(stderr, "__SCOPEVIZ_JSON__:{\"ev\":\"var\",\"line\":%d,\"name\":\"%s\",\"value\":%s}\n",
          line, json_escape(name).c_str(), val_json.c_str());
}

inline void log_call(int line, const char* fn) {
  if (event_counter() >= 1500) return;
  ++event_counter();
  fprintf(stderr, "__SCOPEVIZ_JSON__:{\"ev\":\"call\",\"line\":%d,\"name\":\"%s\"}\n",
          line, json_escape(fn).c_str());
}

inline void log_exit(int line, const char* fn) {
  if (event_counter() >= 1500) return;
  ++event_counter();
  fprintf(stderr, "__SCOPEVIZ_JSON__:{\"ev\":\"exit\",\"line\":%d,\"name\":\"%s\"}\n",
          line, json_escape(fn).c_str());
}

template <typename T>
inline T log_ret(int line, T val) {
  if (event_counter() < 1500) {
    ++event_counter();
    std::string val_json = serialize_json(val);
    fprintf(stderr, "__SCOPEVIZ_JSON__:{\"ev\":\"ret\",\"line\":%d,\"value\":%s}\n",
            line, val_json.c_str());
  }
  return val;
}

struct FnGuard {
  int line;
  const char* fn;
  FnGuard(int l, const char* f) : line(l), fn(f) { log_call(l, f); }
  ~FnGuard() { log_exit(line, fn); }
};

}  // namespace scopeviz

#define __VIZ_FN(line, fn) scopeviz::FnGuard __viz_guard_##line(line, fn)
#define __VIZ_VAR(line, name, val) scopeviz::log_var(line, name, val)
#define __VIZ_RET(line, expr) scopeviz::log_ret(line, expr)

inline int __viz_printf_impl(int line, const char* fmt, ...) {
  char buf[512];
  va_list args;
  va_start(args, fmt);
  int n = vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);
  fputs(buf, stdout);
  if (scopeviz::event_counter() < 1500) {
    ++scopeviz::event_counter();
    std::string s(buf);
    while (!s.empty() && (s.back() == '\n' || s.back() == '\r')) s.pop_back();
    fprintf(stderr, "__SCOPEVIZ_JSON__:{\"ev\":\"print\",\"line\":%d,\"text\":\"%s\"}\n",
            line, scopeviz::json_escape(s).c_str());
  }
  return n;
}
#define __VIZ_PRINTF(line, ...) __viz_printf_impl(line, __VA_ARGS__)

#else
// C11 fallback
static int __viz_ev_count = 0;

static inline void __viz_log_int(int line, const char* name, long long v) {
  if (__viz_ev_count++ >= 1500) return;
  fprintf(stderr, "__SCOPEVIZ_JSON__:{\"ev\":\"var\",\"line\":%d,\"name\":\"%s\",\"value\":{\"kind\":\"primitive\",\"typeName\":\"int\",\"preview\":\"%lld\"}}\n", line, name, v);
}
static inline void __viz_log_double(int line, const char* name, double v) {
  if (__viz_ev_count++ >= 1500) return;
  fprintf(stderr, "__SCOPEVIZ_JSON__:{\"ev\":\"var\",\"line\":%d,\"name\":\"%s\",\"value\":{\"kind\":\"primitive\",\"typeName\":\"double\",\"preview\":\"%g\"}}\n", line, name, v);
}
static inline void __viz_log_char(int line, const char* name, char v) {
  if (__viz_ev_count++ >= 1500) return;
  fprintf(stderr, "__SCOPEVIZ_JSON__:{\"ev\":\"var\",\"line\":%d,\"name\":\"%s\",\"value\":{\"kind\":\"primitive\",\"typeName\":\"char\",\"preview\":\"'%c'\"}}\n", line, name, v);
}
static inline void __viz_log_str(int line, const char* name, const char* v) {
  if (__viz_ev_count++ >= 1500) return;
  fprintf(stderr, "__SCOPEVIZ_JSON__:{\"ev\":\"var\",\"line\":%d,\"name\":\"%s\",\"value\":{\"kind\":\"primitive\",\"typeName\":\"char*\",\"preview\":\"\\\"%s\\\"\"}}\n", line, name, v ? v : "NULL");
}
static inline void __viz_log_ptr(int line, const char* name, const void* v) {
  if (__viz_ev_count++ >= 1500) return;
  fprintf(stderr, "__SCOPEVIZ_JSON__:{\"ev\":\"var\",\"line\":%d,\"name\":\"%s\",\"value\":{\"kind\":\"primitive\",\"typeName\":\"ptr\",\"preview\":\"%p\"}}\n", line, name, v);
}

#define __VIZ_VAR(line, name, val) _Generic((val), \
  int: __viz_log_int, \
  long: __viz_log_int, \
  long long: __viz_log_int, \
  unsigned int: __viz_log_int, \
  double: __viz_log_double, \
  float: __viz_log_double, \
  char: __viz_log_char, \
  char*: __viz_log_str, \
  const char*: __viz_log_str, \
  default: __viz_log_ptr)(line, name, val)

#define __VIZ_CALL(line, fn) do { if (__viz_ev_count++ < 1500) fprintf(stderr, "__SCOPEVIZ_JSON__:{\"ev\":\"call\",\"line\":%d,\"name\":\"%s\"}\n", line, fn); } while(0)

static inline int __viz_ret_int(int line, long long v) {
  if (__viz_ev_count++ < 1500)
    fprintf(stderr, "__SCOPEVIZ_JSON__:{\"ev\":\"ret\",\"line\":%d,\"value\":{\"kind\":\"primitive\",\"typeName\":\"int\",\"preview\":\"%lld\"}}\n", line, v);
  return (int)v;
}
static inline double __viz_ret_double(int line, double v) {
  if (__viz_ev_count++ < 1500)
    fprintf(stderr, "__SCOPEVIZ_JSON__:{\"ev\":\"ret\",\"line\":%d,\"value\":{\"kind\":\"primitive\",\"typeName\":\"double\",\"preview\":\"%g\"}}\n", line, v);
  return v;
}
static inline char __viz_ret_char(int line, char v) {
  if (__viz_ev_count++ < 1500)
    fprintf(stderr, "__SCOPEVIZ_JSON__:{\"ev\":\"ret\",\"line\":%d,\"value\":{\"kind\":\"primitive\",\"typeName\":\"char\",\"preview\":\"'%c'\"}}\n", line, v);
  return v;
}
static inline const char* __viz_ret_str(int line, const char* v) {
  if (__viz_ev_count++ < 1500)
    fprintf(stderr, "__SCOPEVIZ_JSON__:{\"ev\":\"ret\",\"line\":%d,\"value\":{\"kind\":\"primitive\",\"typeName\":\"char*\",\"preview\":\"\\\"%s\\\"\"}}\n", line, v ? v : "NULL");
  return v;
}
#define __VIZ_RET(line, expr) _Generic((expr), \
  int: __viz_ret_int, \
  long: __viz_ret_int, \
  long long: __viz_ret_int, \
  unsigned int: __viz_ret_int, \
  double: __viz_ret_double, \
  float: __viz_ret_double, \
  char: __viz_ret_char, \
  char*: __viz_ret_str, \
  const char*: __viz_ret_str, \
  default: __viz_ret_int)(line, expr)

static inline int __viz_printf_c(int line, const char* fmt, ...) {
  char buf[512];
  va_list args;
  va_start(args, fmt);
  int n = vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);
  fputs(buf, stdout);
  if (__viz_ev_count++ < 1500) {
    fprintf(stderr, "__SCOPEVIZ_JSON__:{\"ev\":\"print\",\"line\":%d,\"text\":\"", line);
    for (int i = 0; buf[i] != '\0'; ++i) {
      unsigned char c = (unsigned char)buf[i];
      if (c == '\n' || c == '\r') continue;
      if (c == '"' || c == '\\') fputc('\\', stderr);
      fputc(c, stderr);
    }
    fprintf(stderr, "\"}\n");
  }
  return n;
}
#define __VIZ_PRINTF(line, ...) __viz_printf_c(line, __VA_ARGS__)

#endif
#endif
