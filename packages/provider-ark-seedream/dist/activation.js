import { createRuntimeEndpointAdapterFacet, runtimeConfigCredentialRef, runtimeConfigExact, runtimeConfigObject, runtimeConfigPositiveInteger, runtimeConfigString, } from "@hypit/hypit/runtime-kit";
import { arkImageModels, createArkSeedreamProvider, providerModule } from "./provider.js";
const CONFIG_FIELDS = [
    "baseUrl", "apiKey", "capability", "arkModel", "watermark",
    "maxReferences", "maxReferenceBytes", "timeoutMs",
];
export default {
    format: "hypit.node-package@1",
    hostFacets: [createRuntimeEndpointAdapterFacet({
            use: providerModule.name,
            activate(context) {
                const config = runtimeConfigObject(context.config, "Ark Seedream");
                runtimeConfigExact(config, [...CONFIG_FIELDS], "Ark Seedream");
                const baseUrl = runtimeConfigString(config.baseUrl, "Ark baseUrl")
                    ?? "https://ark.cn-beijing.volces.com/api/v3";
                const apiKey = runtimeConfigCredentialRef(config.apiKey, "Ark apiKey");
                const requested = runtimeConfigString(config.capability, "Ark capability") ?? "seedream-5-0-pro";
                if (!(requested in arkImageModels)) {
                    throw new Error(`Ark capability must be one of ${Object.keys(arkImageModels).join(", ")}`);
                }
                const capabilityName = requested;
                if (!apiKey || !context.pool)
                    throw new Error("Ark Seedream requires apiKey and pool");
                const watermark = config.watermark;
                if (watermark !== undefined && typeof watermark !== "boolean") {
                    throw new Error("Ark watermark must be a boolean");
                }
                return {
                    endpoint: createArkSeedreamProvider({
                        instance: context.instance,
                        pool: context.pool,
                        baseUrl,
                        arkModel: runtimeConfigString(config.arkModel, "Ark model") ?? arkImageModels[capabilityName],
                        maxReferences: runtimeConfigPositiveInteger(config.maxReferences, "maxReferences") ?? 14,
                        maxReferenceBytes: runtimeConfigPositiveInteger(config.maxReferenceBytes, "maxReferenceBytes")
                            ?? 10 * 1024 * 1024,
                        timeoutMs: runtimeConfigPositiveInteger(config.timeoutMs, "timeoutMs") ?? 300_000,
                        credentialStore: apiKey.store,
                        ...(watermark === undefined ? {} : { watermark }),
                    }),
                };
            },
        })],
};
