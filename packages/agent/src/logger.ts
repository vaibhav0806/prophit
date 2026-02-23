function emit(level: string, msg: string, data?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
  };
  if (data !== undefined) {
    entry.data = data;
  }
  const line = JSON.stringify(entry, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const log = {
  info(msg: string, data?: Record<string, unknown>): void {
    emit("info", msg, data);
  },
  warn(msg: string, data?: Record<string, unknown>): void {
    emit("warn", msg, data);
  },
  error(msg: string, data?: Record<string, unknown>): void {
    emit("error", msg, data);
  },
};
