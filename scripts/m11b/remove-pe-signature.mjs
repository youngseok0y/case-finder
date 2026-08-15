import fs from "node:fs/promises";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

async function main() {
  const file = argument("--file");
  if (!file || !file.toLowerCase().endsWith(".exe")) throw new Error("expected an explicit .exe --file");
  const data = await fs.readFile(file);
  if (data.length < 0x40 || data.toString("ascii", 0, 2) !== "MZ") throw new Error("not a PE/DOS executable");
  const peOffset = data.readUInt32LE(0x3c);
  if (data.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") throw new Error("PE signature missing");
  const optionalOffset = peOffset + 24;
  const magic = data.readUInt16LE(optionalOffset);
  const dataDirectoryOffset = optionalOffset + (magic === 0x20b ? 0x70 : 0x60);
  const certificateDirectoryOffset = dataDirectoryOffset + (4 * 8);
  const certificateOffset = data.readUInt32LE(certificateDirectoryOffset);
  const certificateSize = data.readUInt32LE(certificateDirectoryOffset + 4);
  if (!certificateOffset || !certificateSize) {
    console.log(JSON.stringify({ file, removed: false, reason: "no-authenticode-directory" }));
    return;
  }
  if (certificateOffset + certificateSize > data.length) throw new Error("invalid Authenticode directory bounds");
  data.writeUInt32LE(0, certificateDirectoryOffset);
  data.writeUInt32LE(0, certificateDirectoryOffset + 4);
  const withoutCertificate = certificateOffset + certificateSize === data.length
    ? data.subarray(0, certificateOffset)
    : data;
  await fs.writeFile(file, withoutCertificate);
  console.log(JSON.stringify({ file, removed: true, certificateOffset, certificateSize }));
}

await main();
