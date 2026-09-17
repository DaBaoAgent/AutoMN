# AutoMN — 人物出镜短视频复刻工具链

给一段参考视频（抖音/B 站/快手/TikTok……），产出一条**同结构、同台词、同节奏**的新片。
画面由 MiniMax H3 生成、参考帧由 Seedream 出，配一套**花钱前拦截 + 出片后回读**的校验脚本，
目标是把"AI 生视频"从抽卡变成有验收标准的流水线。

- 生视频：**MiniMax H3**（AutoDL.Art ComfyUI 工作流，多工作流自动择优）
- 生图：**火山方舟 Seedream**（人物/场景参考帧）
- 本地校验：**WhisperX** 回读转写 + ffmpeg（抽帧、拼接、语速归一化、并排对比）

> 本仓库是**通用工具链**：不含任何产品素材、不含密钥。参考帧由你从源视频抽帧或自己提供，
> 放在 `references/`（已 gitignore）或 `assets/` 下即可。

## 一、从零搭起来

```bash
# 1) Hypit 发行版（工具本体，第三方开源项目 hypit-ai/hypit）
git clone --depth 1 https://ghfast.top/https://github.com/hypit-ai/hypit D:/@kaifa/AutoMN/hypit
cd D:/@kaifa/AutoMN/hypit
env -u NODE_ENV npm i -g pnpm@10.33.0                 # 必须 unset NODE_ENV，否则 devDeps 被静默 omit
env -u NODE_ENV pnpm install --frozen-lockfile
env -u NODE_ENV node scripts/build-public-types.mjs   # 生成 dist/public/*.d.ts

# 2) 本项目
git clone https://github.com/DaBaoAgent/AutoMN D:/@kaifa/AutoMN/projects/AutoMN
cd D:/@kaifa/AutoMN/projects/AutoMN
env -u NODE_ENV npm install --include=dev
node node_modules/typescript/bin/tsc -p packages/provider-autodl-h3/tsconfig.json
node node_modules/typescript/bin/tsc -p packages/provider-ark-seedream/tsconfig.json

# 3) 绑定 Runtime Profile + 凭据（密钥只进 Windows 凭据库，不落盘）
H="node D:/@kaifa/AutoMN/hypit/bin/hypit.mjs"; P="D:/@kaifa/AutoMN/projects/AutoMN"
$H runtime use "$P/hypit.runtime.json" --workspace "$P"
$H auth login autodl.h3    --workspace "$P" --from <AutoDL Token 文件>
$H auth login ark.seedream --workspace "$P" --from <火山方舟 API Key 文件>

# 4) 自检（全免费）
$H doctor --workspace "$P"
node scripts/check-dialogue.mjs sources/*.svml
$H plan "$P/sources/mn-portrait-voiceover.svrun" --workspace "$P"
```

外部依赖：Node ≥ 22.15、pnpm 10.x、**ffmpeg/ffprobe**（BtbN win64 包解压后把 `bin` 加进 PATH）。

> `hypit doctor` 会报 `hyperframes.local` 不可用（缺一个 Chrome headless shell）——**不影响生视频/生图/转写**，
> 只有做本地 MG 合成渲染才需要，装法见 `hypit runtime up --runtime "$P/hypit.runtime.json"`。

可选但强烈建议——本地 ASR 回读（出片后逐字校验台词）：

```bash
hypit programs prepare --endpoint whisperx.local   # 国内先 setx HF_ENDPOINT https://hf-mirror.com
hypit programs up      --endpoint whisperx.local   # 并 setx HF_HUB_DISABLE_XET 1
```

> `whisperx.local` **只能配 `cpu + int8`**：uv 同步的 venv 装的是 CPU-only torch，写 `cuda` 会启动即崩。
> 英文对齐模型走 download.pytorch.org（实测 146kB/s，40 分钟起），先只装 `alignmentLanguages: ["zh"]`。
> 同音容忍比对需要 `pip install pypinyin`。

## 二、目录

```
AutoMN/
├── hypit.runtime.json                  # Runtime Profile：选服务 + 绑能力 + 凭据引用 + 工作流菜单
├── package.json
├── README.md                           # 本文件
├── docs/
│   ├── replication-playbook.md         # ★ 复刻作业书：拆片方法、口令模板、验收标准
│   ├── rules-dialogue.md               # ★ H3 对白准确性规则（读错/说胡话/错口型的防线）
│   └── autodl-workflows.md             # ★ AutoDL 全部 H3 工作流清单、能力边界与并发实测
├── scripts/
│   ├── check-dialogue.mjs              # 花钱前：提示词对白检查（0 ERROR 才允许 build）
│   ├── check-take.mjs                  # 出片后：ASR 逐字/同音比对 + 净语速（字/秒）
│   ├── retime.mjs                      # 语速归一化：按实测倍数音视频同步提速
│   └── compare_side_by_side.py         # 原片 / 复刻并排对比片
├── templates/portrait-dialogue.svml     # 单人出镜对白镜头模板（合规写法）
├── sources/                            # 用例（*.svml 源码 + *.svrun 运行单）
├── packages/
│   ├── provider-autodl-h3/             # Provider：AutoDL.Art ComfyUI 工作流（多工作流自动择优）
│   └── provider-ark-seedream/          # Provider：火山方舟 Seedream 生图
├── assets/                             # 你自己的人物/场景参考图（可选）
└── references/                         # 抓下来的源视频与抽帧（gitignore）
```

## 三、能力绑定

| Hypit 能力（Model 包） | Endpoint | 实际服务 |
|---|---|---|
| `@hypit/minimax-h3@1#minimax-h3` | `autodl.h3` | AutoDL.Art 的 H3 工作流（7 条已启用，按类型/时长/画幅/参考图数择优） |
| `@hypit/seedream@1#seedream-5-lite` | `ark.seedream` | 火山方舟 Seedream（`doubao-seedream-5-0-pro` 系） |
| `@hypit/whisperx@1#whisperx-alignment` | `whisperx.local` | 本地 WhisperX（转写/回读校验） |

工作流清单、每条能接的时长/画幅/参考图上限、以及**失败与并发**的实测结论见 `docs/autodl-workflows.md`。

## 四、四种典型用例（`sources/`）

| 用例 | 场景 | 关键点 |
|---|---|---|
| `mn-portrait-voiceover` | 单人出镜 + **画外音**（抒情/文案类，抖音常见） | 画外音必须写「旁白 + 嘴唇闭合」，否则会变成她张嘴说话 |
| `mn-portrait-talking` | 单人出镜**对白**（口播） | 台词量 ≤ 可用时长 × 4.5 字/秒；中近景、嘴眼不遮挡 |
| `mn-scene-motion` | **无对白**动态镜头（走路/回头/回眸） | 只写画面与运镜；适合做素材拼接 |
| `mn-image-ref` | 用参考帧生成人物/场景图（Seedream） | 为后续视频锁人物外形；`size=宽x高`，面积 ≤ ~4.3M px |

## 五、怎么给我下指令

给我这几样就能开工：**参考链接（或本地文件）＋ 要改什么（人物/文案/时长/画幅）＋ 预算（可选）**。

```
复刻这条：<抖音/B站链接>
人物保持原片长相，文案照抄，9:16 竖屏，10 秒，预算 3 元内
```

```
复刻这条：<链接>，改成口播版：女声自我介绍 12 秒，画面用原片的构图，人物换成我给的新参考图
```

一次说清即可；中间我会先给**分镜表 + 选定工作流 + 预估花费**，你点头再花钱生成。

## 六、流水线（每一步都有可验证的产物）

1. **抓源片**：`hypit media fetch "<链接>"`（抖音需要 fresh cookie，做法见 `docs/replication-playbook.md`）
2. **拆片**：`ffprobe` 量规格 → 抽帧看景别/运镜 → 有声音就 `hypit transcribe` 出逐字稿
3. **写提示词**：一个镜头一条 → **`node scripts/check-dialogue.mjs sources/xxx.svml`（0 ERROR 才允许花钱）**
4. **生图**（需要锁人物时）：Seedream 用参考帧生场景图/定妆图
5. **生视频**：`hypit build sources/xxx.svrun --workspace "$P" --follow`（可并发）
6. **回读校验**：`hypit transcribe out/xxx.mp4 --language zh --to out/xxx.json` →
   `node scripts/check-take.mjs out/xxx.json "<剧本>" [--pinyin] [--min-rate 4.5]`
7. **修正**：语速不达标 → `node scripts/retime.mjs`；台词错 → 按 R22 重跑该条
8. **交付**：ffmpeg 拼接/字幕 → 出片 + 分镜表 + 实测规格 + `compare_side_by_side.py` 的并排对比

## 七、成本与时间（实测口径）

| 项 | 单价 | 耗时 |
|---|---|---|
| H3 视频 480p / 768p / 1080p | ¥0.04 / **¥0.06** / ¥0.10 每秒输出 | 5 秒档 ≈ 2 分钟；10–12 秒档 5–15 分钟 |
| Seedream 生图 | 按输出 token（一档 9:16 约几毛） | 30–60 秒 |
| 本地转写/校验 | 免费 | 5 秒音频约 14 秒（CPU large-v3） |
| **失败任务** | **不计费**（按输出秒数计费） | 长提示词/被抢占会失败，重试即可 |

并发：**同账号可并发**（实测 3 条 5s 并行、2 条 15s 并行全部成功），服务端会按 30–50 秒间隔排队放行。

## 八、三条硬规则（血泪换的，别跳）

1. **台词写进 `<d>[Chinese] 原文</d>`，一字不改**；正文写英文，画外音必须声明「嘴唇闭合」。
2. **提示词体量 ≤ 400 单位、参考图 ≤ 3 张**（12 秒档），超出会出片失败或推理阶段 FAILED。
3. **出片后必须回读校验**：字面 100%（白话稿）或拼音 ≥97%（古诗/生僻词用 `--pinyin`），
   语速 4.5–5.5 字/秒（抒情朗诵类放宽到 3.0+，且不要提速）。

## 九、版权与合规

复刻他人视频涉及**画面版权、肖像权、音乐版权**。本工具只提供技术手段，**商用前请自行取得授权**；
默认建议：画面重生成、人物用你自有的素材或已获授权的人物形象，不要直接搬运原片素材。
