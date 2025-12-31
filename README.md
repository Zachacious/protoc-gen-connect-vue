# **@zachacious/protoc-gen-connect-vue**

A specialized protoc plugin designed to generate a production-grade, reactive TypeScript SDK for **Vue.js**. This plugin serves as an intelligent orchestration layer on top of [ConnectRPC](https://connectrpc.com/) and [TanStack Vue Query](https://tanstack.com/query/latest), automating the tedious aspects of state management, cache synchronization, and pagination.

## **🏗 Context & Architecture**

This project is not a replacement for standard tooling but an enhancement of it. It leverages the official [connect-query-es](https://github.com/connectrpc/connect-query-es) plugin to generate underlying query definitions and wraps them in a high-level SDK tailored for Vue 3.

### **Core Pillars**

1. **Reactivity:** Deep integration with Vue's Composition API.
2. **Smart Invalidation:** Heuristic-based cache clearing. When a mutation (e.g., CreateTicket) succeeds, the SDK automatically invalidates related queries (e.g., ListTickets).
3. **Deep Pagination Search:** Recursively scans Protobuf messages for pagination fields to automatically switch from standard useQuery to useInfiniteQuery.
4. **Transport Decoupling:** Global interceptors for Auth and Error handling so your components stay clean.

---

## **🚀 Installation**

### **1. Plugin Installation**

You can install the plugin globally or as a dev dependency.

```
# Recommended for local development
npm install --save-dev @zachacious/protoc-gen-connect-vue

# For use across non-Node projects (Go/Rust/etc)
npm install -g @zachacious/protoc-gen-connect-vue
```

### **2. Peer Dependencies**

The generated SDK requires these specific packages to be installed in your Vue project:

```
npm install @connectrpc/connect @connectrpc/connect-web @connectrpc/connect-query @tanstack/vue-query @bufbuild/protobuf
```

---

## **⚙️ Configuration**

### **buf.gen.yaml**

The plugin **must** run after protoc-gen-es and protoc-gen-connect-query.

```yaml
version: v2
managed:
 enabled: true
plugins:
 # 1. Base Protobuf TS messages
 - local: es
 out: gen
 opt: target=ts
 # 2. ConnectRPC Query definitions
 - local: connect-query
 out: gen
 opt: target=ts
 # 3. Smart SDK Generator
 - local: protoc-gen-connect-vue
 out: src/api
```

---

**🛠 Integration & Setup**

### **1. Global Client Configuration (main.ts)**

Configure your environment-specific settings before mounting the app.

```TypeScript

import { createApp } from 'vue';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { setBaseUrl, setAuthResolver, setSDKErrorCallback, globalQueryConfig } from '@/api';
import { useAuthStore } from '@/stores/auth';

const app = createApp(App);

// 1. Initialize TanStack with SDK defaults (StaleTime, GC, etc.)
app.use(VueQueryPlugin, { queryClientConfig: globalQueryConfig });

// 2. Configure Endpoint
setBaseUrl(import.meta.env.VITE_API_URL);

// 3. Setup Auth Bridge (Decoupled from SDK logic)
const auth = useAuthStore();
setAuthResolver(async () => {
 return auth.token; // Header 'x-api-key' added if exists
});

// 4. Global Error Handling
setSDKErrorCallback((err, url) => {
 if (err.code === 16) { // Unauthenticated
 auth.logout();
 window.location.href = '/login';
 }
});

app.mount('#app');
```

### **2. Transport Provider Setup (App.vue)**

You must wrap your application (or relevant route views) in the TransportProvider to provide the ConnectRPC context to the hooks.

```html
<script setup lang="ts">
  import { TransportProvider } from "@connectrpc/connect-query";
  import { transport } from "@/api/client";
</script>

<template>
  <TransportProvider :transport="transport">
    <router-view />
  </TransportProvider>
</template>
```

---

## **📖 Usage Examples**

### **Reactive Queries**

Unary RPCs that don't start with mutation verbs are generated as standard queries.

```html
<script setup lang="ts">
  import { useApi } from "@/api";
  const api = useApi();

  const { data, isLoading } = api.useGetCustomerById({ id: "123" });
</script>

<template>
  <div v-if="isLoading">Loading...</div>
  <div v-else>{{ data.name }}</div>
</template>
```

### **Automated Mutations & Invalidation**

The SDK uses resource-name stripping (e.g., UpdateTicket -> Ticket) to invalidate active lists automatically.

```html
<script setup lang="ts">
  const { mutate, isPending } = api.useUpdateTicket({
    onSuccess: () => console.log("List refreshed by SDK!"),
  });

  const save = () => mutate({ id: "123", status: "CLOSED" });
</script>
```

### **Infinite Scrolling (Pagination)**

If fields like page, offset, or limit are detected, the SDK generates an InfiniteQuery.

```html
<script setup lang="ts">
  const { data, fetchNextPage, hasNextPage } = api.useListTickets({
    filter: "open",
  });
</script>

<template>
  <div v-for="page in data?.pages">
    <div v-for="ticket in page.items">{{ ticket.subject }}</div>
  </div>
  <button v-if="hasNextPage" @click="fetchNextPage">Load More</button>
</template>
```

---

## **🧪 Advanced Features**

### **Global Loading State**

Track the status of _every_ RPC call in your application via a single computed property.

```html
<script setup lang="ts">
  const { isGlobalLoading } = useApi();
</script>

<template>
  <ProgressBar v-if="isGlobalLoading" />
</template>
```

### **Protobuf Documentation Tags**

Fine-tune your SDK directly from your .proto comments:

| Tag                  | Description                                                      |
| :------------------- | :--------------------------------------------------------------- |
| @wrapper:auth        | Marks the endpoint as expecting authentication in documentation. |
| @sdk:signature=(...) | Overrides the generated TypeScript function signature.           |
| @sdk:data=res.item   | Overrides the default data extractor for async wrappers.         |

---

**📝 License**

MIT © [Zachacious](https://www.google.com/search?q=https://github.com/zachacious)
