#!/usr/bin/env node
import { createEcmaScriptPlugin, runNodeJs } from "@bufbuild/protoplugin";
import {
  type DescService,
  type DescMethod,
  type DescMessage,
  type DescFile,
  MethodKind,
} from "@bufbuild/protobuf";
import * as fs from "fs";
import * as path from "path";
import Mustache from "mustache";

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
    if (
      field.fieldKind === "message" &&
      isPaginatedDeep(field.message, visited)
    )
      return true;
  }
  return false;
}

const plugin = createEcmaScriptPlugin({
  name: "protoc-gen-connect-vue",
  version: "v1.0.0",
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

function processType(
  typeDesc: DescMessage,
  serviceFile: DescFile,
  wktImports: Set<string>,
  localImports: Set<string>,
  externalImports: Map<string, Set<string>>
): string {
  if (KNOWN_TYPES[typeDesc.typeName]) {
    wktImports.add(KNOWN_TYPES[typeDesc.typeName]);
    return KNOWN_TYPES[typeDesc.typeName];
  }
  if (typeDesc.file.name === serviceFile.name) {
    localImports.add(typeDesc.name);
    return typeDesc.name;
  }
  const importPath = `./gen/${path.relative(
    path.dirname(serviceFile.name),
    path.dirname(typeDesc.file.name)
  )}/${path.basename(typeDesc.file.name, ".proto")}_pb`;
  if (!externalImports.has(importPath))
    externalImports.set(importPath, new Set<string>());
  externalImports.get(importPath)!.add(typeDesc.name);
  return typeDesc.name;
}

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

    rpcs.push({
      functionName: camelName,
      hookName: `use${method.name}`,
      queryDefinitionName: camelName,
      resource,
      inputType: inputBaseName,
      outputType: outputBaseName,
      isQuery:
        method.methodKind === MethodKind.Unary &&
        !mutationVerbs.some((v) => method.name.startsWith(v)),
      isPaginated:
        isPaginatedDeep(method.input) && method.methodKind === MethodKind.Unary,
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
      ([path, types]) => ({ path, types: Array.from(types) })
    ),
  };
}

function camelCase(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}
