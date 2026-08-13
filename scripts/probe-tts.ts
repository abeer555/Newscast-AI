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
  const { kokoroTTS } = await import("../lib/kokoro");
  try {
    const start = Date.now();
    const buf = await kokoroTTS({ text: "Budget probe. Kokoro is online.", voice: "af_heart" });
    console.log(`TTS OK: ${buf.length} bytes generated in ${Date.now() - start}ms`);
  } catch (e) {
    console.log("TTS FAIL:", String(e).slice(0, 260));
  }
}
void main();
