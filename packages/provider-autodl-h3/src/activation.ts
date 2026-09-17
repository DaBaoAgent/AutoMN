import {
  createRuntimeEndpointAdapterFacet,
  runtimeConfigCredentialRef,
  runtimeConfigExact,
  runtimeConfigObject,
  runtimeConfigPositiveInteger,
  runtimeConfigString,
} from "@hypit/hypit/runtime-kit";
import type { CanonicalValue } from "@hypit/hypit/endpoint-kit";
import { createAutodlH3Provider, providerModule } from "./provider.js";
import type { WorkflowSpec } from "./provider.js";

const CONFIG_FIELDS = [
  "baseUrl", "apiKey", "workflows", "prefer",
  "maxReferenceBytes", "concurrency", "pollIntervalMs",
] as const;

const SPEC_FIELDS = [
  "id", "label", "kind", "durations", "resolutions", "maxReferences", "audioField", "audioDurationField",
] as const;

const KINDS = ["multi-image", "text-to-video", "first-last", "image-audio"] as const;

function fail(message: string): never {
  throw new Error(`AutoDL H3 配置错误：${message}`);
}

function stringList(value: CanonicalValue | undefined, subject: string): readonly string[] {
  if (!Array.isArray(value)) fail(`${subject} 必须是字符串数组`);
  return value.map((item) => {
    if (typeof item !== "string" || item.length === 0) fail(`${subject} 里必须是字符串`);
    return item;
  });
}

function parseSpec(value: CanonicalValue, index: number): WorkflowSpec {
  const subject = `workflows[${index}]`;
  const raw = runtimeConfigObject(value, subject);
  runtimeConfigExact(raw, [...SPEC_FIELDS], subject);
  const id = runtimeConfigString(raw.id, `${subject}.id`);
  if (id === undefined) fail(`${subject}.id 必填`);
  const kind = runtimeConfigString(raw.kind, `${subject}.kind`);
  if (kind === undefined || !(KINDS as readonly string[]).includes(kind)) {
    fail(`${subject}.kind 必须是 ${KINDS.join(" / ")}`);
  }
  const durations = Array.isArray(raw.durations) ? raw.durations : fail(`${subject}.durations 必填（秒数组，空数组=不下发 duration）`);
  const seconds = durations.map((item) => {
    if (typeof item !== "number" || !Number.isSafeInteger(item) || item < 1) {
      fail(`${subject}.durations 里必须是正整数秒`);
    }
    return item;
  });

  const resolutionsRaw = Array.isArray(raw.resolutions) ? raw.resolutions : fail(`${subject}.resolutions 必填（空数组=不下发 resolution）`);
  const resolutions = resolutionsRaw.map((entry, entryIndex) => {
    const fields = runtimeConfigObject(entry, `${subject}.resolutions[${entryIndex}]`);
    runtimeConfigExact(fields, ["tier", "aspectRatio", "payload"], `${subject}.resolutions[${entryIndex}]`);
    const tier = runtimeConfigString(fields.tier, `${subject}.resolutions[${entryIndex}].tier`);
    const aspectRatio = runtimeConfigString(fields.aspectRatio, `${subject}.resolutions[${entryIndex}].aspectRatio`);
    const payload = runtimeConfigString(fields.payload, `${subject}.resolutions[${entryIndex}].payload`);
    if (tier === undefined || aspectRatio === undefined || payload === undefined) {
      fail(`${subject}.resolutions[${entryIndex}] 需要 tier / aspectRatio / payload 三个字符串`);
    }
    return { tier, aspectRatio, payload };
  });

  const label = runtimeConfigString(raw.label, `${subject}.label`);
  const audioField = runtimeConfigString(raw.audioField, `${subject}.audioField`);
  const audioDurationField = runtimeConfigString(raw.audioDurationField, `${subject}.audioDurationField`);
  const maxReferences = runtimeConfigPositiveInteger(raw.maxReferences, `${subject}.maxReferences`);
  return {
    id,
    kind: kind as WorkflowSpec["kind"],
    durations: seconds,
    resolutions,
    ...(label === undefined ? {} : { label }),
    ...(maxReferences === undefined ? {} : { maxReferences }),
    ...(audioField === undefined ? {} : { audioField }),
    ...(audioDurationField === undefined ? {} : { audioDurationField }),
  };
}

export default {
  format: "hypit.node-package@1" as const,
  hostFacets: [createRuntimeEndpointAdapterFacet({
    use: providerModule.name,
    activate(context) {
      const config = runtimeConfigObject(context.config, "AutoDL H3");
      runtimeConfigExact(config, [...CONFIG_FIELDS], "AutoDL H3");
      const baseUrl = runtimeConfigString(config.baseUrl, "AutoDL baseUrl") ?? "https://autodl.art";
      const apiKey = runtimeConfigCredentialRef(config.apiKey, "AutoDL apiKey");
      if (!apiKey || !context.pool) throw new Error("AutoDL H3 requires apiKey and pool");
      if (!Array.isArray(config.workflows)) fail("workflows 必填（至少一个工作流）");
      const workflows = config.workflows.map((entry, index) => parseSpec(entry, index));
      const ids = new Set(workflows.map((spec) => spec.id));
      if (ids.size !== workflows.length) fail("workflows 里有重复的 id");
      const prefer = config.prefer === undefined
        ? undefined
        : stringList(config.prefer, "prefer").map((id) => {
          if (!ids.has(id)) fail(`prefer 里的 ${id} 不在 workflows 中`);
          return id;
        });
      return {
        endpoint: createAutodlH3Provider({
          instance: context.instance,
          pool: context.pool,
          baseUrl,
          workflows,
          maxReferenceBytes: runtimeConfigPositiveInteger(config.maxReferenceBytes, "maxReferenceBytes")
            ?? 6 * 1024 * 1024,
          credentialStore: apiKey.store,
          concurrency: runtimeConfigPositiveInteger(config.concurrency, "concurrency") ?? 3,
          pollIntervalMs: runtimeConfigPositiveInteger(config.pollIntervalMs, "pollIntervalMs") ?? 15_000,
          ...(prefer === undefined ? {} : { prefer }),
        }),
      };
    },
  })],
};
