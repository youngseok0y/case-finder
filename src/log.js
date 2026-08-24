import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const logsDir = config.runtimePaths.logsPath;
const errorLog = path.join(logsDir, "error.log");
const validationLog = path.join(logsDir, "validation.log");
const SECRET_LABEL_PATTERN = /((?:LAW_OC|OC|GEMINI_API_KEY|API[_ -]?KEY|AUTH(?:ORIZATION)?(?:[_ -]?TOKEN)?|ACCESS[_ -]?TOKEN|REFRESH[_ -]?TOKEN)\s*[=:]\s*)(["']?)([^"'`\s,;&}\]]+)/giu;

async function append(filePath, message) {
  await fs.mkdir(logsDir, { recursive: true });
  await fs.appendFile(filePath, `${new Date().toISOString()} ${message}\n`, "utf8");
}

export function sanitizeLogValue(value) {
  let text = String(value ?? "");
  for (const secret of [config.lawOc, config.geminiApiKey]) {
    if (typeof secret === "string" && secret) text = text.split(secret).join("[REDACTED]");
  }
  return text
    .replace(SECRET_LABEL_PATTERN, "$1[REDACTED]")
    .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [REDACTED]");
}

export function logInfo(message) {
  console.log(`[case-finder] ${message}`);
}

export async function logError(message, error) {
  const detail = error instanceof Error ? `${error.message}\n${error.stack || ""}` : String(error || "");
  const safeMessage = sanitizeLogValue(`${message}${detail ? `: ${detail}` : ""}`);
  console.error(`[case-finder] ${safeMessage}`);
  try {
    await append(errorLog, safeMessage);
  } catch (writeError) {
    console.error(`[case-finder] error log write failed: ${writeError.message}`);
  }
}

export async function logValidation(query, caseNumber, reason) {
  const safe = (value) => sanitizeLogValue(value)
    .replace(/\s+/g, " ")
    .slice(0, 500);
  const message = `질문=${safe(query)} 사건번호=${safe(caseNumber)} 사유=${safe(reason)}`;
  try {
    await append(validationLog, message);
  } catch (writeError) {
    console.error(`[case-finder] validation log write failed: ${writeError.message}`);
  }
}
