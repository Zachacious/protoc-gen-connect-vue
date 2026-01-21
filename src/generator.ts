#!/usr/bin/env node
import { createEcmaScriptPlugin, runNodeJs } from "@bufbuild/protoplugin";
import { type DescService, type DescMessage } from "@bufbuild/protobuf";
import * as fs from "fs";
import * as path from "path";
import Mustache from "mustache";

const METHOD_KIND_UNARY = 1;
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
 * Universally find field paths for pagination.
 */
function findPath(
  msg: DescMessage,
  targets: string[],
  depth = 0,
): string[] | null {
  if (depth > 4) return null;
  for (const f of msg.fields) {
    if (targets.includes(f.name.toLowerCase())) return [f.name];
  }
  for (const f of msg.fields) {
    if (f.fieldKind === "message") {
      const p = findPath(f.message, targets, depth + 1);
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

    // ROOT-RELATIVE IMPORT:
    // We assume the generated _pb files are in a 'gen' sibling folder
    // This is the standard pattern for Connect/Protobuf-ES
    const importPath = `./gen/${msg.file.name.replace(".proto", "_pb")}`;
    if (!importMap.has(importPath)) importMap.set(importPath, new Set());
    importMap.get(importPath)!.add(msg.name);

    msg.fields.forEach((f) => f.fieldKind === "message" && track(f.message));
  }

  const rpcs = service.methods.map((m) => {
    track(m.input);
    track(m.output);

    const isUnary = (m.methodKind as any) === METHOD_KIND_UNARY;
    const verbs = [
      "Create",
      "Update",
      "Delete",
      "Remove",
      "Patch",
      "Post",
      "Set",
      "Add",
    ];
    const isMutation = verbs.some((v) => m.name.startsWith(v));

    // Discovery
    const reqPath = findPath(m.input, [
      "page",
      "offset",
      "pagetoken",
      "cursor",
      "pagenumber",
    ]);
    const resPath = findPath(m.output, [
      "nextpagetoken",
      "nextpage",
      "hasmore",
      "nextcursor",
    ]);

    return {
      functionName: m.name.charAt(0).toLowerCase() + m.name.slice(1),
      hookName: `use${m.name}`,
      resource: m.name.replace(
        /^(Get|ListAll|List|Create|Update|Delete|Remove|Patch|Post|Set|Add)/,
        "",
      ),
      inputType: m.input.name,
      outputType: m.output.name,
      isQuery: isUnary && !isMutation,
      isPaginated: isUnary && !isMutation && !!reqPath && !!resPath,
      reqPath: reqPath?.join("."),
      resPath: resPath?.join("."),
    };
  });

  return {
    serviceName: service.name,
    protoPbFile: service.file.name.replace(".proto", "_pb"),
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
  version: "v1.0.7",
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
