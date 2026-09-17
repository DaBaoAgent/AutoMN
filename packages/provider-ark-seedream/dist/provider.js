import { canonicalize, defineEndpointPackage } from "@hypit/hypit/endpoint-kit";
import { generationTypes, sealGeneratedImageSet } from "@hypit/hypit/generation";
export const providerModule = { name: "@volcengine/provider-ark-seedream", version: "1" };
/**
 * The exact capability this Endpoint fulfills: Seedream image generation, whose ports are owned by
 * `@hypit/seedream`. The model says what may be asked for; this Provider maps the request onto
 * 火山方舟 (Volcengine Ark) `/images/generations`.
 */
export const arkSeedreamCapability = {
    module: { name: "@hypit/seedream", version: "1" },
    name: "seedream-5-lite",
};
/** Ark 生图模型；默认用账号可用的最好一个（Seedream 5.0 Pro，2026-09 实测可用）。 */
export const arkImageModels = {
    "seedream-5-0-pro": "doubao-seedream-5-0-pro-260628",
    "seedream-5-0": "doubao-seedream-5-0-260128",
    "seedream-4-5": "doubao-seedream-4-5-251128",
    "seedream-4-0": "doubao-seedream-4-0-250828",
};
/** Ports this Endpoint writes into the Ark request body. */
const implementedPorts = ["prompt", "aspectRatio", "quality", "outputFormat", "nsfwCheck", "images"];
const RATIOS = {
    "1:1": [1, 1], "4:3": [4, 3], "3:4": [3, 4], "16:9": [16, 9],
    "9:16": [9, 16], "2:3": [2, 3], "3:2": [3, 2], "21:9": [21, 9],
};
/** 长边目标；Ark 只接受 WIDTHxHEIGHT（或个别预设），所以由画幅 + 档位算出具体像素。 */
const longSideByQuality = { basic: 1536, high: 2048, ultra: 2560 };
/** 实测：1440x2560(3.7M px) 通过，2304x4096(9.4M px) 被拒；留出余量。 */
const maxAreaPx = 4_300_000;
const minSidePx = 640;
const stepPx = 16;
export function arkImageSize(aspectRatio, quality) {
    const ratio = RATIOS[aspectRatio];
    if (ratio === undefined)
        throw new Error(`Ark Seedream 不支持画幅 ${aspectRatio}`);
    const long = longSideByQuality[quality];
    const [a, b] = ratio;
    const snap = (value) => Math.max(stepPx, Math.round(value / stepPx) * stepPx);
    let width = snap(a >= b ? long : (long * a) / b);
    let height = snap(a >= b ? (long * b) / a : long);
    while (width * height > maxAreaPx) {
        const scale = Math.sqrt(maxAreaPx / (width * height)) * 0.99;
        width = snap(width * scale);
        height = snap(height * scale);
    }
    if (width < minSidePx) {
        height = snap((height * minSidePx) / width);
        width = minSidePx;
    }
    if (height < minSidePx) {
        width = snap((width * minSidePx) / height);
        height = minSidePx;
    }
    return `${width}x${height}`;
}
function object(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new Error("Expected service object");
    return value;
}
function text(value, label) {
    if (typeof value !== "string" || value.length === 0)
        throw new Error(`Expected nonempty ${label}`);
    return value;
}
function address(value) {
    const url = new URL(value);
    if (url.protocol !== "https:")
        throw new Error("Ark baseUrl requires HTTPS");
    return url.href.replace(/\/$/u, "");
}
/** Ark accepts inline media as data URLs; the subtype must be lower case. */
function dataUrl(bytes, mediaType) {
    const [family, subtype = "octet-stream"] = mediaType.split("/");
    return `data:${family}/${subtype.toLowerCase()};base64,${Buffer.from(bytes).toString("base64")}`;
}
export function createArkSeedreamProvider(options) {
    const base = address(options.baseUrl);
    const fetcher = options.fetch ?? globalThis.fetch;
    const store = options.credentialStore ?? "os";
    const requestTimeout = options.timeoutMs ?? 300_000;
    function support(request) {
        const ports = request.constraints.ports;
        const unknownPort = Object.keys(ports).find((port) => !implementedPorts.includes(port));
        if (unknownPort !== undefined) {
            return {
                status: "unsupported",
                reason: `Ark Seedream 没有 ${unknownPort} 端口的线上映射`,
            };
        }
        // Ark 的平台审核对生图是无条件执行的，Provider 无法为单次请求关闭它。
        if (ports.nsfwCheck?.[0] === false) {
            return {
                status: "unsupported",
                reason: "火山方舟对图片生成无条件执行平台内容审核，无法满足 nsfw-check=\"false\"；请写 nsfw-check=\"true\"",
            };
        }
        const quality = ports.quality?.[0];
        if (typeof quality === "string" && !(quality in longSideByQuality)) {
            return { status: "unsupported", reason: `Ark Seedream 不接受档位 ${quality}` };
        }
        const aspectRatio = ports.aspectRatio?.[0];
        if (typeof aspectRatio === "string" && !(aspectRatio in RATIOS)) {
            return { status: "unsupported", reason: `Ark Seedream 不接受画幅 ${aspectRatio}` };
        }
        const images = ports.images ?? [];
        if (images.length > options.maxReferences) {
            return {
                status: "unsupported",
                reason: `Ark Seedream 最多接受 ${options.maxReferences} 张参考图，收到 ${images.length} 张`,
            };
        }
        return { status: "supported" };
    }
    async function inlineReference(context, media, label) {
        const bytes = await context.resources.get(media.artifact.resource);
        if (bytes === undefined)
            throw new Error(`参考图 ${label} 不可用`);
        if (bytes.byteLength > options.maxReferenceBytes) {
            throw new Error(`参考图 ${label} 为 ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB，`
                + `超过本 Endpoint 接受的上限 ${(options.maxReferenceBytes / 1024 / 1024).toFixed(1)}MB`);
        }
        return dataUrl(bytes, media.artifact.mediaType);
    }
    const endpoint = {
        async start(context) {
            const supported = support(context.need);
            if (supported.status === "unsupported")
                throw new Error(supported.reason);
            const secret = text(context.credentials.apiKey?.secret, "Ark API Key");
            const request = context.need.constraints;
            const ports = request.ports;
            const prompt = text(ports.prompt?.[0], "Ark prompt");
            const quality = (ports.quality?.[0] ?? "high");
            const aspectRatio = text(ports.aspectRatio?.[0] ?? "1:1", "Ark aspect ratio");
            const outputFormat = text(ports.outputFormat?.[0] ?? "jpeg", "Ark output format");
            const images = (ports.images ?? []);
            const size = arkImageSize(aspectRatio, quality);
            const body = {
                model: options.arkModel,
                prompt,
                size,
                output_format: outputFormat,
                response_format: "url",
                watermark: options.watermark ?? false,
            };
            if (images.length > 0) {
                const urls = [];
                for (const [index, image] of images.entries()) {
                    await context.reportProgress?.({
                        phase: "prepare-references", completed: index, total: images.length, unit: "image",
                    });
                    urls.push(await inlineReference(context, image, `image-${index + 1}`));
                }
                body.image = urls.length === 1 ? urls[0] : urls;
            }
            await context.reportProgress?.({ phase: "generating", unit: "image" });
            const response = await fetcher(`${base}/images/generations`, {
                method: "POST",
                headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(requestTimeout),
            });
            const payload = await response.json().catch(() => undefined);
            const envelope = payload === undefined ? undefined : object(payload);
            if (!response.ok) {
                const error = envelope === undefined ? undefined : object(envelope.error ?? {});
                const message = error === undefined ? undefined : error.message;
                throw new Error(`Ark /images/generations 返回 HTTP ${response.status}`
                    + `${typeof message === "string" ? `: ${message}` : ""}`);
            }
            if (envelope === undefined)
                throw new Error("Ark /images/generations 返回了非 JSON 响应");
            const data = Array.isArray(envelope.data) ? envelope.data : [];
            const first = data.length > 0 ? object(data[0]) : undefined;
            const url = first === undefined ? undefined : first.url;
            if (typeof url !== "string" || url.length === 0) {
                throw new Error(`Ark 响应里没有图片 URL: ${JSON.stringify(envelope).slice(0, 300)}`);
            }
            const mediaType = outputFormat === "png" ? "image/png" : "image/jpeg";
            const media = await fetcher(url, { signal: AbortSignal.timeout(600_000) });
            if (!media.ok)
                throw new Error(`Ark 图片下载返回 HTTP ${media.status}`);
            const artifact = await context.resources.put(new Uint8Array(await media.arrayBuffer()), mediaType);
            return {
                status: "completed",
                result: { value: { kind: "inline", value: canonicalize(sealGeneratedImageSet({ images: [artifact] })) } },
            };
        },
        async poll() {
            // Ark 图片接口在 start 内同步完成；正常路径不会走到轮询。
            return {
                status: "failed",
                failure: {
                    code: "ARK_SEEDREAM_UNEXPECTED_POLL",
                    message: "Ark Seedream 在提交调用里已返回结果，不应进入轮询阶段",
                },
            };
        },
    };
    return defineEndpointPackage({
        module: providerModule,
        facet: "ark-seedream",
        instance: options.instance,
        pool: options.pool,
        credentials: { apiKey: { store, key: options.instance } },
        credentialInputs: { apiKey: { label: "火山方舟 Ark API Key" } },
        defaultConcurrency: 2,
        actionLimits: { submit: { concurrency: 2 } },
        pricing: { kind: "page", url: "https://www.volcengine.com/docs/82379/1541523" },
        async readPricing(context) {
            const ports = context.request.constraints.ports;
            const quality = (ports.quality?.[0] ?? "high");
            const aspectRatio = typeof ports.aspectRatio?.[0] === "string" ? String(ports.aspectRatio[0]) : "1:1";
            const size = aspectRatio in RATIOS ? arkImageSize(aspectRatio, quality) : undefined;
            return [{
                    source: "https://www.volcengine.com/docs/82379/1541523",
                    data: canonicalize({
                        unit: "CNY per generated image (Ark bills by output token)",
                        arkModel: options.arkModel,
                        requested: { aspectRatio, quality, size: size ?? null },
                        observedTokens: { "1024x1024": 4096, "1440x2560": 14400, "2496x1664(2K)": 16224 },
                    }),
                    summary: `火山方舟 ${options.arkModel} 按输出 token 计费，实际单价以控制台账单为准；`
                        + `${quality} 档在 ${aspectRatio} 下请求尺寸${size === undefined ? "由服务端决定" : ` ${size}`}。`,
                }];
        },
        capabilities: [{
                capability: arkSeedreamCapability,
                returns: generationTypes.imageSet,
                lifecycle: "asynchronous",
                supports: support,
                // Ark 的图片接口是一次同步调用：start 直接把结果带回来，不需要 poll/collect。
                endpoint,
            }],
    });
}
