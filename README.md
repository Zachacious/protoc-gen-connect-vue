# **protoc-gen-connect-vue**

protoc-gen-connect-vue is a code generation plugin for [ConnectRPC](https://connectrpc.com/) tailored specifically for **Vue.js**. It generates a type-safe SDK that combines the power of **ConnectRPC** with the reactivity of the Vue Composition API and the caching capabilities of **TanStack Query (Vue-Query)**.

Unlike the official @connectrpc/connect-query which is architected for React, this plugin is built from the ground up for Vue developers, providing first-class support for ref, computed, and manual resource invalidation.

Protoc-gen-connect-vue attempts to create the full SDK - The client and API Wrappers(standard and Vue-Query). If you are building a Vue.js project with a ConnectRPC(web) backend. This aims to be an all in one solution so you are ready to go client-side.

> Note: I made this for use in personal and internal work projects. If you find it useful, let me know.

## **Features**

- **Reactive Client:** Automatically re-initializes the transport when your base URL or auth tokens change.
- **TanStack Query Integration:** Generates useQuery, useMutation, and useInfiniteQuery hooks for every RPC.
- **Manual Wrappers:** Provides standard async wrappers for actions that don't fit the "query" pattern.
- **Message Initializers:** A createEmpty utility to generate default objects for any Protobuf message type.
- **Query Key Factory:** Centralized query keys to simplify manual cache invalidation.

## **Compatibility**

| Dependency | Supported versions |
| --- | --- |
| `@connectrpc/connect` / `@connectrpc/connect-web` | v1.6+ and v2 |
| `@bufbuild/protobuf` / `protoc-gen-es` codegen | v2 |
| `@tanstack/vue-query` | v5 |
| Vue | 3 |

The generated client configures credentials through a `fetch` override rather than the version-specific `credentials` transport option, so the same generated code type-checks against both connect-web v1.6+ and v2. See the [CHANGELOG](CHANGELOG.md) for the 1.0.21 upgrade notes.

## **Installation**

```bash
# install plugin either globally or locally

npm install -g @zachacious/protoc-gen-connect-vue
```

```Bash
# install dependencies

npm install protoc-gen-connect-vue @tanstack/vue-query @connectrpc/connect @connectrpc/connect-web @bufbuild/protobuf
```

## **Generation**

Add the plugin to your buf.gen.yaml:

```YAML
plugins:
# ...
  - remote: buf.build/bufbuild/es
    out: web/src/api/gen
    opt:
      - target=ts

  # Make sure this plugin goes after protoc-gen-es
  # It should probably go last

  # npm install -g @zachacious/protoc-gen-connect-vue
  # https://www.npmjs.com/package/@zachacious/protoc-gen-connect-vue
  - local: protoc-gen-connect-vue
    out: web/src/api
    opt: target=ts
```

## **Setup**

### **1. Configure the Provider**

In your main.ts, provide the QueryClient to your Vue application.

```TypeScript

import { createApp } from 'vue';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { globalQueryConfig } from './api/generated/client';
import App from './App.vue';

const app = createApp(App);
const queryClient = new QueryClient(globalQueryConfig);

app.use(VueQueryPlugin, { queryClient });
app.mount('#app');
```

### **2. Runtime Configuration**

Set up your authentication and base URL, typically in an identity store or main entry point.

```TypeScript

import { setBaseUrl, setAuthResolver, setSDKErrorCallback } from '@/api/generated';

setBaseUrl('https://api.example.com');

// Supports async token resolution
setAuthResolver(async () => {
 const token = localStorage.getItem('token');
 return token ? token : null;
});

setSDKErrorCallback((err, url) => {
 console.error(`API Error at ${url}: ${err.message}`);
});
```

### **3. Credentials / Cookies**

The generated transport sends cookies cross-origin by default (`credentials: "include"`), applied through a `fetch` override so it works with both `@connectrpc/connect-web` v1 (>= 1.6) and v2 — v2 removed the `credentials` transport option, and the `fetch` override is the recommended replacement.

If your backend's CORS configuration doesn't allow credentials, change the mode at runtime:

```TypeScript

import { setFetchCredentials } from '@/api/generated';

// "include" (default) | "same-origin" | "omit"
setFetchCredentials('same-origin');
```

> **Upgrading from 1.0.20 or earlier:** previous releases passed a `fetchOptions` option that connect-web silently ignored, so credentials were never actually applied. From 1.0.21 the `"include"` default genuinely takes effect — if a cross-origin backend's CORS isn't configured for credentials, set `"same-origin"` at startup to keep the old behavior. Details in the [CHANGELOG](CHANGELOG.md).

## **Usage**

### **Using Hooks and Manual Wrappers**

The generated SDK provides both automated hooks and manual async functions.

```html
<script setup lang="ts">
  import { ref } from "vue";
  import { useApi } from "@/api/generated";

  const { getUser, useGetUser } = useApi();

  // 1. Reactive Hook (Auto-fetches)
  const userId = ref("123");
  const { data, isLoading, error } = useGetUser(userId);

  // 2. Manual Action
  const handleUpdate = async () => {
    const { data, error } = await updateUser({ id: "123", name: "New Name" });
    if (!error) {
      // Note: The SDK automatically invalidates related queries on success
      console.log("Update successful");
    }
  };
</script>

<template>
  <div v-if="isLoading">Loading...</div>
  <div v-else-if="error">{{ error }}</div>
  <div v-else>
    <h1>{{ data?.name }}</h1>
    <button @click="handleUpdate">Update Profile</button>
  </div>
</template>
```

### **Initializing New Data (createEmpty)**

Protobuf messages often require specific default values (e.g., empty strings instead of undefined). The createEmpty utility ensures your local state matches the expected Protobuf structure.

```TypeScript

import { useApi } from '@/api/generated';

const { createEmpty } = useApi();

// Create an empty Customer object with all Protobuf defaults
// Useful when you need to create and empty instance instead of using a nullable object
const newCustomer = ref(createEmpty.Customer({ name: "Initial Name" }));
```

### **Manual Cache Invalidation (queryKeys)**

If you need to manually refresh or invalidate a specific query, use the queryKeys factory to ensure the key matches the one used by the generated hooks.

```TypeScript

import { useQueryClient } from '@tanstack/vue-query';
import { queryKeys } from '@/api/generated';

const queryClient = useQueryClient();

const refreshUser = (id: string) => {
 queryClient.invalidateQueries({
 queryKey: queryKeys.getUser(id)
 });
};
```

## **Global Loading State**

The SDK exports a reactive isGlobalLoading computed property that tracks if any RPC (query or mutation) is currently in flight.

```TypeScript

const { isGlobalLoading } = useApi();
```

---

License MIT
