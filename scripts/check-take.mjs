#!/usr/bin/env node
/**
 * 出片后的台词回读校验（规则 R22，见 docs/rules-dialogue.md）
 *
 *   node scripts/check-take.mjs <transcript.json> "这台车一只手就能提起来，出门不求人。"
 *   node scripts/check-take.mjs <transcript.json> --expect-file script.txt
 *
 * transcript.json 由 `hypit transcribe <video> --language zh --to <file>` 生成（逐词带时间）。
 * 校验逻辑：去掉标点与空白后逐字比对；用「编辑距离 / 期望长度」算一致率，
 * 100% 才算过；否则打印第几个字开始不一致、漏字/多字/错字，供重跑决策。
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

function normalize(value) {
  return value
    .replace(/[\s\u3000]/g, "")
    .replace(/[，。、！？；：,.!?;:"'“”‘’()（）\[\]【】…—-]/g, "")
    .toLowerCase();
}

function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) table[i][0] = i;
  for (let j = 0; j < cols; j += 1) table[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      table[i][j] = Math.min(
        table[i - 1][j] + 1,
        table[i][j - 1] + 1,
        table[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return table[a.length][b.length];
}

/** hypit transcribe 的 JSON：hypit.transcript@1 用 passages[].words[]；另兼容常见结构 */
function transcriptText(json) {
  if (typeof json === "string") return json;
  if (Array.isArray(json?.passages)) {
    return json.passages
      .map((passage) => (Array.isArray(passage?.words)
        ? passage.words.map((item) => item.text ?? item.word ?? "").join("")
        : passage?.text ?? ""))
      .join("");
  }
  if (Array.isArray(json?.words)) return json.words.map((item) => item.word ?? item.text ?? "").join("");
  if (Array.isArray(json?.segments)) return json.segments.map((item) => item.text ?? "").join("");
  if (typeof json?.text === "string") return json.text;
  throw new Error("transcript JSON 结构不认识（期望 passages[] / words[] / segments[] / text）");
}

const [transcriptPath, ...rest] = process.argv.slice(2);
if (transcriptPath === undefined) {
  console.error('用法：node scripts/check-take.mjs <transcript.json> "<期望台词>" [--threshold 1.0] [--min-rate 4.5] [--pinyin]');
  process.exit(2);
}
const minRateIndex = rest.indexOf("--min-rate");
const minRate = minRateIndex === -1 ? 4.5 : Number(rest[minRateIndex + 1]);
const pinyinMode = rest.includes("--pinyin");
const optionNames = new Set(["--threshold", "--min-rate", "--pinyin", "--expect-file"]);
let expected = rest.find((item, index) => {
  if (optionNames.has(item)) return false;
  if (index > 0 && optionNames.has(rest[index - 1])) return false;
  return true;
});
if (rest.includes("--expect-file")) {
  const index = rest.indexOf("--expect-file");
  expected = readFileSync(rest[index + 1], "utf8");
}
if (expected === undefined) {
  console.error("缺少期望台词（第二个参数或 --expect-file <path>）");
  process.exit(2);
}
const thresholdIndex = rest.indexOf("--threshold");
const threshold = thresholdIndex === -1 ? 1 : Number(rest[thresholdIndex + 1]);

const json = JSON.parse(readFileSync(transcriptPath, "utf8"));
const heard = transcriptText(json);
const want = normalize(expected);
const got = normalize(heard);
const distance = levenshtein(want, got);
const similarity = want.length === 0 ? 0 : 1 - distance / want.length;

/** 同音容忍比对（--pinyin）：古诗词/生僻词常被 ASR 写成同音字，字面 100% 会假阳性 */
function pinyinSimilarity(a, b) {
  const script = [
    "import sys, json",
    "from pypinyin import lazy_pinyin",
    "a, b = sys.stdin.read().split('\\u0000')",
    "pa, pb = lazy_pinyin(a), lazy_pinyin(b)",
    "same = sum(1 for x, y in zip(pa, pb) if x == y)",
    "diff = [(i, x, y) for i, (x, y) in enumerate(zip(pa, pb)) if x != y]",
    "print(json.dumps({'same': same, 'total': max(len(pa), len(pb)), 'diff': diff}))",
  ].join("\n");
  try {
    const out = execFileSync("python", ["-c", script], {
      input: `${a}\u0000${b}`, encoding: "utf8",
    });
    return JSON.parse(out.trim());
  } catch (error) {
    console.error(`（pinyin 比对不可用：${error.message.split("\n")[0]}——先 pip install pypinyin）`);
    return undefined;
  }
}

/** 从逐词时间算净语速（字/秒）：字太少/时间太长都会露出来，正是 R29「语速偏慢」的量化指标 */
function speakingRate(value) {
  const words = Array.isArray(value?.passages)
    ? value.passages.flatMap((passage) => (Array.isArray(passage?.words) ? passage.words : []))
    : (Array.isArray(value?.words) ? value.words : []);
  const timed = words.filter((item) => typeof item?.start_seconds === "number" && typeof item?.end_seconds === "number");
  if (timed.length === 0) return undefined;
  const first = Math.min(...timed.map((item) => item.start_seconds));
  const last = Math.max(...timed.map((item) => item.end_seconds));
  const spoken = timed.filter((item) => /[\u3400-\u9fffA-Za-z0-9]/.test(item.text ?? item.word ?? "")).length;
  const span = last - first;
  return span <= 0 ? undefined : { chars: spoken, span, rate: spoken / span };
}

const rate = speakingRate(json);
if (rate !== undefined) {
  console.log(`语速：${rate.rate.toFixed(2)} 字/秒（${rate.chars} 字 / 净说词 ${rate.span.toFixed(2)}s；正常 4.5–5.5）`);
}

console.log(`期望：${want}`);
console.log(`听到：${got}`);
console.log(`一致率：${(similarity * 100).toFixed(1)}%（编辑距离 ${distance}，期望长度 ${want.length}）`);

// 同音容忍判定：字面不一致时，看是不是同音/近音字（古诗词、生僻词最常见的假阳性）
let pinyinOk = false;
if (pinyinMode || similarity < threshold) {
  const result = pinyinSimilarity(want, got);
  if (result) {
    const label = pinyinMode ? "同音比对" : "同音比对（字面未过，自动复核）";
    console.log(`${label}：${result.same}/${result.total} 音节一致`
      + (result.diff.length ? `；差异 ${JSON.stringify(result.diff)}` : "；全同音"));
    pinyinOk = result.diff.length === 0 || result.same / result.total >= 0.97;
    if (result.diff.length > 0 && !pinyinOk) {
      console.log(`  差异音节：${result.diff.map(([, x, y]) => `${x}→${y}`).join("，")}`);
    }
  }
}

const rateOk = rate === undefined || rate.rate >= minRate;
if (rate !== undefined && !rateOk) {
  console.log(`⚠️ 语速偏慢（< ${minRate} 字/秒）→ 按 R29 补语速描述、把台词补到槽位预算的 80% 以上，或缩短该镜`);
}
if ((similarity >= threshold || (pinyinMode && pinyinOk)) && rateOk) {
  console.log(pinyinMode && similarity < threshold
    ? "✓ 通过（R22：字面差在同音/近音范围内，音准成立）"
    : "✓ 通过（R22 + 语速）");
  process.exitCode = 0;
} else if (similarity < threshold) {
  let firstDiff = 0;
  while (firstDiff < want.length && want[firstDiff] === got[firstDiff]) firstDiff += 1;
  console.log(`✗ 不通过：第 ${firstDiff + 1} 个字开始不一致（期望「${want[firstDiff] ?? "结束"}」/ 听到「${got[firstDiff] ?? "无"}」）`);
  console.log("  → 按 R22 重跑该条；若只是标点差异可人工确认后放行");
  process.exitCode = 1;
} else {
  console.log("✗ 不通过：台词对了但语速偏慢（见上）");
  process.exitCode = 1;
}
