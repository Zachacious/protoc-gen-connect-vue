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

const clientTemplate = fs.readFileSync(path.join(templateDir, "client.ts.mustache"), "utf-8");
const apiTemplate = fs.readFileSync(path.join(templateDir, "api.ts.mustache"), "utf-8");
const rpcPartial = fs.readFileSync(path.join(templateDir, "rpc.ts.mustache"), "utf-8");
const indexTemplate = fs.readFileSync(path.join(templateDir, "index.ts.mustache"), "utf-8");
const partials = { rpc: rpcPartial };

function isPaginatedDeep(message: DescMessage, visited = new Set<string>()): boolean {
  if (visited.has(message.typeName)) return false;
  visited.add(message.typeName);

  const pagingKeys = ["page", "offset", "cursor", "limit", "pagesize", "pagenumber"];
  for (const field of message.fields) {
    if (pagingKeys.includes(field.name.toLowerCase())) return true;
    if (field.fieldKind === "message") {
      if (isPaginatedDeep(field.message, visited)) return true;
    }
  }
  return false;
}

/**
 * FIXED: This now calculates imports relative to the output root,
 * which is where api.ts is generated.
 */
function processType(
  typeDesc: DescMessage,
  serviceFile: DescFile,
  wktImports: Set<string>,
  localImports: Set<string>,
  externalImports: Map<string, Set<string>>
): string {
  const fullTypeName = typeDesc.typeName;
  const baseName = typeDesc.name;

  if (KNOWN_TYPES[fullTypeName]) {
    wktImports.add(KNOWN_TYPES[fullTypeName]);
    return KNOWN_TYPES[fullTypeName];
  }

  // We are generating api.ts and client.ts in the root of the output directory.
  // The proto-generated files reside in the 'gen' folder (by convention of your plugin).
  const importPath = `./gen/${typeDesc.file.name.replace(".proto", "_pb")}`;

  if (typeDesc.file.name === serviceFile.name) {
    localImports.add(baseName);
  } else {
    if (!externalImports.has(importPath)) {
      externalImports.set(importPath, new Set<string>());
    }
    externalImports.get(importPath)!.add(baseName);
  }
  return baseName;
}

function collectAllMessages(
  message: DescMessage,
  serviceFile: DescFile,
  wktImports: Set<string>,
  localImports: Set<string>,
  externalImports: Map<string, Set<string>>,
  seen = new Set<string>()
) {
  if (seen.has(message.typeName)) return;
  seen.add(message.typeName);

  processType(message, serviceFile, wktImports, localImports, externalImports);

  for (const field of message.fields) {
    if (field.fieldKind === "message") {
      collectAllMessages(field.message, serviceFile, wktImports, localImports, externalImports, seen);
    }
  }
}

function processService(service: DescService, protoPbFile: string) {
  const rpcs: any[] = [];
  const wktImports = new Set<string>();
  const localImports = new Set<string>();
  const externalImports = new Map<string, Set<string>>();
  const allSeenMessages = new Set<string>();

  for (const method of service.methods) {
    collectAllMessages(method.input, service.file, wktImports, localImports, externalImports, allSeenMessages);
    collectAllMessages(method.output, service.file, wktImports, localImports, externalImports, allSeenMessages);

    const camelName = method.name.charAt(0).toLowerCase() + method.name.slice(1);
    const mutationVerbs = ["Create", "Update", "Delete", "Remove", "Patch", "Post", "Set", "Add"];
    let resource = method.name;
    mutationVerbs.forEach((verb) => { if (method.name.startsWith(verb)) resource = method.name.replace(verb, ""); });
    
    rpcs.push({
      functionName: camelName,
      hookName: `use${method.name}`,
      resource,
      inputType: method.input.name,
      outputType: method.output.name,
      isQuery: (method.methodKind as any) === METHOD_KIND_UNARY && !mutationVerbs.some(v => method.name.startsWith(v)),
      isPaginated: isPaginatedDeep(method.input) && (method.methodKind as any) === METHOD_KIND_UNARY,
    });
  }

  return {
    serviceName: service.name,
    protoPbFile,
    rpcs,
    messageNames: Array.from(allSeenMessages).map(m => m.split('.').pop()),
    wktImports: Array.from(wktImports),
    localImports: Array.from(localImports),
    externalImports: Array.from(externalImports.entries()).map(([path, types]) => ({
      path,
      types: Array.from(types),
    })),
  };
}

const plugin = createEcmaScriptPlugin({
  name: "protoc-gen-connect-vue",
  version: "v1.0.3",
  generateTs: (schema) => {
    let firstService = schema.files.flatMap((f) => f.services)[0];
    if (!firstService) return;

    const protoFileStem = firstService.file.name.replace(".proto", "");
    const viewData = processService(firstService, `${protoFileStem}_pb`);

    schema.generateFile("client.ts").print(Mustache.render(clientTemplate, viewData));
    schema.generateFile("api.ts").print(Mustache.render(apiTemplate, viewData, partials));
    schema.generateFile("index.ts").print(Mustache.render(indexTemplate, {}));
  },
});

runNodeJs(plugin);