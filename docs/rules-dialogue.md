# 项目规则 · H3 对白准确性（避免读错、说胡话、口型错位）

适用范围：用 MiniMax H3（AutoDL 工作流 + 火山方舟）生成**带人物说话**的视频时。
规则来源：MiniMax 官方《Video Prompt Writing Guide》《Full-Reference Mode Guide》与官方 `h3-prompt-writing` skill
（github.com/MiniMax-AI/MiniMax-H3/skills）、社区 A/B 测试（WeShop《对话与时序提示词指南》）、
以及本仓库实测（AutoDL 12 秒工作流）。

执行方式：写提示词后、花钱前，先跑

```bash
node scripts/check-dialogue.mjs sources/*.svml
```

ERROR 必须改完再 build；WARN 要人工确认。

---

## 一、说词必须走 `<d>` 语法（最高优先）

| 编号 | 规则 | 级别 | 为什么 |
|---|---|---|---|
| R1 | **说出来的台词必须包在 `<d>[语言] …</d>` 里**，语言用官方英文名（`[Chinese]`、`[English]`），不能用 `[中文]`/`[language]` | ERROR | 官方「Mandatory Dialogue Contract」要求；裸写的台词会被模型当成场景描述自由发挥——这正是「说胡话」的主因 |
| R2 | **台词一字不改照抄**：不翻译、不改写、不润色、不替换标点；一律用 `，。？！` 这类基础标点，去掉波浪号、emoji、项目符号、重复标点 | ERROR | 官方要求 verbatim；花哨符号会被念出来或触发乱码 |
| R3 | 听不懂的地方写 `[unclear]`，**不要猜、不要改写** | 建议 | 官方语法规约；避免模型自行补全成别的话 |
| R4 | 每句台词在时间轴上**只出现一次** | ERROR | 官方「Single Timeline Occurrence」；重复出现会被读两遍 |

## 二、说话人身份与归属（错口型 = 归属失败）

| 编号 | 规则 | 级别 | 为什么 |
|---|---|---|---|
| R5 | 每个出声的角色给**稳定编号** `(S1)`、`(S2)`…，跨镜头保持同一个编号；不出声的角色**不要编号** | ERROR | 官方语法；编号是模型区分说话人的唯一锚点 |
| R6 | 说话人**第一次出现**时交代身份要素：角色类型/年龄/性别/是否在画面内/音高/音色/语速/口音 | 建议 | 官方明确要求，身份不稳会导致换声、串词 |
| R7 | 编号、动作、语气写**在 `<d>` 外面**，`<d>` 里**只放语言标签 + 台词原文** | ERROR | 官方语法；混进去会被朗读出来 |
| R8 | **画外音**必须写 `画外旁白/says in an off-screen voiceover`，并在**同一句**里声明画面人物「嘴唇保持闭合」 | ERROR | 社区 A/B 实测：短提示词下「男声画外台词 + 画面里女主持动嘴」明显错配，加上闭嘴指令后消失 |
| R9 | 台词若跨剪辑点，开头镜头内放完整一句，两端各写 `<scenetrans>` 并声明音频连过去；视频结束时话没说完，在 `<d>` 内句尾写 `<cutoff>` | 建议 | 官方语法，避免被截断的地方模型自己编后半句 |

## 三、时长与语速（时间不够 = 必然吃字）

| 编号 | 规则 | 级别 | 为什么 |
|---|---|---|---|
| R10 | 台词字数 ≤ 可用时长 × **4.5 字/秒**，并留 0.6 秒余量 | ERROR | H3 的时长会吸附到 24fps 下 `17k+5` 帧的网格：请求 12 秒实得 **294 帧 = 12.25 秒**，请求 5 秒实得 124 帧 = 5.17 秒。超字会吃字、抢拍、乱读 |
| R28 | 台词字数也别太少：**≥ 槽位预算的 60%**（最好 80%） | WARN | 字太少模型会把语速拖慢去填满时长——实测 16 字塞 5.17 秒档 = **3.21 字/秒**（正常 4.5–5.5），听感就是"念得慢" |
| R29 | 必须显式写**语速/节奏**（正文里 `speaks at a natural, brisk conversational pace with no long pauses` 之类）；台词/表演词里不要出现「慢慢/缓缓/缓慢」 | WARN | 不写语速时 H3 默认偏慢；写了之后统一按这个节奏走 |
| R30 | 成片必须**量语速**并归一化到 4.5–5.5 字/秒：`check-take` 量 → 不达标用 `scripts/retime.mjs` 提速 → 复检 | 必须 | 提示词侧实测只能到 ~4.2 字/秒；`retime.mjs` 用 ASR 实测倍数做音视频同步提速（1.0–1.35× 内），台词 100% 不变、口型不脱轨 |
| R11 | 一条分镜**一句话**；长台词拆成多个镜头，别写成一段独白 | ERROR | 官方与多家服务商一致结论：长台词是口型与咬字崩得最厉害的场景 |
| R12 | 说话人的**嘴和眼睛别被遮挡**，说台词时给到**中近景或更近** | 建议 | 社区已验证：口型覆盖率（dialogue_coverage）直接决定口型保真 |

## 四、提示词结构（官方三段式）

| 编号 | 规则 | 级别 | 为什么 |
|---|---|---|---|
| R13 | 用官方三段字段：`integrated_multimodal_description:` / `overall_soundscape:` / `non_diegetic_music:` | 建议 | 官方格式；声音与画面分家，模型不容易把旁白塞进别人嘴里 |
| R14 | 台词**只写在 description 里**，不要在 soundscape / music 段重复 | ERROR | 官方明文；重复会被读两遍 |
| R15 | **正文写英文，台词保留中文原文**（`<d>[Chinese] …</d>`） | 建议 | 官方 rewrite 规则：正文英文、对话与画面内文字保留原语言 |
| R16 | 画面内的招牌/字幕属于「可见文字」，用英文双引号原样写，**不要**放进 `<d>` | 建议 | 官方区分；放错会被当成台词念出来 |
| R17 | 明确要**静默的角色**写清楚不说话（如「其余人不说话、不张嘴」） | 建议 | 减少抢话与错口型 |
| R25 | 提示词里显式要求**画面无平台水印/字幕条/角标/贴纸**（写 `no watermarks, no captions, no logos or stickers from the platform`），但**画面主体自身的品牌字要保留**（写 `keep the product's own branding and logo exactly as in the reference`） | 建议 | 不写时 H3 会在墙面、衣服、画面主体上冒出无关文字；写过头把画面主体 logo 也抹掉同样不行 |
| R26 | 提示词**体量控制在 400 以内**（中文按字计、英文按 1/3 计） | 建议 | AutoDL 实测：600 字级长提示词两次都没出片，压到 300 字级一次过。**但 400 不是硬线**：2026-09-17 复刻片用到 446 单位仍正常出片（10s/768p，5m43s）——超一点可以试，超 600 要先压 |
| R27 | 在 `.svml` 里写 `<d>` 必须转义成 `&lt;d&gt;…&lt;/d&gt;` | ERROR | 不转义会被 markup 当成 XML 元素，`plan` 直接报 `text:Value accepts text only`（markup 只支持 `&lt; &gt; &amp; &quot; &apos;` 五个实体） |

## 五、读错高危输入（中文尤其）

| 编号 | 规则 | 级别 | 为什么 |
|---|---|---|---|
| R18 | 台词里**不要出现阿拉伯数字**（`238`、`2026`），改写成中文读法（`二三八`、`二零二六年`） | ERROR | 数字是最典型的读错源（切分/进位/单位念法都不稳） |
| R19 | 台词里**不要夹英文单词/缩写/型号**（`H3`、`OK`、`AI`、`13.8kg`），改写成中文音译或中文说法 | ERROR | 中英混读容易串音、跳读、带口音；官方语言标签是「一种语言一条」 |
| R20 | 品牌名/生僻字/多音字先**试听一遍**再定稿；必要时换成同义口语词 | 建议 | 多音字没有上下文保证，模型可能读错调 |
| R21 | 台词不要同时叠环境音与音乐（`overall_soundscape` 里不要塞人声） | 建议 | 抢遮人声，听感像「含糊乱说」 |

## 六、生成后的验收（必须做，别只看画面）

| 编号 | 规则 | 级别 |
|---|---|---|
| R22 | 产物必须**回读校验**：抽音轨做 ASR，逐字比对剧本；不一致 → 记入台账并重跑该条 | 必须 |
| R23 | 画面主体上的 **logo / 品牌字要原样保留，不要打码、不要遮挡、不要模糊**（实测 H3 能把参考图上的品牌字渲染对；OCR 有时会把它识别成"乱码字母"，那是真 logo 不是伪文字）。只有出现**平台水印、字幕条、角标**这类非画面主体元素才处理 | 必须 |
| R24 | 检查是否为**预定说话人**在动嘴（尤其画外音镜头）、剪辑点是否贴住时间戳 | 必须 |

> **R22 现在可自动执行**（本机 WhisperX 已装好）：
>
> ```bash
> hypit transcribe out/xxx.mp4 --language zh --to out/xxx.json --workspace "$P"
> node scripts/check-take.mjs out/xxx.json "这台车一只手就能提起来，出门不求人。"
> ```
>
> 输出**一致率 + 净语速（字/秒）**；一致率要 100%、语速要 ≥4.5 字/秒（`--min-rate` 可调）才算过。
> 实测：合规提示词生成的 5 秒口播片回读 100% 一致（16/16 字）；但语速只有 **3.21 字/秒**（台词太短被拖慢）。
> 提示词侧最多修到 **4.2 字/秒**（实测两版：4.18 / 4.22）；要进 4.5–5.5 的正常区间，用
> `scripts/retime.mjs` 做后期归一化（实测 4.77 字/秒仍 100% 一致）。

---

## 附：最短合规台词写法（可直接抄）

```text
integrated_multimodal_description: [Shot 1] Live-action, a bright modern living room with light wood
floor. A friendly Chinese woman in her thirties (S1), wearing a white blouse, sits on a light sofa,
looks at the camera and says warmly: <d>[Chinese] 今天想跟你聊一个我用了三个月的小习惯，坚持下来真的会变轻松。</d>
She keeps her exact look from the reference image. Nobody else speaks.

overall_soundscape: Soft indoor room tone with a faint air-conditioner hum and a light fabric rustle as she moves.

non_diegetic_music: N/A
```

对照检查：`<d>[Chinese]` ✓、`(S1)` ✓、台词语速可容纳 ✓、无阿拉伯数字/英文 ✓、
声音分段 ✓、静默角色声明 ✓、无画外音（有则需加闭嘴指令）✓。
