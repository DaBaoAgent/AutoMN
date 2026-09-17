export declare const providerModule: {
    readonly name: "@volcengine/provider-ark-seedream";
    readonly version: "1";
};
/**
 * The exact capability this Endpoint fulfills: Seedream image generation, whose ports are owned by
 * `@hypit/seedream`. The model says what may be asked for; this Provider maps the request onto
 * 火山方舟 (Volcengine Ark) `/images/generations`.
 */
export declare const arkSeedreamCapability: {
    readonly module: {
        readonly name: "@hypit/seedream";
        readonly version: "1";
    };
    readonly name: "seedream-5-lite";
};
/** Ark 生图模型；默认用账号可用的最好一个（Seedream 5.0 Pro，2026-09 实测可用）。 */
export declare const arkImageModels: {
    readonly "seedream-5-0-pro": "doubao-seedream-5-0-pro-260628";
    readonly "seedream-5-0": "doubao-seedream-5-0-260128";
    readonly "seedream-4-5": "doubao-seedream-4-5-251128";
    readonly "seedream-4-0": "doubao-seedream-4-0-250828";
};
export type ArkImageModelName = keyof typeof arkImageModels;
type Quality = "basic" | "high" | "ultra";
export declare function arkImageSize(aspectRatio: string, quality: Quality): string;
export declare function createArkSeedreamProvider(options: {
    instance: string;
    pool: string;
    baseUrl: string;
    arkModel: string;
    watermark?: boolean;
    maxReferences: number;
    maxReferenceBytes: number;
    credentialStore?: string;
    timeoutMs?: number;
    fetch?: typeof globalThis.fetch;
}): import("@hypit/hypit/endpoint-kit").EndpointPackage;
export {};
