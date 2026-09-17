import { canonicalize, defineEndpointPackage, wakeAfter } from "@hypit/hypit/endpoint-kit";
import type {
  AsyncEndpoint, CanonicalValue, EndpointInvocationContext, EndpointRequest,
} from "@hypit/hypit/endpoint-kit";
import { generationTypes, sealGeneratedVideoSet } from "@hypit/hypit/generation";
import type { GenerationMediaValue, GenerationRequest } from "@hypit/hypit/generation";

export const providerModule = { name: "@autodl/provider-autodl-h3", version: "1" } as const;

/**
 * The exact capability this Endpoint fulfills: MiniMax H3 video, whose ports are owned by
 * `@hypit/minimax-h3`. The model says what may be asked for; this Provider picks one of the
 * AutoDL.Art ComfyUI workflows declared in its configuration and maps the request onto it.
 */
export const autodlH3Capability = {
  module: { name: "@hypit/minimax-h3", version: "1" },
  name: "minimax-h3",
} as const;

/** Ports any AutoDL H3 workflow may consume. `referenceVideo` has no wired workflow here. */
const implementedPorts: readonly string[] =
  ["prompt", "duration", "resolution", "aspectRatio", "referenceImage", "referenceAudio", "firstFrame", "lastFrame"];

/**
 * What one AutoDL workflow accepts. `duration`/`resolution` are real request parameters of these
 * workflows（不传就落到图里的默认值），所以每个工作流要写清它能接受的枚举值。
 */
export type WorkflowSpec = {
  readonly id: string;
  readonly label?: string;
  readonly kind: "multi-image" | "text-to-video" | "first-last" | "image-audio";
  /** 可请求时长（秒，枚举）。空数组表示不下发 `duration`（该工作流没有这个入参，如对口型）。 */
  readonly durations: readonly number[];
  /** H3 档位 + 画幅 → AutoDL `resolution` 字段值（顺序即优先级）。空数组表示不下发 `resolution`。 */
  readonly resolutions: readonly { readonly tier: string; readonly aspectRatio: string; readonly payload: string }[];
  readonly maxReferences?: number;
  /** image-audio：音频字段名与「音频时长」字段名 */
  readonly audioField?: string;
  readonly audioDurationField?: string;
};

type Ports = Readonly<Record<string, readonly CanonicalValue[]>>;

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected service object");
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Expected nonempty ${label}`);
  return value;
}

function address(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("AutoDL baseUrl requires HTTPS");
  return url.href.replace(/\/$/u, "");
}

/** AutoDL accepts inline media as data URLs; the subtype must be lower case. */
function dataUrl(bytes: Uint8Array, mediaType: string): string {
  const [family, subtype = "octet-stream"] = mediaType.split("/");
  return `data:${family}/${subtype.toLowerCase()};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** Which of the model's invocation shapes the request uses — it decides which workflows can serve it. */
function kindOf(ports: Ports): WorkflowSpec["kind"] | undefined {
  const has = (port: string) => (ports[port]?.length ?? 0) > 0;
  if (has("referenceVideo")) return undefined;
  if (has("firstFrame") || has("lastFrame")) return "first-last";
  if (has("referenceAudio")) return "image-audio";
  if (has("referenceImage")) return "multi-image";
  return "text-to-video";
}

export function createAutodlH3Provider(options: {
  instance: string;
  pool: string;
  baseUrl: string;
  workflows: readonly WorkflowSpec[];
  /** 多个工作流都能承接同一请求时的优先顺序；不在列表里的按配置顺序排后面。 */
  prefer?: readonly string[];
  maxReferenceBytes: number;
  credentialStore?: string;
  concurrency?: number;
  pollIntervalMs?: number;
  fetch?: typeof globalThis.fetch;
}) {
  const base = address(options.baseUrl);
  const fetcher = options.fetch ?? globalThis.fetch;
  const interval = options.pollIntervalMs ?? 15_000;
  const store = options.credentialStore ?? "os";
  if (options.workflows.length === 0) throw new Error("AutoDL H3 requires at least one workflow");

  const order = options.prefer ?? [];
  const rank = (spec: WorkflowSpec) => {
    const index = order.indexOf(spec.id);
    return index === -1 ? order.length + options.workflows.indexOf(spec) : index;
  };
  const ranked = [...options.workflows].sort((left, right) => rank(left) - rank(right));

  /** 请求里已经定下来的事实：把「能不能接」和「发什么」都建立在同一处判断上。 */
  function analyze(request: EndpointRequest) {
    const ports = (request.constraints as unknown as GenerationRequest).ports as Ports;
    const unknownPort = Object.keys(ports).find((port) => !implementedPorts.includes(port));
    if (unknownPort !== undefined) {
      return { ok: false as const, reason: `AutoDL 的 H3 工作流没有 ${unknownPort} 端口的线上映射` };
    }
    const kind = kindOf(ports);
    if (kind === undefined) {
      return { ok: false as const, reason: "AutoDL 已登记的 H3 工作流都不吃参考视频（referenceVideo）" };
    }
    const duration = ports.duration?.[0];
    const tier = typeof ports.resolution?.[0] === "string" ? String(ports.resolution[0]) : "768P";
    const aspectRatio = typeof ports.aspectRatio?.[0] === "string" ? String(ports.aspectRatio[0]) : undefined;
    const references = (ports.referenceImage ?? []).length;
    const candidates = ranked
      .filter((spec) => spec.kind === kind)
      .filter((spec) => spec.durations.length === 0
        || typeof duration !== "number" || spec.durations.includes(duration))
      .filter((spec) => spec.resolutions.length === 0 || spec.resolutions.some((entry) =>
        entry.tier === tier && (aspectRatio === undefined || entry.aspectRatio === aspectRatio)))
      .filter((spec) => references <= (spec.maxReferences ?? 9));
    if (candidates.length === 0) {
      return {
        ok: false as const,
        reason: `AutoDL 已登记的工作流里没有能接这个请求的（类型 ${kind}、时长 ${String(duration)}s、`
          + `档位 ${tier}${aspectRatio === undefined ? "" : `、画幅 ${aspectRatio}`}、参考图 ${references} 张）`,
      };
    }
    const spec = candidates[0]!;
    const resolution = spec.resolutions.find((entry) =>
      entry.tier === tier && (aspectRatio === undefined || entry.aspectRatio === aspectRatio));
    return { ok: true as const, spec, resolution, ports, kind };
  }

  function support(request: EndpointRequest) {
    const analyzed = analyze(request);
    return analyzed.ok
      ? { status: "supported" as const }
      : { status: "unsupported" as const, reason: analyzed.reason };
  }

  /** One AutoDL call. The service answers HTTP 200 with a `code` envelope on the body. */
  async function call(path: string, secret: string, init: RequestInit = {}) {
    const response = await fetcher(`${base}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: secret },
      signal: AbortSignal.timeout(120_000),
    });
    const body: unknown = await response.json().catch(() => undefined);
    const envelope = body === undefined ? undefined : object(body);
    if (!response.ok) {
      throw new Error(`AutoDL ${path} returned HTTP ${response.status}`
        + `${envelope === undefined ? "" : `: ${JSON.stringify(envelope).slice(0, 300)}`}`);
    }
    if (envelope === undefined) throw new Error(`AutoDL ${path} returned a non-JSON body`);
    const code = envelope.code;
    const message = typeof envelope.msg === "string" && envelope.msg.length > 0 ? envelope.msg : `code ${String(code)}`;
    if (code !== "Success") throw new Error(`AutoDL ${path}: ${message}`);
    return { data: object(envelope.data ?? {}), message };
  }

  async function inlineMedia(
    context: EndpointInvocationContext,
    media: GenerationMediaValue,
    label: string,
  ): Promise<string> {
    const bytes = await context.resources.get(media.artifact.resource);
    if (bytes === undefined) throw new Error(`${label} 不可用`);
    if (bytes.byteLength > options.maxReferenceBytes) {
      throw new Error(
        `${label} 为 ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB，`
        + `超过本 Endpoint 接受的上限 ${(options.maxReferenceBytes / 1024 / 1024).toFixed(1)}MB；`
        + "请先把它缩到最长边 ≤1280px（AutoDL 素材走 base64 内联提交）",
      );
    }
    return dataUrl(bytes, media.artifact.mediaType);
  }

  const endpoint: AsyncEndpoint = {
    async start(context) {
      const analyzed = analyze(context.need);
      if (!analyzed.ok) throw new Error(analyzed.reason);
      const { spec, ports } = analyzed;
      const secret = text(context.credentials.apiKey?.secret, "AutoDL API Key");
      const prompt = text(ports.prompt?.[0], "AutoDL prompt");
      const duration = ports.duration?.[0];
      const payload: Record<string, unknown> = { prompt };
      if (typeof duration === "number" && spec.durations.length > 0) payload.duration = duration;
      if (analyzed.resolution !== undefined) payload.resolution = analyzed.resolution.payload;

      const references = (ports.referenceImage ?? []) as readonly GenerationMediaValue[];
      for (const [index, image] of references.entries()) {
        await context.reportProgress?.({
          phase: "prepare-references", completed: index, total: references.length, unit: "image",
        });
        payload[`ref_image_${index}`] = await inlineMedia(context, image, `参考图 ref_image_${index}`);
      }
      if (spec.kind === "first-last") {
        const first = ports.firstFrame?.[0] as GenerationMediaValue | undefined;
        const last = ports.lastFrame?.[0] as GenerationMediaValue | undefined;
        if (first !== undefined) payload.first_frame = await inlineMedia(context, first, "首帧");
        if (last !== undefined) payload.last_frame = await inlineMedia(context, last, "尾帧");
      }
      if (spec.kind === "image-audio") {
        const audios = (ports.referenceAudio ?? []) as readonly GenerationMediaValue[];
        const audio = audios[0];
        if (audio === undefined) throw new Error("对口型工作流需要一段参考音频");
        payload[spec.audioField ?? "ref_audio_0"] = await inlineMedia(context, audio, "参考音频");
        if (typeof duration === "number") payload[spec.audioDurationField ?? "audio_duration"] = duration;
      }

      await context.reportDiagnostic?.({
        level: "info",
        message: `AutoDL 工作流 ${spec.id}${spec.label === undefined ? "" : `（${spec.label}）`}：`
          + `${spec.kind} / ${typeof duration === "number" ? `${duration}s` : "时长由素材决定"}`
          + `${analyzed.resolution === undefined ? "" : ` / ${analyzed.resolution.payload}`}`,
      });
      await context.reportProgress?.({ phase: "submitting" });
      const { data } = await call(`/api/v1/comfyui/comfyui_workflow/${encodeURIComponent(spec.id)}`, secret, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const id = text(data.task_id, "AutoDL task id");
      await context.checkpoint?.({ handle: { id, workflow: spec.id }, receipt: { id } });
      return {
        ...wakeAfter({ id, workflow: spec.id }, interval, Date.now(), { phase: "queued" }),
        receipt: { id },
      };
    },
    async poll(context) {
      const handle = object(context.handle);
      const id = text(handle.id, "AutoDL task id");
      const secret = text(context.credentials.apiKey?.secret, "AutoDL API Key");
      const { data, message } = await call(
        `/api/v1/comfyui/comfyui_workflow/result/${encodeURIComponent(id)}`, secret,
      );
      const status = text(data.status, "AutoDL task status");
      if (status === "SUCCESS") {
        const results = Array.isArray(data.results) ? data.results : [];
        const video = results.map(object).find((item) => item.type === "video" && typeof item.url === "string");
        if (video === undefined) {
          return {
            status: "failed",
            failure: { code: "AUTODL_NO_VIDEO", message: "AutoDL 任务完成但结果里没有视频 URL" },
          };
        }
        return {
          status: "ready",
          handle: { ...handle, url: text(video.url, "AutoDL video url") },
          receipt: { id },
        };
      }
      if (status === "FAILED" || status === "ERROR" || status === "CANCELLED") {
        return { status: "failed", failure: { code: status, message } };
      }
      const elapsed = typeof data.duration === "number" ? data.duration : undefined;
      return wakeAfter(handle as unknown as CanonicalValue, interval, Date.now(), {
        phase: status.toLowerCase(),
        ...(elapsed === undefined ? {} : { completed: elapsed, unit: "second" }),
      });
    },
    async collect(context) {
      const url = text(object(context.handle).url, "AutoDL video url");
      // The produced file is already public; account credentials stay on the AutoDL API.
      const response = await fetcher(url, { signal: AbortSignal.timeout(900_000) });
      if (!response.ok) throw new Error(`AutoDL 成片下载返回 HTTP ${response.status}`);
      const artifact = await context.resources.put(new Uint8Array(await response.arrayBuffer()), "video/mp4");
      return {
        status: "completed",
        result: { value: { kind: "inline", value: canonicalize(sealGeneratedVideoSet({ videos: [artifact] })) } },
      };
    },
  };

  return defineEndpointPackage({
    module: providerModule,
    facet: "autodl-h3",
    instance: options.instance,
    pool: options.pool,
    credentials: { apiKey: { store, key: options.instance } },
    credentialInputs: { apiKey: { label: "AutoDL.Art API Key" } },
    defaultConcurrency: options.concurrency ?? 3,
    // 实测（2026-09-17）：同账号同时提交 3 个 5 秒任务，三条并行执行且全部 SUCCESS
    // （started_at 重叠，服务端按 ~30–50s 间隔排队放行）。所以 submit 限流不再压到 1。
    actionLimits: {
      submit: { concurrency: options.concurrency ?? 3 },
      poll: { concurrency: 8 },
      collect: { concurrency: 2 },
    },
    pricing: { kind: "page", url: "https://autodl.art/large-model/tokens" },
    async readPricing() {
      // 官方按「输出秒数」计费：480p ¥0.04/s、768p ¥0.06/s、1080p ¥0.10/s（价目快照）。
      const rate = 0.06;
      return [{
        source: "https://autodl.art/large-model/tokens",
        data: canonicalize({
          unit: "CNY per output second",
          asOf: "2026-08-25",
          rate768p: rate,
          workflows: options.workflows.map((spec) => ({
            id: spec.id,
            label: spec.label ?? null,
            kind: spec.kind,
            durations: [...spec.durations],
            resolutions: spec.resolutions.map((entry) => entry.payload),
            maxReferences: spec.maxReferences ?? null,
          })),
        }),
        summary: `AutoDL.Art 按输出秒数计费（768p ¥${rate}/秒）。本 Endpoint 登记了 ${options.workflows.length} 个工作流，`
          + `请求按「类型 + 时长 + 档位/画幅 + 参考图数」自动择优；优先顺序 ${ranked.map((spec) => spec.id).join(" > ")}。`,
      }];
    },
    capabilities: [{
      capability: autodlH3Capability,
      returns: generationTypes.videoSet,
      lifecycle: "asynchronous",
      supports: support,
      endpoint,
    }],
  });
}
