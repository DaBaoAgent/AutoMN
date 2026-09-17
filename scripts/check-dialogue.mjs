#!/usr/bin/env node
/**
 * H3 对白检查器 —— 规则见 docs/rules-dialogue.md
 *
 *   node scripts/check-dialogue.mjs sources/*.svml
 *   node scripts/check-dialogue.mjs prompt.txt          # 纯提示词文本也可以
 *
 * 规则分两级：ERROR 必须改完再 build（花钱前拦截），WARN 需人工确认。
 * 只做「花钱前」能静态判定的检查；生成后的听感/画面必须人工或 ASR 复核（规则 R22-R24）。
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const CANONICAL_LANGUAGES = new Set([
  "Chinese", "English", "Cantonese", "Japanese", "Korean", "Spanish", "French", "German",
  "Portuguese", "Dutch", "Italian", "Russian", "Arabic", "Hindi", "Turkish", "Polish", "Catalan",
]);
const SPEECH_HINTS = ["台词", "口播", "旁白", "画外", "说：", "说道", "说道", "讲：", "讲道", "问：", "回答", "喊", "念出",
  "says", "speaks", "asks", "voiceover", "dialogue"];
const CHARS_PER_SECOND = 4.5; // 中文正常播报速度（留安全余量）
const LEAD_IN_SECONDS = 0.6; // 起句留白
const MAX_PROMPT_CHARS = 400; // AutoDL 实测：600 字级长提示词两次不出片

/** H3 的时长会吸附到 24fps 下 17k+5 帧的网格（官方指南） */
function nativeSeconds(requested) {
  const frames = Math.max(22, Math.round((requested * 24 - 5) / 17) * 17 + 5);
  return frames / 24;
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function speechUnits(value) {
  const cjk = (value.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latinWords = (value.match(/[A-Za-z]+/g) ?? []).length * 2; // 英文按 2 个单位粗估
  const digits = (value.match(/[0-9]+/g) ?? []).length * 2;
  return cjk + latinWords + digits;
}

/** 提示词「体量」：中文按字计，英文按 1/3 计（贴近分词后的实际负担） */
function promptWeight(value) {
  const cjk = (value.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latin = (value.match(/[A-Za-z]/g) ?? []).length / 3;
  return Math.round(cjk + latin);
}

function extractPrompts(text) {
  const prompts = [];
  const isVideo = /<h3:/.test(text); // 只有 H3 视频提示词才吃「三段式/正文英文」这类规则
  const pattern = /<text:Value\b[^>]*>([\s\S]*?)<\/text:Value>/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[1];
    const offset = match.index + match[0].indexOf(raw);
    prompts.push({
      body: decodeEntities(raw).trim(),
      rawHasDialogueTag: /<d>/.test(raw),
      isVideo,
      index: offset,
    });
  }
  return prompts.length > 0
    ? prompts
    : [{ body: decodeEntities(text).trim(), rawHasDialogueTag: false, isVideo, index: 0 }];
}

/** SVML 里 <d> 必须写成 &lt;d&gt;，检查前先还原实体（markup 只支持这五个） */
function decodeEntities(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function checkFile(path) {
  const text = readFileSync(path, "utf8");
  const findings = [];
  const add = (level, rule, message) => findings.push({ level, rule, message });

  const durations = [...text.matchAll(/duration="(\d+)"/g)].map((item) => Number(item[1]));
  const requested = durations.length > 0 ? Math.max(...durations) : undefined;

  for (const prompt of extractPrompts(text)) {
    const { body } = prompt;
    if (path.endsWith(".svml") && prompt.rawHasDialogueTag) {
      add("ERROR", "R27", "SVML 里 <d> 没转义：必须写成 &lt;d&gt;…&lt;/d&gt;，否则会被当成 XML 元素，plan 直接报 text:Value accepts text only");
    }
    const dialogueBlocks = [...body.matchAll(/<d>([\s\S]*?)<\/d>/g)];
    const spoken = dialogueBlocks.map((item) => item[1]);
    const speechish = dialogueBlocks.length > 0
      || SPEECH_HINTS.some((hint) => body.includes(hint));

    // ---- 台词语法（R1/R2/R3/R4/R18/R19）----
    if (speechish && dialogueBlocks.length === 0) {
      add("ERROR", "R1", "提示词里提到了说话/台词，但没有任何 <d>[语言] …</d> 块——裸写的台词会被模型自由发挥");
    }
    for (const block of dialogueBlocks) {
      const line = lineOf(body, block.index ?? 0);
      const inner = block[1];
      const tag = inner.match(/^\s*\[([^\]]+)\]/);
      if (tag === undefined) {
        add("ERROR", "R1", `第 ${line} 行附近的 <d> 块缺少语言标签，应写成 <d>[Chinese] …</d>`);
      } else if (!CANONICAL_LANGUAGES.has(tag[1].trim())) {
        add("ERROR", "R1", `<d> 的语言标签 [${tag[1]}] 不是官方英文语言名（如 [Chinese] / [English]）`);
      }
      const spokenText = inner.replace(/^\s*\[[^\]]+\]/, "");
      if (/[0-9]/.test(spokenText)) {
        add("ERROR", "R18", `台词含阿拉伯数字：「${spokenText.trim().slice(0, 24)}」→ 改写成中文读法（如 二零二六年）`);
      }
      if (/[A-Za-z]/.test(spokenText)) {
        add("ERROR", "R19", `台词夹了英文/型号：「${spokenText.trim().slice(0, 24)}」→ 改写成中文说法`);
      }
      if (/[~～]|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(spokenText)) {
        add("ERROR", "R2", "台词里有波浪号/emoji/装饰符号，会被念出来或触发乱码");
      }
      if (/(\.\.\.|。。。|！！|？？|，，)/.test(spokenText)) {
        add("WARN", "R2", "台词里有重复标点，建议统一成单个 ，。？！");
      }
      if (/\(S\d+\)/.test(inner)) {
        add("ERROR", "R7", "说话人编号写进了 <d> 里，应写在 <d> 外面");
      }
    }
    if (speechish && !/\(S\d+\)/.test(body)) {
      add("ERROR", "R5", "没有说话人编号 (S1)/(S2)：跨镜头会串声、换嘴");
    }
    if (dialogueBlocks.length > 1) {
      const seen = new Set();
      for (const spokenText of spoken) {
        const key = spokenText.replace(/^\s*\[[^\]]+\]/, "").trim().slice(0, 12);
        if (key.length > 3 && seen.has(key)) add("ERROR", "R4", `同一句台词出现多次：「${key}…」`);
        seen.add(key);
      }
    }

    // ---- 画外音（R8）----
    if (/画外|旁白|off-screen|voiceover/i.test(body)
      && !/唇[^。；，]*闭|嘴唇保持闭合|嘴巴闭合|lips remain (completely )?closed|mouth stays closed/i.test(body)) {
      add("ERROR", "R8", "写了画外音却没声明画面人物「嘴唇保持闭合」——实测这是错口型的第一大来源");
    }

    // ---- 时长与语速（R10/R11/R28/R29）----
    if (requested !== undefined && spoken.length > 0) {
      const available = nativeSeconds(requested) - LEAD_IN_SECONDS;
      const budget = Math.floor(available * CHARS_PER_SECOND);
      const used = spoken.reduce((sum, spokenText) => sum + speechUnits(spokenText.replace(/^\s*\[[^\]]+\]/, "")), 0);
      if (used > budget) {
        add("ERROR", "R10", `台词量 ${used} 字 > ${requested} 秒档可用 ${budget} 字`
          + `（实得 ${nativeSeconds(requested).toFixed(2)} 秒，已留 ${LEAD_IN_SECONDS} 秒余量）→ 删词或加时长/拆镜`);
      } else if (used < Math.floor(budget * 0.6)) {
        add("WARN", "R28", `台词量 ${used} 字 < ${requested} 秒档预算的 60%（${budget} 字）`
          + "——字太少模型会把语速拖慢填满时长，实测出现过 3.2 字/秒（正常 4.5–5.5）；补台词或缩短该镜");
      }
    }
    if (dialogueBlocks.length > 0
      && !/(语速|語速|pace|brisk|conversational|normal speed|steady|不拖|不要拖|自然流畅|语速正常|偏快)/i.test(body)) {
      add("WARN", "R29", "没有写语速/节奏（如 speaks at a natural, brisk conversational pace）——不写时 H3 默认偏慢");
    }
    for (const spokenText of spoken) {
      if (/慢慢|缓缓|缓慢|慢悠悠|不紧不慢/.test(spokenText)) {
        add("WARN", "R29", `台词或表演词里有「慢」类描述：「${spokenText.trim().slice(0, 20)}」——会进一步拖慢语速`);
      }
    }

    // ---- 结构（R13/R14/R15）——仅 H3 视频提示词适用（生图提示词没有声音分段）----
    const hasSections = ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"]
      .filter((name) => body.includes(name));
    if (prompt.isVideo && hasSections.length === 0) {
      add("WARN", "R13", "没按官方三段字段写（integrated_multimodal_description / overall_soundscape / non_diegetic_music）");
    } else if (prompt.isVideo && hasSections.length < 3) {
      add("WARN", "R13", `官方三段缺 ${3 - hasSections.length} 段：${["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"].filter((name) => !body.includes(name)).join(" / ")}`);
    }
    const soundscape = body.split("overall_soundscape:")[1]?.split("non_diegetic_music:")[0] ?? "";
    for (const spokenText of spoken) {
      const key = spokenText.replace(/^\s*\[[^\]]+\]/, "").trim();
      if (prompt.isVideo && key.length > 6 && soundscape.includes(key.slice(0, 12))) {
        add("ERROR", "R14", "台词被重复写进了 overall_soundscape（会被读两遍）");
        break;
      }
    }
    const withoutDialogue = body.replace(/<d>[\s\S]*?<\/d>/g, "");
    const cjk = (withoutDialogue.match(/[\u3400-\u9fff]/g) ?? []).length;
    const letters = (withoutDialogue.match(/[A-Za-z]/g) ?? []).length;
    if (prompt.isVideo && cjk > 40 && cjk > letters / 3) {
      add("WARN", "R15", `正文以中文为主（中文 ${cjk} 字 / 英文 ${letters} 字母）：官方 rewrite 规则要求正文英文、只有台词保留中文`);
    }

    // ---- 通用画面约束（R25/R26，含 AutoDL 实测经验值）----
    if (!/(不要|禁止|严禁)[^。；\n]{0,24}(文字|字幕|水印|字母|贴纸|logo)|(no|without|do not (render|show|include|add))[^.\n]{0,60}(text|subtitles?|watermark|letters?|logo)/i.test(body)) {
      add("WARN", "R25", "没有显式要求「画面无平台水印/字幕条/角标」——同时要写「保留画面主体自身的品牌字」");
    }
    const weight = promptWeight(body);
    if (weight > MAX_PROMPT_CHARS) {
      add("WARN", "R26", `提示词体量约 ${weight}（中文按字、英文按 1/3 计），超过本项目经验上限 ${MAX_PROMPT_CHARS}（AutoDL 实测长提示词容易出片失败）`);
    }
  }

  return findings;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("用法：node scripts/check-dialogue.mjs <file.svml|prompt.txt> [...]");
  process.exit(2);
}
let errors = 0;
let warnings = 0;
for (const file of files) {
  let findings;
  try {
    findings = checkFile(file);
  } catch (error) {
    console.error(`${basename(file)}: 读取失败 ${error.message}`);
    process.exitCode = 2;
    continue;
  }
  const fileErrors = findings.filter((item) => item.level === "ERROR").length;
  const fileWarnings = findings.length - fileErrors;
  errors += fileErrors;
  warnings += fileWarnings;
  console.log(`${file}  ${fileErrors} ERROR / ${fileWarnings} WARN`);
  for (const item of findings) {
    console.log(`  ${item.level === "ERROR" ? "✗" : "•"} ${item.rule}  ${item.message}`);
  }
}
console.log(`\n合计 ${errors} ERROR / ${warnings} WARN（规则见 docs/rules-dialogue.md）`);
process.exitCode = errors > 0 ? 1 : 0;
