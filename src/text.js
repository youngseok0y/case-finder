export function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
