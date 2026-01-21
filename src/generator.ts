#!/usr/bin/env node
import { createEcmaScriptPlugin, runNodeJs } from "@bufbuild/protoplugin";
import { type DescService, type DescMessage } from "@bufbuild/protobuf";
import * as fs from "fs";
import * as path from "path";
import Mustache from "mustache";

// FIX: In @bufbuild/protobuf, Unary is 0. 1 is ServerStreaming.
const METHOD_KIND_UNARY = 0;

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
 * Structural path finder.
 * Correctly finds nested paths like 'page.pageNumber' or 'page.offset'.
 */
function findPaginationPath(
  msg: DescMessage,
  targets: string[],
  depth = 0,
): string[] | null {
  if (depth > 3) return null;
  // Look for direct primitive hits (page_number, offset, etc)
  for (const f of msg.fields) {
    if (targets.includes(f.name.toLowerCase().replace(/_/g, "")))
      return [f.name];
  }
  // Search deeper for objects (like common.v1.PageRequest)
  for (const f of msg.fields) {
    if (f.fieldKind === "message") {
      const p = findPaginationPath(f.message, targets, depth + 1);
      if (p) return [f.name, ...p];
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

    // Standardize pathing relative to generation root
    const importPath = `./gen/${msg.file.name.replace(".proto", "")}_pb`;
    if (!importMap.has(importPath)) importMap.set(importPath, new Set());
    importMap.get(importPath)!.add(msg.name);

    msg.fields.forEach((f) => f.fieldKind === "message" && track(f.message));
  }

  const rpcs = service.methods.map((m) => {
    track(m.input);
    track(m.output);

    const name = m.name;
    const isUnary = m.methodKind === METHOD_KIND_UNARY;
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

    // Find where the page number/offset lives in the request
    const reqPath = findPaginationPath(m.input, [
      "pagenumber",
      "page",
      "offset",
      "pagetoken",
      "cursor",
    ]);
    // Find where the next page trigger lives in the response
    const resPath = findPaginationPath(m.output, [
      "nextpagetoken",
      "nextpage",
      "hasmore",
      "nextcursor",
      "page",
    ]);

    const isQuery = isUnary && !isMutation;
    const isPaginated = isQuery && !!reqPath && !!resPath;

    return {
      functionName: name.charAt(0).toLowerCase() + name.slice(1),
      hookName: `use${name}`,
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
  version: "v1.1.2",
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
