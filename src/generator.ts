#!/usr/bin/env node
import { createEcmaScriptPlugin, runNodeJs } from "@bufbuild/protoplugin";
import {
  type DescService,
  type DescMessage,
  type DescFile,
} from "@bufbuild/protobuf";
import * as fs from "fs";
import * as path from "path";
import Mustache from "mustache";

const METHOD_KIND_UNARY = 1;

const KNOWN_TYPES: Record<string, string> = {
  "google.protobuf.Empty": "Empty",
  "google.protobuf.Timestamp": "Timestamp",
  "google.protobuf.Duration": "Duration",
};

const currentDir = new URL(".", import.meta.url).pathname;
const templateDir = path.join(currentDir, "..", "templates");

const clientTemplate = fs.readFileSync(
  path.join(templateDir, "client.ts.mustache"),
  "utf-8",
);
const apiTemplate = fs.readFileSync(
  path.join(templateDir, "api.ts.mustache"),
  "utf-8",
);
const rpcPartial = fs.readFileSync(
  path.join(templateDir, "rpc.ts.mustache"),
  "utf-8",
);
const indexTemplate = fs.readFileSync(
  path.join(templateDir, "index.ts.mustache"),
  "utf-8",
);
const partials = { rpc: rpcPartial };

function isPaginatedDeep(
  message: DescMessage,
  visited = new Set<string>(),
): boolean {
  if (visited.has(message.typeName)) return false;
  visited.add(message.typeName);
  const pagingKeys = [
    "page",
    "offset",
    "cursor",
    "limit",
    "pagesize",
    "pagenumber",
  ];
  for (const field of message.fields) {
    if (pagingKeys.includes(field.name.toLowerCase())) return true;
    if (
      field.fieldKind === "message" &&
      isPaginatedDeep(field.message, visited)
    )
      return true;
  }
  return false;
}

/**
 * Robust Type Tracker
 */
function resolveImportPath(message: DescMessage): string {
  // All generated files live in ./gen relative to api.ts
  // We mirror the proto directory structure
  return `./gen/${message.file.name.replace(".proto", "_pb")}`;
}

function processService(service: DescService) {
  const rpcs: any[] = [];
  const wktImports = new Set<string>();
  const importMap = new Map<string, Set<string>>(); // Path -> Set of Type Names
  const allMessages = new Map<string, string>(); // Name -> Path

  function trackMessage(msg: DescMessage) {
    if (allMessages.has(msg.name)) return;

    const fullTypeName = msg.typeName;
    if (KNOWN_TYPES[fullTypeName]) {
      wktImports.add(KNOWN_TYPES[fullTypeName]);
      allMessages.set(KNOWN_TYPES[fullTypeName], "@bufbuild/protobuf/wkt");
      return;
    }

    const targetPath = resolveImportPath(msg);
    if (!importMap.has(targetPath)) importMap.set(targetPath, new Set());
    importMap.get(targetPath)!.add(msg.name);
    allMessages.set(msg.name, targetPath);

    // Deep crawl for createEmpty
    for (const field of msg.fields) {
      if (field.fieldKind === "message") trackMessage(field.message);
    }
  }

  for (const method of service.methods) {
    trackMessage(method.input);
    trackMessage(method.output);

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
    const camelName =
      method.name.charAt(0).toLowerCase() + method.name.slice(1);
    let resource = method.name;
    mutationVerbs.forEach((v) => {
      if (method.name.startsWith(v)) resource = method.name.replace(v, "");
    });

    rpcs.push({
      functionName: camelName,
      hookName: `use${method.name}`,
      resource,
      inputType: method.input.name,
      outputType: method.output.name,
      isQuery:
        (method.methodKind as any) === METHOD_KIND_UNARY &&
        !mutationVerbs.some((v) => method.name.startsWith(v)),
      isPaginated:
        isPaginatedDeep(method.input) &&
        (method.methodKind as any) === METHOD_KIND_UNARY,
    });
  }

  return {
    serviceName: service.name,
    protoPbFile: service.file.name.replace(".proto", "_pb"),
    rpcs,
    messageNames: Array.from(allMessages.keys()),
    wktImports: Array.from(wktImports),
    // Map imports for the template
    externalImports: Array.from(importMap.entries()).map(([path, types]) => ({
      path,
      types: Array.from(types),
    })),
  };
}

const plugin = createEcmaScriptPlugin({
  name: "protoc-gen-connect-vue",
  version: "v1.0.4",
  generateTs: (schema) => {
    const firstService = schema.files.flatMap((f) => f.services)[0];
    if (!firstService) return;

    const viewData = processService(firstService);

    schema
      .generateFile("client.ts")
      .print(Mustache.render(clientTemplate, viewData));
    schema
      .generateFile("api.ts")
      .print(Mustache.render(apiTemplate, viewData, partials));
    schema.generateFile("index.ts").print(Mustache.render(indexTemplate, {}));
  },
});

runNodeJs(plugin);
