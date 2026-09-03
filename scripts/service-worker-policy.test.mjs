import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const workerSource = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

const createHarness = ({ fetchResponse } = {}) => {
  const listeners = new Map();
  const stored = new Map();
  const fetchRequests = [];

  const keyFor = request => typeof request === "string" ? request : request.url;
  const cache = {
    async delete(request) {
      return stored.delete(keyFor(request));
    },
    async keys() {
      return [...stored.keys()]
        .filter(key => /^https?:/i.test(key))
        .map(url => ({ url }));
    },
    async match(request) {
      return stored.get(keyFor(request));
    },
    async put(request, response) {
      stored.set(keyFor(request), response);
    },
  };

  const context = {
    URL,
    Request,
    Response,
    Set,
    Promise,
    TypeError,
    caches: {
      async open() { return cache; },
      async keys() { return []; },
      async delete() { return true; },
    },
    async fetch(request) {
      fetchRequests.push(request);
      if (fetchResponse) return fetchResponse(request);
      const mode = typeof request === "string" ? "" : request.mode;
      const headers = mode === "navigate" || (request instanceof Request && new URL(request.url).pathname === "/")
        ? { "content-type": "text/html; charset=utf-8" }
        : undefined;
      return new Response("network", { status: 200, headers });
    },
    self: {
      location: { origin: "https://bridge.example" },
      clients: { async claim() {} },
      async skipWaiting() {},
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
    },
  };

  vm.runInNewContext(workerSource, context, { filename: "bridge/public/sw.js" });

  const dispatchFetch = request => {
    let responsePromise;
    listeners.get("fetch")({
      request,
      respondWith(value) {
        responsePromise = Promise.resolve(value);
      },
    });
    return responsePromise;
  };

  const dispatchInstall = async () => {
    let waitUntil;
    listeners.get("install")({
      waitUntil(value) {
        waitUntil = Promise.resolve(value);
      },
    });
    await waitUntil;
  };

  return {
    dispatchFetch,
    dispatchInstall,
    fetchCount: () => fetchRequests.length,
    fetchRequests,
    stored,
  };
};

const request = (path, { destination = "", mode = "same-origin" } = {}) => ({
  method: "GET",
  url: `https://bridge.example${path}`,
  destination,
  mode,
});

test("install bypasses HTTP cache and precaches only an HTML app shell", async () => {
  const harness = createHarness();

  await harness.dispatchInstall();

  assert.equal(harness.fetchCount(), 1);
  const installRequest = harness.fetchRequests[0];
  assert.ok(installRequest instanceof Request);
  assert.equal(new URL(installRequest.url).pathname, "/");
  assert.equal(installRequest.cache, "reload");
  assert.equal(installRequest.credentials, "same-origin");
  assert.ok(harness.stored.has("/"));
});

test("install fails closed instead of caching a non-HTML app shell", async () => {
  const harness = createHarness({
    fetchResponse: async () => new Response("not html", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });

  await assert.rejects(
    harness.dispatchInstall(),
    /app shell response is not cacheable HTML/,
  );
  assert.equal(harness.stored.size, 0);
});

test("unversioned public resources bypass service-worker Cache Storage", () => {
  const harness = createHarness();

  for (const candidate of [
    request("/manifest.webmanifest", { destination: "manifest" }),
    request("/icons/bridge-192.svg", { destination: "image" }),
    request("/robots.txt"),
  ]) {
    assert.equal(harness.dispatchFetch(candidate), undefined);
  }

  assert.equal(harness.fetchCount(), 0);
  assert.equal(harness.stored.size, 0);
});

test("generic same-origin API traffic is never intercepted for caching", () => {
  const harness = createHarness();

  assert.equal(harness.dispatchFetch(request("/metrics")), undefined);
  assert.equal(harness.dispatchFetch(request("/ready")), undefined);
  assert.equal(harness.dispatchFetch(request("/api/future-endpoint")), undefined);
  assert.equal(harness.fetchCount(), 0);
  assert.equal(harness.stored.size, 0);
});

test("content-hashed Vite assets remain cache-first", async () => {
  const harness = createHarness();
  const asset = request("/assets/main.8f3a1c.js", { destination: "script" });

  const first = harness.dispatchFetch(asset);
  assert.ok(first, "immutable asset request should be intercepted");
  assert.equal(await (await first).text(), "network");
  assert.equal(harness.fetchCount(), 1);
  assert.ok(harness.stored.has(asset.url));

  const second = harness.dispatchFetch(asset);
  assert.ok(second, "cached immutable asset request should be intercepted");
  assert.equal(await (await second).text(), "network");
  assert.equal(harness.fetchCount(), 1, "cached immutable asset should avoid a second network fetch");
});

test("navigation stays network-first and refreshes the offline shell only with HTML", async () => {
  const harness = createHarness();
  const navigation = request("/receive?session=abc", { mode: "navigate" });

  const response = harness.dispatchFetch(navigation);
  assert.ok(response, "navigation should be intercepted");
  assert.equal(await (await response).text(), "network");
  assert.equal(harness.fetchCount(), 1);
  assert.ok(harness.stored.has("/"), "successful HTML navigation should refresh the root offline shell");

  const nonHtmlHarness = createHarness({
    fetchResponse: async () => new Response("maintenance", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }),
  });
  const nonHtmlResponse = nonHtmlHarness.dispatchFetch(navigation);
  assert.equal(await (await nonHtmlResponse).text(), "maintenance");
  assert.equal(nonHtmlHarness.stored.size, 0, "non-HTML navigation responses must not replace the offline shell");
});
