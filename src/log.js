import fs from "node:fs/promises";
import path from "node:path";
import { ROOT_DIR } from "../config.js";

const logsDir = path.join(ROOT_DIR, "logs");
const errorLog = path.join(logsDir, "error.log");
const validationLog = path.join(logsDir, "validation.log");

async function append(filePath, message) {
  await fs.mkdir(logsDir, { recursive: true });
  await fs.appendFile(filePath, `${new Date().toISOString()} ${message}\n`, "utf8");
}

export function logInfo(message) {
  console.log(`[case-finder] ${message}`);
}

export async function logError(message, error) {
  const detail = error instanceof Error ? `${error.message}\n${error.stack || ""}` : String(error || "");
  const safeMessage = `${message}${detail ? `: ${detail}` : ""}`;
  console.error(`[case-finder] ${safeMessage}`);
  try {
    await append(errorLog, safeMessage);
  } catch (writeError) {
    console.error(`[case-finder] error log write failed: ${writeError.message}`);
  }
}

export async function logValidation(query, caseNumber, reason) {
  const safe = (value) => String(value || "")
    .replace(/(?:LAW_OC|OC)\s*[=:]\s*[^\s&]+/gi, "OC=[REDACTED]")
    .replace(/\s+/g, " ")
    .slice(0, 500);
  const message = `질문=${safe(query)} 사건번호=${safe(caseNumber)} 사유=${safe(reason)}`;
  try {
    await append(validationLog, message);
  } catch (writeError) {
    console.error(`[case-finder] validation log write failed: ${writeError.message}`);
  }
}
