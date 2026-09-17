#!/usr/bin/env node
/**
 * 后期的「语速归一化」：把 H3 说得偏慢的镜头整体提速到目标语速。
 *
 * 原理：用 ASR 量出净说词时长 → 算出应有的加速倍数 → 音视频**同倍率**提速，
 * 这样口型与声音保持同步（只动 setpts/atempo，不做变形）。
 *
 * 用法：
 *   node scripts/retime.mjs <input.mp4> <transcript.json> <output.mp4> [--target 4.8]
 *   或直接给倍数：node scripts/retime.mjs in.mp4 1.15 out.mp4
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [input, transcriptOrFactor, output, ...rest] = process.argv.slice(2);
if (!input || !transcriptOrFactor || !output) {
  console.error("用法：node scripts/retime.mjs <input.mp4> <transcript.json|倍率> <output.mp4> [--target 4.8]");
  process.exit(2);
}
const targetIndex = rest.indexOf("--target");
const target = targetIndex === -1 ? 4.8 : Number(rest[targetIndex + 1]);

/** 从 hypit.transcript@1 算净说词时长与语速 */
function measure(value) {
  const words = Array.isArray(value?.passages)
    ? value.passages.flatMap((passage) => (Array.isArray(passage?.words) ? passage.words : []))
    : [];
  const timed = words.filter((item) => typeof item?.start_seconds === "number" && typeof item?.end_seconds === "number");
  const first = Math.min(...timed.map((item) => item.start_seconds));
  const last = Math.max(...timed.map((item) => item.end_seconds));
  const chars = timed.filter((item) => /[\u3400-\u9fffA-Za-z0-9]/.test(item.text ?? "")).length;
  return { chars, span: last - first, rate: chars / (last - first) };
}

let factor = Number(transcriptOrFactor);
if (!Number.isFinite(factor)) {
  const measured = measure(JSON.parse(readFileSync(transcriptOrFactor, "utf8")));
  factor = target / measured.rate;
  console.log(`实测 ${measured.rate.toFixed(2)} 字/秒（${measured.chars} 字 / ${measured.span.toFixed(2)}s）`
    + ` → 目标 ${target} 字/秒 → 提速 ${factor.toFixed(3)}×`);
}
if (!(factor > 1.001)) {
  console.log(`当前语速已达标（${factor.toFixed(3)}× ≤ 1），无需提速；如需减速用 atempo 小于 1 的链路。`);
  process.exit(0);
}
if (factor > 1.35) {
  console.error(`提速 ${factor.toFixed(2)}× 太激进（>1.35），动作会失真——请改写台词或拆镜，而不是硬提速。`);
  process.exit(1);
}

// 音视频同倍率：setpts 处理画面，atempo 处理声音（atempo 单次支持 0.5–2.0）
const filter = `[0:v]setpts=PTS/${factor.toFixed(6)}[v];[0:a]atempo=${factor.toFixed(6)}[a]`;
execFileSync("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-i", input,
  "-filter_complex", filter,
  "-map", "[v]", "-map", "[a]",
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "192k",
  "-movflags", "+faststart",
  output,
], { stdio: "inherit" });

console.log(`✓ 已输出 ${output}（提速 ${factor.toFixed(3)}×，音视频同步）`);
