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

/**
 * Protobuf MethodKind constants per the internal spec:
 * Unary = 1, ServerStreaming = 2, ClientStreaming = 3, BiDiStreaming = 4
 */
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
  "utf-8"
);
const apiTemplate = fs.readFileSync(
  path.join(templateDir, "api.ts.mustache"),
  "utf-8"
);
const rpcPartial = fs.readFileSync(
  path.join(templateDir, "rpc.ts.mustache"),
  "utf-8"
);
const indexTemplate = fs.readFileSync(
  path.join(templateDir, "index.ts.mustache"),
  "utf-8"
);
const partials = { rpc: rpcPartial };

/**
 * Recursively inspects a message for pagination fields.
 */
function isPaginatedDeep(
  message: DescMessage,
  visited = new Set<string>()
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
    if (field.fieldKind === "message") {
      if (isPaginatedDeep(field.message, visited)) return true;
    }
  }
  return false;
}

/**
 * Resolves the TypeScript type name and tracks necessary imports.
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

  if (typeDesc.file.name === serviceFile.name) {
    localImports.add(baseName);
    return baseName;
  }

  const importPath = `./gen/${path.relative(
    path.dirname(serviceFile.name),
    path.dirname(typeDesc.file.name)
  )}/${path.basename(typeDesc.file.name, ".proto")}_pb`;

  if (!externalImports.has(importPath)) {
    externalImports.set(importPath, new Set<string>());
  }
  externalImports.get(importPath)!.add(baseName);
  return baseName;
}

/**
 * Transforms a Protobuf Service Descriptor into the ViewData.
 */
function processService(
  service: DescService,
  protoPbFile: string,
  connectQueryFile: string
) {
  const rpcs: any[] = [];
  const wktImports = new Set<string>();
  const localImports = new Set<string>();
  const externalImports = new Map<string, Set<string>>();

  for (const method of service.methods) {
    const inputBaseName = processType(
      method.input,
      service.file,
      wktImports,
      localImports,
      externalImports
    );
    const outputBaseName = processType(
      method.output,
      service.file,
      wktImports,
      localImports,
      externalImports
    );
    const camelName =
      method.name.charAt(0).toLowerCase() + method.name.slice(1);

    // Resource Invalidation Logic
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
    let resource = method.name;
    mutationVerbs.forEach((verb) => {
      if (method.name.startsWith(verb))
        resource = method.name.replace(verb, "");
    });
    if (method.name.startsWith("ListAll"))
      resource = method.name.replace("ListAll", "");

    const isMutation = mutationVerbs.some((verb) =>
      method.name.startsWith(verb)
    );

    // We cast methodKind to any for the comparison to prevent the TS(2367) error
    // while ensuring we are checking for the Unary (1) type.
    const isUnary = (method.methodKind as any) === METHOD_KIND_UNARY;

    rpcs.push({
      functionName: camelName,
      hookName: `use${method.name}`,
      queryDefinitionName: camelName,
      resource,
      inputType: inputBaseName,
      outputType: outputBaseName,
      isQuery: isUnary && !isMutation,
      isPaginated: isPaginatedDeep(method.input) && isUnary && !isMutation,
    });
  }

  return {
    serviceName: service.name,
    protoPbFile,
    connectQueryFile,
    rpcs,
    wktImports: Array.from(wktImports),
    localImports: Array.from(localImports),
    externalImports: Array.from(externalImports.entries()).map(
      ([path, types]) => ({
        path,
        types: Array.from(types),
      })
    ),
  };
}

const plugin = createEcmaScriptPlugin({
  name: "protoc-gen-connect-vue",
  version: "v1.0.2",
  generateTs: (schema) => {
    let firstService = schema.files.flatMap((f) => f.services)[0];
    if (!firstService) return;

    const protoFileStem = firstService.file.name.replace(".proto", "");
    const viewData = processService(
      firstService,
      `${protoFileStem}_pb`,
      `${protoFileStem}-${firstService.name}_connectquery`
    );

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
