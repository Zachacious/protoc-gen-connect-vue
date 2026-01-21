#!/usr/bin/env node
import { createEcmaScriptPlugin, runNodeJs } from "@bufbuild/protoplugin";
import {
  type DescService,
  type DescMessage,
  type DescField,
} from "@bufbuild/protobuf";
import * as fs from "fs";
import * as path from "path";
import Mustache from "mustache";

const KNOWN_WKT = [
  "google.protobuf.Empty",
  "google.protobuf.Timestamp",
  "google.protobuf.Duration",
];

const currentDir = new URL(".", import.meta.url).pathname;
const templateDir = path.join(currentDir, "..", "templates");

const templates = {
  client: fs.readFileSync(
    path.join(templateDir, "client.ts.mustache"),
    "utf-8",
  ),
  api: fs.readFileSync(path.join(templateDir, "api.ts.mustache"), "utf-8"),
  rpc: fs.readFileSync(path.join(templateDir, "rpc.ts.mustache"), "utf-8"),
  index: fs.readFileSync(path.join(templateDir, "index.ts.mustache"), "utf-8"),
};

/**
 * RECURSIVE PATH FINDER
 * Prioritizes finding the actual scalar token/number field.
 */
function findPaginationPath(
  msg: DescMessage,
  isRequest: boolean,
  depth = 0,
): string[] | null {
  if (depth > 3) return null;

  const reqKeywords = [
    "pagetoken",
    "pagenumber",
    "nextpagetoken",
    "offset",
    "cursor",
  ];
  const resKeywords = ["nextpagetoken", "nextpage", "nextcursor"];
  const targets = isRequest ? reqKeywords : resKeywords;

  // 1. Search Nested Objects FIRST (Fixes the "premature stop" issue)
  // We prefer "page.page_token" over just "page"
  for (const f of msg.fields) {
    if (f.fieldKind === "message") {
      // Don't recurse into generic fields unless they look promising
      // But always recurse into "page", "paging", "meta"
      const name = f.name.toLowerCase();
      if (
        name.includes("page") ||
        name.includes("meta") ||
        name.includes("paging")
      ) {
        const sub = findPaginationPath(f.message, isRequest, depth + 1);
        if (sub) return [f.name, ...sub];
      }
    }
  }

  // 2. Direct field match (Scalar)
  for (const f of msg.fields) {
    const normalized = f.name.toLowerCase().replace(/_/g, "");
    if (targets.some((t) => normalized.includes(t))) return [f.name];
  }

  return null;
}

/**
 * Safe runtime check for repeated fields.
 */
function isRepeatedSafe(f: DescField): boolean {
  // Exclude maps
  if (f.fieldKind === "map") return false;
  // Runtime check for 'repeated' property
  return "repeated" in f && (f as any).repeated === true;
}

function processService(service: DescService) {
  const importMap = new Map<string, Set<string>>();
  const wktImports = new Set<string>();
  const allMessages = new Set<string>();
  const debugLog: string[] = [];

  function track(msg: DescMessage) {
    if (KNOWN_WKT.includes(msg.typeName)) {
      wktImports.add(msg.name);
      return;
    }
    if (allMessages.has(msg.name)) return;
    allMessages.add(msg.name);

    const importPath = `./gen/${msg.file.name.replace(".proto", "")}_pb`;
    if (!importMap.has(importPath)) importMap.set(importPath, new Set());
    importMap.get(importPath)!.add(msg.name);
    msg.fields.forEach((f) => f.fieldKind === "message" && track(f.message));
  }

  const rpcs = service.methods.map((m) => {
    track(m.input);
    track(m.output);
    const name = m.name;

    const isUnary = m.methodKind === "unary";
    const mutationVerbs = [
      "Create",
      "Update",
      "Delete",
      "Remove",
      "Patch",
      "Post",
      "Set",
      "Add",
    ];
    const isMutation = mutationVerbs.some((v) => name.startsWith(v));
    const isQuery = isUnary && !isMutation;

    const reqPath = findPaginationPath(m.input, true);
    const resPath = findPaginationPath(m.output, false);
    const hasRepeatedList = m.output.fields.some((f) => isRepeatedSafe(f));

    // Dual Hook Logic
    const isPaginated = isQuery && hasRepeatedList && !!reqPath && !!resPath;

    // Debug Info
    debugLog.push(`Method: ${name}`);
    debugLog.push(
      `  isUnary: ${isUnary}, isMutation: ${isMutation} -> isQuery: ${isQuery}`,
    );
    debugLog.push(`  reqPath: ${reqPath?.join(".")}`);
    debugLog.push(`  resPath: ${resPath?.join(".")}`);
    debugLog.push(`  hasRepeatedList: ${hasRepeatedList}`);
    debugLog.push(`  FINAL: isPaginated = ${isPaginated}`);
    debugLog.push("---");

    return {
      functionName: name.charAt(0).toLowerCase() + name.slice(1),
      hookName: `use${name}`,
      infiniteHookName: `use${name}Infinite`,
      resource:
        name.replace(
          /^(Get|ListAll|List|Search|Create|Update|Delete|Remove|Patch|Post|Set|Add)/,
          "",
        ) || "Global",
      inputType: m.input.name,
      outputType: m.output.name,
      isQuery,
      isPaginated,
      reqPath: reqPath?.join("."),
      resPath: resPath?.join("."),
    };
  });

  return {
    serviceName: service.name,
    protoPbFile: `${service.file.name.replace(".proto", "")}_pb`,
    rpcs,
    messageNames: Array.from(allMessages),
    wktImports: Array.from(wktImports),
    externalImports: Array.from(importMap.entries()).map(([path, types]) => ({
      path,
      types: Array.from(types),
    })),
    debugInfo: debugLog.join("\n"), // Pass to template
  };
}

const plugin = createEcmaScriptPlugin({
  name: "protoc-gen-connect-vue",
  version: "v1.9.0",
  generateTs: (schema) => {
    const service = schema.files.flatMap((f) => f.services)[0];
    if (!service) return;
    const data = processService(service);
    schema
      .generateFile("client.ts")
      .print(Mustache.render(templates.client, data));
    schema
      .generateFile("api.ts")
      .print(Mustache.render(templates.api, data, { rpc: templates.rpc }));
    schema.generateFile("index.ts").print(Mustache.render(templates.index, {}));
  },
});

runNodeJs(plugin);
