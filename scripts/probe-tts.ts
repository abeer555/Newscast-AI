import fs from "fs"; import path from "path";
for (const name of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), name);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}
async function main() {
  const { groq } = await import("../lib/groq");
  try {
    const res = await groq().audio.speech.create({ model: "canopylabs/orpheus-v1-english", voice: "autumn", input: "Budget probe.", response_format: "wav" });
    const buf = Buffer.from(await res.arrayBuffer());
    console.log("TTS OK", buf.length, "bytes");
  } catch (e) {
    console.log("TTS FAIL:", String(e).slice(0, 260));
  }
}
void main();
