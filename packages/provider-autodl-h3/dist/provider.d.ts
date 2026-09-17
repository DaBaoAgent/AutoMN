export declare const providerModule: {
    readonly name: "@autodl/provider-autodl-h3";
    readonly version: "1";
};
/**
 * The exact capability this Endpoint fulfills: MiniMax H3 video, whose ports are owned by
 * `@hypit/minimax-h3`. The model says what may be asked for; this Provider picks one of the
 * AutoDL.Art ComfyUI workflows declared in its configuration and maps the request onto it.
 */
export declare const autodlH3Capability: {
    readonly module: {
        readonly name: "@hypit/minimax-h3";
        readonly version: "1";
    };
    readonly name: "minimax-h3";
};
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
    readonly resolutions: readonly {
        readonly tier: string;
        readonly aspectRatio: string;
        readonly payload: string;
    }[];
    readonly maxReferences?: number;
    /** image-audio：音频字段名与「音频时长」字段名 */
    readonly audioField?: string;
    readonly audioDurationField?: string;
};
export declare function createAutodlH3Provider(options: {
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
}): import("@hypit/hypit/endpoint-kit").EndpointPackage;
