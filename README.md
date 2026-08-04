# protoc-gen-connect-vue

[![npm version](https://img.shields.io/npm/v/@zachacious/protoc-gen-connect-vue?style=flat-square&color=cb3837&logo=npm)](https://www.npmjs.com/package/@zachacious/protoc-gen-connect-vue)
[![license](https://img.shields.io/npm/l/@zachacious/protoc-gen-connect-vue?style=flat-square&color=blue)](LICENSE)
![Vue 3](https://img.shields.io/badge/Vue-3-42b883?style=flat-square&logo=vuedotjs&logoColor=white)

A [ConnectRPC](https://connectrpc.com/) codegen plugin that emits a Vue client SDK: a reactive transport, async wrappers for every RPC, and TanStack Query (vue-query) hooks on top of them.

The official `@connectrpc/connect-query` targets React. This covers the same ground for Vue — `ref`, `computed`, and cache invalidation that behaves the way a Vue app expects.

> I built this for my own projects and internal work. If it's useful to you, let me know.

## What gets generated

Three files, into whatever directory you point the plugin at:

| File | Contents |
| --- | --- |
| `client.ts` | Reactive transport, auth resolver, error callback, credentials mode, `globalQueryConfig` |
| `api.ts` | `useApi()` with a wrapper + hook per RPC, plus `queryKeys` and `createEmpty` |
| `index.ts` | Re-exports both |

Every RPC gets an async wrapper (`getUser(req)`) and a hook (`useGetUser`). Paginated RPCs get a third: `useGetUserInfinite`.

## Compatibility

| Dependency | Supported versions |
| --- | --- |
| `@connectrpc/connect` / `@connectrpc/connect-web` | v1.6+ and v2 |
| `@bufbuild/protobuf` / `protoc-gen-es` codegen | v2 |
| `@tanstack/vue-query` | v5 |
| Vue | 3 |

Credentials are applied through a `fetch` override rather than the version-specific `credentials` transport option, so the generated code type-checks against both connect-web v1.6+ and v2.

## Install

The plugin itself:

```bash
npm install -g @zachacious/protoc-gen-connect-vue
```

Runtime dependencies in your Vue app:

```bash
npm install @tanstack/vue-query @connectrpc/connect @connectrpc/connect-web @bufbuild/protobuf
```

If you'd rather not install globally, add it as a dev dependency and point buf at the binary path (`local: ./node_modules/.bin/protoc-gen-connect-vue`).

## Generate

```yaml
plugins:
  # ...
  - remote: buf.build/bufbuild/es
    out: web/src/api/gen
    opt:
      - target=ts

  # Must run after protoc-gen-es. Last is a safe place for it.
  - local: protoc-gen-connect-vue
    out: web/src/api
    opt: target=ts
```

The two `out` paths are load-bearing. The generated client imports message types from `./gen/<proto>_pb` relative to its own directory, so the protoc-gen-es output has to sit in a `gen/` folder directly inside this plugin's output directory. The pairing above (`web/src/api/gen` and `web/src/api`) satisfies that.

## How your RPCs are classified

The generator infers intent from method names and message shapes. Knowing the rules saves you from wondering why a method got the hook it did.

**Query vs. mutation.** A unary method whose name starts with `Create`, `Update`, `Delete`, `Remove`, `Patch`, `Post`, `Set`, or `Add` becomes a mutation. Every other unary method becomes a query. Name a mutating RPC `ArchiveUser` and you'll get a query hook that auto-fetches.

**Cache resource.** The leading verb (`Get`, `List`, `ListAll`, `Search`, or any mutation verb) is stripped from the method name and what's left becomes the resource key. `GetUser`, `ListUsers`, and `UpdateUser` land on `User`, `Users`, and `User` respectively — note that `ListUsers` does *not* share a bucket with `GetUser`. If you want list queries invalidated by a single-item mutation, name them consistently.

**Pagination.** A query gets an infinite hook when both its request and response carry pagination fields. The request is searched for `page_token`, `page_number`, `next_page_token`, `offset`, or `cursor`; the response for `next_page_token`, `next_page`, or `next_cursor`. Fields nested one to three levels deep inside a message named `page`/`paging`/`meta` count too.

**Streaming.** Only unary methods are supported. Streaming methods are classified as mutations and the generated hook will not work on them.

**Services.** Only the first service found in the schema is generated. A multi-service proto needs a separate buf plugin invocation per service.

## Setup

### 1. Register the query client

```ts
// main.ts
import { createApp } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { globalQueryConfig } from "@/api";
import App from "./App.vue";

const app = createApp(App);
const queryClient = new QueryClient(globalQueryConfig);

app.use(VueQueryPlugin, { queryClient });
app.mount("#app");
```

`globalQueryConfig` sets a 5-minute `staleTime`, a 30-minute `gcTime`, and `networkMode: "offlineFirst"`. Drop it and pass your own config if those don't suit you.

### 2. Runtime configuration

The base URL defaults to `http://localhost:3000`, so set it before your first request — in an auth store, or at the top of `main.ts`.

```ts
import { setBaseUrl, setAuthResolver, setSDKErrorCallback } from "@/api";

setBaseUrl("https://api.example.com");

// Called on every request. Sync or async.
setAuthResolver(async () => localStorage.getItem("token"));

setSDKErrorCallback((err, url) => {
  console.error(`API error at ${url}: ${err.message}`);
});
```

A non-null token is sent as the **`x-api-key`** header, not `Authorization: Bearer`. Your backend needs to read that header, or you need to edit the generated interceptor.

Changing the base URL rebuilds the transport, and any component holding a client picks it up through `computed`. The auth resolver is different — it's called fresh on every request, so a token change needs no rebuild and no re-render.

### 3. Cookies and credentials

The transport sends cookies cross-origin by default (`credentials: "include"`). If your backend's CORS setup doesn't allow credentials, change the mode at startup:

```ts
import { setFetchCredentials } from "@/api";

// "include" (default) | "same-origin" | "omit"
setFetchCredentials("same-origin");
```

It takes effect on the next request; no transport rebuild.

> **Upgrading from 1.0.20 or earlier:** those releases passed a `fetchOptions` key that connect-web ignored, so the `"include"` default never reached the wire and your app ran on the browser default of `"same-origin"`. From 1.0.21 it takes effect. Cross-origin backends serving `Access-Control-Allow-Origin: *`, or without `Access-Control-Allow-Credentials: true`, will start failing CORS after you regenerate — fix the backend or call `setFetchCredentials("same-origin")`. Full notes in the [CHANGELOG](CHANGELOG.md).

## Usage

`useApi()` calls `useQueryClient()` internally, so it has to run inside `setup()` with `VueQueryPlugin` installed.

### Queries

Hooks take the full request message, not a bare id. Wrap it in `computed` to make it reactive — vue-query unwraps refs in both the key and the request.

```vue
<script setup lang="ts">
import { computed, ref } from "vue";
import { useApi } from "@/api";

const { useGetUser } = useApi();

const userId = ref("123");
const { data, isLoading, error } = useGetUser(
  computed(() => ({ id: userId.value })),
);
</script>

<template>
  <div v-if="isLoading">Loading…</div>
  <div v-else-if="error">{{ error }}</div>
  <h1 v-else>{{ data?.name }}</h1>
</template>
```

A second argument is spread into the underlying `useQuery` options, so `enabled`, `select`, `retry` and friends all work.

### Mutations

Mutation hooks take options only; the request goes to `mutate`. On success they invalidate the whole resource bucket.

```vue
<script setup lang="ts">
import { useApi } from "@/api";

const { useUpdateUser } = useApi();
const { mutate, isPending } = useUpdateUser();

const save = () => mutate({ id: "123", name: "New Name" });
</script>
```

Passing your own `onSuccess` replaces the generated one and skips the invalidation. Invalidate yourself in that callback, or use `onSettled` instead.

### Async wrappers

Every RPC also gets a plain async function for cases that don't fit a hook — a submit handler, a store action, anything imperative. It returns `{ data, error }` instead of throwing, where `error` is the `ConnectError` message string.

```ts
const { updateUser } = useApi();

const { data, error } = await updateUser({ id: "123", name: "New Name" });
if (error) {
  // handle it
}
```

Wrappers invalidate their resource on success — including the wrappers for read methods. Calling `getUser()` imperatively invalidates `["User"]` and will refetch any mounted `useGetUser`. Use the hook for reads unless you specifically want that.

### Infinite queries

```ts
const { useListUsersInfinite } = useApi();

const { data, fetchNextPage, hasNextPage } = useListUsersInfinite({ limit: 20 });
```

The page token is written into the request at the path the generator discovered, and read back off the response the same way. `initialPageParam` defaults to `""` and can be overridden through the options argument.

### createEmpty

Protobuf messages want concrete defaults — empty strings rather than `undefined`. `createEmpty` builds one for any message type in the service graph, with optional overrides.

```ts
import { useApi } from "@/api";

const { createEmpty } = useApi();

const newCustomer = ref(createEmpty.Customer({ name: "Initial Name" }));
```

### Manual invalidation

`queryKeys` produces `[resource, functionName, input]`. Since TanStack matches on key prefixes, invalidating a resource is the reliable move:

```ts
import { useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/api";

const queryClient = useQueryClient();

// Everything derived from the User resource
queryClient.invalidateQueries({ queryKey: ["User"] });

// A single query — the input must deep-equal what the hook was called with
queryClient.invalidateQueries({ queryKey: queryKeys.getUser({ id: "123" }) });
```

`queryKeys` and `createEmpty` are exported at module scope as well as from `useApi()`, so you can use them outside components.

### Global loading state

`isGlobalLoading` is a computed that's true while any query or mutation is in flight. Handy for a top-level progress bar.

```ts
const { isGlobalLoading } = useApi();
```

## Known limitations

- One service per invocation.
- Unary methods only.
- Hook inputs and options are typed `any`. Request and response types are checked on the async wrappers, not on the hooks.
- Method naming drives both the mutation classification and the cache buckets. Unconventional names produce surprising hooks.
- A user-supplied `onSuccess` on a mutation hook overrides the automatic invalidation rather than running after it.
- `BigInt.prototype.toJSON` is patched globally by the generated client so 64-bit fields survive serialization.

## License

MIT
