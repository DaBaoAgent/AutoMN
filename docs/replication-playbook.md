# 人物出镜短视频复刻 · 作业书

目标：拿到一条参考视频，产出**同结构、同台词、同节奏**的新片。
适用：单人/多人出镜的口播、抒情文案、走拍回眸、日常生活类短视频（抖音/快手/B 站/TikTok 均适用）。

---

## 一、先拆片（花 10 分钟，省掉 10 次重跑）

| 步骤 | 命令 / 做法 | 要拿到什么 |
|---|---|---|
| 抓源片 | `hypit media fetch "<链接>" --to references/src.mp4` | 本地文件（抖音要先拿 cookie，见 §五） |
| 量规格 | `ffprobe -v error -show_entries stream=width,height,r_frame_rate,nb_frames,duration -of csv src.mp4` | 时长/画幅/帧率/帧数（**别信页面写的**） |
| 抽帧看片 | `ffmpeg -i src.mp4 -vf fps=2,scale=240:-1,tile=6x4:padding=4 -frames:v 1 sheet.png` | 一张缩略图看全片：几个镜头、景别怎么走 |
| 听内容 | `hypit transcribe src.mp4 --language zh --to src.json` | 逐字稿 + 每字时间（台词量的唯一依据） |
| 定性 | 判断属于下面哪一类 | 决定提示词怎么写 |

**三类片子，写法完全不同：**

| 类型 | 特征 | 提示词要点 |
|---|---|---|
| **画外音型** | 人出镜但**嘴不动**，声音是旁白/朗诵 | 必须写 `off-screen narrator` + `her lips remain completely closed`；人物不给说话人编号 |
| **口播型** | 人对镜头说话、对口型 | 说话人编号 `(S1)` 写在 `<d>` 外；中近景、嘴眼不遮挡；一句一镜 |
| **无对白型** | 只有画面与音乐（走拍/回眸/氛围） | 只写画面、运镜、光线；不需要 `<d>`，也不会触发读错风险 |

---

## 二、人物一致性（复刻人物类片子的核心难点）

H3 是「参考图驱动」的：**给几张参考帧，它重绘出同一个人**。要点：

1. **参考帧从源片抽**：`ffmpeg -ss <秒> -i src.mp4 -frames:v 1 references/frames/f-01.png`
   挑**正面/半侧、光线均匀、无遮挡**的帧；表情夸张或糊掉的帧不要用。
2. **数量**：12 秒档最多 **3 张**（实测 2–3 张最好；4 张会在推理阶段 FAILED 且不报参数错）。
   1–10 秒那条工作流最多 9 张，但超过 3 张收益递减，还更容易崩。
3. **参考图要覆盖变化**：中景一张（构图与服装）、近景一张（面部特征）、环境一张（场景锚定）。
4. **提示词里显式锁人**：`keep her face, hairstyle, makeup and outfit exactly as in the reference images`。
5. **发型/妆容/服装写死在正文**（"long straight black hair, white camisole top"），模型会跟着走。
6. **别在同一镜里换装/换发型** —— 要换就换镜、换参考图。

> 生成出来的人**不是同一个人**的像素级复制，而是模型对参考帧的**再创作**：五官相似、气质一致、细节会变。
> 想要更稳的人物一致性，就用同一组参考图 + 同一套描述词，别每次换。

---

## 三、写提示词（照这个骨架填）

```
integrated_multimodal_description: [Shot 1] Live-action, cinematic film-still quality.
<景别与机位> + <人物外观，抄参考图里的事实> + <动作序列，按时间写> + <运镜> + <光线>
<说话方式：口播 or 画外旁白；画外必须写 lips remain completely closed>
<d>[Chinese] 台词原文，一字不改</d>     ← 只有口播/旁白才需要；无对白镜头整段删掉

overall_soundscape: <环境音，如车厢低频、房间空调声、脚步声>

non_diegetic_music: <配乐，如 quiet sparse piano，没有就写 N/A>

Hard constraints: keep her face, hairstyle and outfit exactly as in the reference images; do not render
watermarks, subtitles, captions, letters, numbers, platform logos, UI elements or QR codes.
```

**台词量硬约束**：`字数 ≤ (实际时长 − 0.6 秒) × 4.5`
（H3 的时长会吸附到 24fps 下 `17k+5` 帧的网格：请求 10 秒 = 243 帧 = 10.125 秒。超字必吃字、抢拍、乱读。）

**写完必跑**：

```bash
node scripts/check-dialogue.mjs sources/xxx.svml     # ERROR 必须清零
```

---

## 四、出片与验收（每一步都有可查的证据）

```bash
H="node D:/@kaifa/AutoMN/hypit/bin/hypit.mjs"; P="D:/@kaifa/AutoMN/projects/AutoMN"

$H plan   "$P/sources/xxx.svrun" --workspace "$P"          # 免费：确认工作流选择与参数
$H build  "$P/sources/xxx.svrun" --workspace "$P" --follow # 花钱：可并发提交
$H get    <build-id> --output final.video --to "$P/out/xxx.mp4" --workspace "$P"
ffprobe -v error -show_entries stream=width,height,nb_frames,duration -of csv out/xxx.mp4

$H transcribe "$P/out/xxx.mp4" --language zh --to "$P/out/xxx.json"
node scripts/check-take.mjs out/xxx.json "<剧本原文>"              # 白话稿：要求 100%
node scripts/check-take.mjs out/xxx.json "<剧本原文>" --pinyin      # 古诗/生僻词：拼音 ≥97% 即可
```

**验收清单**（缺一项都不算完）：

- [ ] 台词：白话稿字面 100% / 古诗类拼音 ≥97%（同音字不算错）
- [ ] 语速：4.5–5.5 字/秒（抒情朗诵类 3.0+ 即可，且**不要**提速）
- [ ] 口型归属正确：画外音镜头全程无人张嘴；口播镜头说话人的嘴在动
- [ ] 人物：与参考图同一人（五官/发型/服装/妆造）
- [ ] 画面：无字幕条、无平台水印、无角标（场景里本来就有的文字不算）
- [ ] 镜头：镜头数与切换时刻对齐分镜表；时长与目标差 ≤0.5 秒
- [ ] 规格：画幅/帧率/时长用 ffprobe 复核过

不合格怎么办：**台词错/漏字** → 按 R22 重跑该条（失败不计费）；
**语速偏慢** → `node scripts/retime.mjs in.mp4 in.json out2.mp4 --target 4.8`（音视频同倍率，口型不脱轨，>1.35× 拒绝执行）；
**画面糊/人不像** → 换参考帧（更清晰的正面帧）再跑。

---

## 五、抓源片：各平台实况

| 平台 | 情况 |
|---|---|
| B 站 | 最稳，`hypit media fetch` 直接下 |
| 抖音 | **需要 fresh cookie**（`Fresh cookies (not necessarily logged in) are needed`）。做法：用一个**临时 Chrome 配置**跑一次无头访问把 cookie 落盘，再让 yt-dlp 读它（脚本见下）。用户主页链接里的 `modal_id=` 就是视频 ID |
| 快手 / TikTok | yt-dlp 支持；TikTok 部分子功能官方标 BROKEN |
| 小红书 | yt-dlp **没有** extractor，需人工取素材或走浏览器抓包 |

```bash
CHROME="$LOCALAPPDATA/Google/Chrome/Application/chrome.exe"
PROF="$LOCALAPPDATA/Temp/src-chrome-profile"
"$CHROME" --headless=new --disable-gpu --no-first-run --user-data-dir="$PROF" \
  --virtual-time-budget=20000 --dump-dom "https://www.douyin.com/video/<id>" >/dev/null 2>&1
yt-dlp --cookies-from-browser "chrome:$PROF" "https://www.douyin.com/video/<id>"
```

---

## 六、成本与时间（实测）

- H3：480p ¥0.04/s、**768p ¥0.06/s**、1080p ¥0.10/s；10 秒片 ≈ ¥0.6，12 秒 ≈ ¥0.72
- Seedream：按输出 token，一档 9:16 约几毛
- 时间：5 秒档 ≈ 2 分钟；10–12 秒档 5–15 分钟；**可并发**（同账号 3 条并行实测全成功，服务端按 30–50 秒排队放行）
- **失败任务不计费**，所以"多跑几条挑一条"的成本主要是时间
- 试错技巧：先用 **5 秒档**同提示词验证构图/口型/台词，确认后再上 10–12 秒正式档

---

## 七、常见坑（都踩过）

| 现象 | 原因 | 处理 |
|---|---|---|
| 台词被读成同音字/意思跑偏 | 提示词没把台词放进 `<d>`，或写了错别字 | 台词一字不改照抄；阿拉伯数字、英文型号写成中文读法 |
| 人物张嘴但没声音 / 声音不是她 | 画外音没声明「嘴唇闭合」 | 补 `lips remain completely closed` |
| 出片 5 秒就结束 | 没显式下发 `duration`/`resolution`，用了工作流默认值 | 两个参数都显式写 |
| 提交成功但推理 FAILED | 参考图 >3 张（12 秒档），或提示词 600 字级过长 | 参考图 ≤3、提示词 ≤400 单位 |
| 生成时卡在 queued 很久 | 服务端排队 | 正常，等；别重复提交 |
| 字幕/水印冒出来 | 提示词没写 Hard constraints | 按模板补最后一段 |
| 语速偏慢（用户能听出来） | 台词字数太少被拖慢 / 没写语速 | 台词补到预算 80%、写 `brisk conversational pace`；仍慢就走 `retime.mjs` |
| 长镜头（12/15 秒）偶发失败 | 服务端抢占（实测单跑也会失败） | 重试；关键镜头优先用 5s/10s 档拼短镜 |

---

## 八、版权与合规

复刻涉及**画面版权、肖像权、音乐版权**。本工具只提供技术手段：

- 商用前确认已获授权（尤其是原片的人物肖像与音乐）；
- 稳妥做法：画面全部重生成、人物用**自有素材或已获授权**的形象，不直接搬运原片素材；
- 平台发布时遵守各平台关于 AI 生成内容的标注要求。
