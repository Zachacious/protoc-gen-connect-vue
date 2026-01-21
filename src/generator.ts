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
 * The Scoring Engine: Finds the best pagination candidates.
 */
function findBestPaginationCandidate(
  msg: DescMessage,
  isRequest: boolean,
  depth = 0,
): { path: string[]; type: "string" | "number"; score: number } | null {
  if (depth > 3) return null;

  let best: {
    path: string[];
    type: "string" | "number";
    score: number;
  } | null = null;

  for (const f of msg.fields) {
    let currentScore = 0;
    const name = f.name.toLowerCase().replace(/_/g, "");

    // 1. Name Analysis
    const reqKeywords = ["token", "page", "offset", "cursor", "start", "skip"];
    const resKeywords = ["next", "token", "more", "hasmore", "cursor", "total"];
    const targets = isRequest ? reqKeywords : resKeywords;

    if (targets.some((t) => name.includes(t))) currentScore += 10;
    if (name.includes("pagetoken") || name.includes("nextpage"))
      currentScore += 15;

    // 2. Type Analysis
    const isString = f.fieldKind === "scalar" && f.scalar === 9; // TYPE_STRING
    const isNumber =
      f.fieldKind === "scalar" &&
      [3, 4, 5, 13, 17, 18].includes(f.scalar as number);

    if (isString || isNumber) {
      currentScore += 5;
      if (!best || currentScore > best.score) {
        best = {
          path: [f.name],
          type: isString ? "string" : "number",
          score: currentScore,
        };
      }
    }

    // 3. Structural Analysis (Recursion)
    if (f.fieldKind === "message") {
      const nested = findBestPaginationCandidate(
        f.message,
        isRequest,
        depth + 1,
      );
      if (nested) {
        const nestedScore = nested.score + 12; // Encapsulated paging (like PageRequest) is high signal
        if (!best || nestedScore > best.score) {
          best = {
            path: [f.name, ...nested.path],
            type: nested.type,
            score: nestedScore,
          };
        }
      }
    }
  }
  return best;
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

    // PAGINATION DISCOVERY
    const reqCandidate = findBestPaginationCandidate(m.input, true);
    const resCandidate = findBestPaginationCandidate(m.output, false);

    // Threshold: Only paginate if we have a reasonably confident match in both directions
    const isPaginated =
      isQuery &&
      reqCandidate &&
      resCandidate &&
      reqCandidate.score + resCandidate.score > 25;

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
      reqPath: reqCandidate?.path.join("."),
      resPath: resCandidate?.path.join("."),
      pageType: reqCandidate?.type || "string",
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
  version: "v1.4.0",
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
