// Error diagnostics must never include credentials, request bodies or SQL parameters.
export function errorDiagnostic(error: unknown, secrets: string[] = []) {
  const clean = (value: string, stackFrame = false) => {
    let text = value;
    for (const secret of secrets)
      if (secret) text = text.split(secret).join("[redacted]");
    return text
      .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s"'<>]+/gi, (url) => {
        // PostHog needs script filenames and coordinates to resolve source maps.
        // Keep only frame locations; messages still redact every URL entirely.
        const location = stackFrame
          ? /^(https?:\/\/.+?)(:\d+:\d+)(\)*)$/i.exec(url)
          : null;
        if (!location) return "[url]";
        try {
          const source = new URL(location[1]);
          return `${source.origin}${source.pathname}${location[2]}${location[3]}`;
        } catch {
          return "[url]";
        }
      })
      .replace(/\b(?:Bearer|Basic)\s+\S+/gi, "[authorization]")
      .replace(/\b(?:db-|phx_|phc_)[A-Za-z0-9_-]+/g, "[token]")
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
      .replace(/\+\d[\d ()-]{8,}\d/g, "[phone]")
      .slice(0, 2000);
  };
  const diagnostic = (
    value: unknown,
  ): { name: string; message: string; stack: string } => {
    if (!(value instanceof Error))
      return { name: "UnknownError", message: "Non-Error thrown", stack: "" };
    return {
      name: value.name,
      message: value.message.startsWith("Failed query:")
        ? "Database query failed"
        : clean(value.message),
      stack: (value.stack ?? "")
        .split("\n")
        .filter(
          (line) =>
            /^\s+at /.test(line) ||
            /^(?:.*@)?https?:\/\/\S+:\d+:\d+$/.test(line),
        )
        .slice(0, 12)
        .map((line) => clean(line, true))
        .join("\n"),
    };
  };
  return {
    ...diagnostic(error),
    cause:
      error instanceof Error && error.cause
        ? diagnostic(error.cause)
        : undefined,
  };
}
