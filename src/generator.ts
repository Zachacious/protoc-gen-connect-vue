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
 * Structural path finder for pagination.
 * Traverses messages to find specific field names.
 */
function findPaginationPath(msg: DescMessage, depth = 0): string[] | null {
  if (depth > 3) return null;

  // Targets for page numbers or tokens
  const targets = ["pagenumber", "offset", "pagetoken", "cursor"];

  // 1. Direct field hit
  for (const f of msg.fields) {
    const normalized = f.name.toLowerCase().replace(/_/g, "");
    if (targets.includes(normalized)) return [f.name];
  }

  // 2. Recurse into common paging objects (like 'page' or 'paging')
  for (const f of msg.fields) {
    if (f.fieldKind === "message") {
      const subPath = findPaginationPath(f.message, depth + 1);
      if (subPath) return [f.name, ...subPath];
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

    // PER SPEC: methodKind is a string union "unary" | "server_streaming" | etc.
    const isUnary = m.methodKind === "unary";

    // Determine if it's a "Write" operation
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

    // Semantic Query: Any Unary method that isn't a mutation
    const isQuery = isUnary && !isMutation;

    // Detect Pagination Structure
    const reqPath = findPaginationPath(m.input);
    const resPath = findPaginationPath(m.output);
    const isPaginated = isQuery && !!reqPath && !!resPath;

    return {
      functionName: name.charAt(0).toLowerCase() + name.slice(1),
      hookName: `use${name}`,
      // Resource grouping for cache keys: ListAllCustomers -> Customers
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
  version: "v1.2.1",
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
