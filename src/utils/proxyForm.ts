export function toProxyAuth(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return s;

  // если уже содержит @
  if (s.includes("@")) {
    const [leftPart = "", rightPart = ""] = s.split("@");

    // Проверяем какой формат: user:pass@host:port или host:port@user:pass
    // Если rightPart содержит точку или это IP - значит формат user:pass@host:port (правильный)
    if (rightPart.includes('.') || /^\d+\.\d+\.\d+\.\d+/.test(rightPart.split(':')[0])) {
      // Формат: user:pass@host:port - уже правильный
      const [user = "", pass = ""] = leftPart.split(":");
      return `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${rightPart}`;
    }

    // Иначе это формат host:port@user:pass - нужно перевернуть
    const hParts = leftPart.split(":");
    const last = hParts.length > 0 ? hParts[hParts.length - 1] || "" : "";
    if (/\d+$/.test(last)) {
      const host = hParts.length > 1 ? hParts.slice(0, -1).join(":") : "";
      const port = last || "";
      const [userRaw = "", passRaw = ""] = rightPart.split(":");
      const user = userRaw || "";
      const pass = passRaw || "";
      return `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
    }

    // fallback
    return s;
  }

  // форма host:port:user:pass
  const parts = s.split(":");
  if (parts.length >= 4) {
    const host = parts[0] || "";
    const port = parts[1] || "";
    const user = parts[2] || "";
    const pass = parts.slice(3).join(":") || "";
    return `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
  }

  // форма host:port (без логина/пароля)
  if (parts.length === 2) {
    const host = parts[0] || "";
    const port = parts[1] || "";
    return `${host}:${port}`;
  }

  return s;
}