const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../app.js"), "utf8");
const functionStart = source.indexOf("function combineAbortSignals");
const functionEnd = source.indexOf("function createAbortError", functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart, "client timeout helpers should exist");

const context = {
  AbortController,
  Promise,
  setTimeout,
  clearTimeout,
  window: {
    setTimeout,
    clearTimeout
  }
};
vm.createContext(context);
vm.runInContext(
  `${source.slice(functionStart, functionEnd)}\nthis.withAbortableRequestTimeout = withAbortableRequestTimeout;`,
  context
);

(async () => {
  const startedAt = Date.now();
  await assert.rejects(
    context.withAbortableRequestTimeout(() => new Promise(() => {}), 25),
    (error) => error?.name === "TimeoutError"
  );
  assert.ok(Date.now() - startedAt < 500, "a request that ignores abort must still time out");

  const result = await context.withAbortableRequestTimeout(() => Promise.resolve("ok"), 100);
  assert.equal(result, "ok");
  console.log("Client grading timeout tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
