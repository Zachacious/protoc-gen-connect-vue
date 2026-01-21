#!/usr/bin/env node
import { createEcmaScriptPlugin, runNodeJs } from "@bufbuild/protoplugin";
import { type DescService, type DescMessage } from "@bufbuild/protobuf";
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
 * STRICT PATH FINDER
 * Only accepts fields that are explicitly about pagination.
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

  // 1. Direct field match
  for (const f of msg.fields) {
    const normalized = f.name.toLowerCase().replace(/_/g, "");
    if (targets.some((t) => normalized.includes(t))) return [f.name];

    // Special case: "page" object in request
    if (isRequest && normalized === "page" && f.fieldKind === "message")
      return [f.name];
  }

  // 2. Nested Search
  for (const f of msg.fields) {
    if (f.fieldKind === "message") {
      const sub = findPaginationPath(f.message, isRequest, depth + 1);
      if (sub) return [f.name, ...sub];
    }
  }
  return null;
}

function processService(service: DescService) {
  const importMap = new Map<string, Set<string>>();
  const wktImports = new Set<string>();
  const allMessages = new Set<string>();

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

    // 1. Kind Check (String literal for v2)
    const isUnary = m.methodKind === "unary";

    // 2. Verb Check
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

    // 3. Pagination Discovery
    const reqPath = findPaginationPath(m.input, true);
    const resPath = findPaginationPath(m.output, false);

    // SAFETY CHECK: A list endpoint MUST have a repeated field.
    // We explicitly exclude Maps (which are not lists) to satisfy TypeScript and Logic.
    const hasRepeatedList = m.output.fields.some((f) => {
      if (f.fieldKind === "map") return false;
      // Now safe to check repeated because maps are excluded
      return (f as { repeated?: boolean }).repeated === true;
    });

    // 4. Dual Hook Trigger
    const isPaginated = isQuery && hasRepeatedList && !!reqPath && !!resPath;

    return {
      functionName: name.charAt(0).toLowerCase() + name.slice(1),
      hookName: `use${name}`,
      infiniteHookName: `use${name}Infinite`, // Secondary hook
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
  };
}

const plugin = createEcmaScriptPlugin({
  name: "protoc-gen-connect-vue",
  version: "v1.8.0",
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
