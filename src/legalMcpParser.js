const DETAIL_SECTIONS = ["판시사항", "판결요지", "결정요지", "재결주문", "재결요지", "참조조문", "참조판례", "이유", "전문"];

export function toolText(result) {
  return result?.content?.find((item) => item.type === "text")?.text || "";
}

export function decodeBasicHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/\r/g, "");
}

export function cleanText(value) {
  return decodeBasicHtml(value).trim();
}

function parseLabeledField(text, label) {
  const match = text.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*([^\\n]*)`, "m"));
  return cleanText(match?.[1] || "");
}

export function parseDecisionSearchResults(rawText) {
  const text = decodeBasicHtml(rawText);
  const lines = text.split("\n");
  const results = [];
  let current = null;

  for (const line of lines) {
    const hit = line.match(/^\s*(?:[-*]\s*)?\[(\d+)\]\s*(.*?)\s*$/);
    if (hit) {
      if (current) results.push(current);
      current = {
        id: hit[1],
        title: cleanText(hit[2]),
        caseNumber: "",
        court: "",
        date: "",
        type: "",
        link: "",
      };
      continue;
    }
    if (!current) continue;
    const field = line.match(/^\s*(사건번호|법원|선고일|종국일|종국일자|의결일|의결일자|사건종류|판결유형|링크)\s*:\s*(.*?)\s*$/);
    if (!field) continue;
    const keyMap = {
      사건번호: "caseNumber",
      법원: "court",
      선고일: "date",
      종국일: "date",
      종국일자: "date",
      의결일: "date",
      의결일자: "date",
      사건종류: "caseType",
      판결유형: "type",
      링크: "link",
    };
    current[keyMap[field[1]]] = cleanText(field[2]);
  }
  if (current) results.push(current);
  return results;
}

export function parseDecisionDetail(rawText) {
  const text = decodeBasicHtml(rawText);
  const sections = {};
  const sectionPattern = new RegExp(
    String.raw`(?:^|\n)\s*(${DETAIL_SECTIONS.join("|")})\s*:\s*([\s\S]*?)(?=\n\s*(?:${DETAIL_SECTIONS.join("|")})\s*:|$)`,
    "g",
  );
  for (const match of text.matchAll(sectionPattern)) {
    sections[match[1]] = cleanText(match[2]);
  }

  return {
    caseNumber: parseLabeledField(text, "사건번호"),
    court: parseLabeledField(text, "법원"),
    date: parseLabeledField(text, "선고일")
      || parseLabeledField(text, "종국일자")
      || parseLabeledField(text, "종국일")
      || parseLabeledField(text, "의결일자")
      || parseLabeledField(text, "의결일"),
    caseType: parseLabeledField(text, "사건종류"),
    type: parseLabeledField(text, "판결유형"),
    sections,
    rawText: text,
  };
}

export function parseLawSearchResults(rawText) {
  const text = decodeBasicHtml(rawText);
  const lines = text.split("\n");
  const results = [];
  let current = null;
  for (const line of lines) {
    const title = line.match(/^\s*(?:\d+\.\s*)?(?:[-*]\s*)?(.+?)\s+\[(?:현행|연혁)\]\s*$/);
    if (title) {
      if (current) results.push(current);
      current = { title: cleanText(title[1]), lawId: "", mst: "", link: "" };
      continue;
    }
    if (!current) continue;
    const mst = line.match(/^\s*[-*]?\s*MST\s*:\s*(\S+)/i);
    if (mst) current.mst = mst[1];
    const lawId = line.match(/^\s*-?\s*법령ID\s*:\s*(\S+)/);
    if (lawId) current.lawId = lawId[1];
    const link = line.match(/^\s*[-*]?\s*링크\s*:\s*(.*?)\s*$/);
    if (link) current.link = cleanText(link[1]);
  }
  if (current) results.push(current);
  return results;
}
