import { mkdir, mkdtemp, readdir, readFile, realpath, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { ArtifactStoreOwner, type ArtifactRunRef } from "../../electron/artifacts/artifact-store";

async function makeDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function makeStore(limits?: {
  maxRunsPerWorkspace: number;
  maxBytesPerWorkspace: number;
}): Promise<{ store: ArtifactStoreOwner; userData: string }> {
  const userData = await makeDir("artifact-userdata-");
  return { store: new ArtifactStoreOwner(userData, limits), userData };
}

function ref(workspacePath: string, sessionId: string, runId: string): ArtifactRunRef {
  return { workspacePath, sessionId, runId };
}

/** Seed a run, optionally finishing it, and give its directory a distinct age. */
async function seed(
  store: ArtifactStoreOwner,
  run: ArtifactRunRef,
  payload: string,
  minutesAgo: number,
  complete = true,
): Promise<void> {
  await store.writeArtifact(run, "payload.txt", payload);
  if (complete) await store.markRunComplete(run);
  const when = new Date(Date.now() - minutesAgo * 60_000);
  await utimes(await store.runDirectory(run), when, when);
}

test("derives a stable workspace key from the real path", async () => {
  const { store } = await makeStore();
  const workspace = await makeDir("artifact-workspace-");

  const key = await store.keyFor(workspace);

  expect(key).toMatch(/^[0-9a-f]{16}$/);
  expect(await store.keyFor(workspace)).toBe(key);
  expect(await store.keyFor(await realpath(workspace))).toBe(key);
  expect(await store.workspacePathFor(key)).toBe(await realpath(workspace));
});

test("keeps two workspaces from seeing each other", async () => {
  const { store } = await makeStore();
  const first = await makeDir("artifact-first-");
  const second = await makeDir("artifact-second-");
  const run = (workspacePath: string): ArtifactRunRef => ref(workspacePath, "session-1", "run-1");

  await store.writeArtifact(run(first), "parsed.txt", "first");
  await store.writeArtifact(run(second), "parsed.txt", "second");

  expect((await store.readArtifact(run(first), "parsed.txt"))?.toString()).toBe("first");
  expect((await store.readArtifact(run(second), "parsed.txt"))?.toString()).toBe("second");
  expect(await store.keyFor(first)).not.toBe(await store.keyFor(second));
});

test("reads back a named artifact and isolates each run", async () => {
  const { store } = await makeStore();
  const workspace = await makeDir("artifact-workspace-");
  const run = ref(workspace, "session-1", "run-1");

  await store.writeArtifact(run, "docx/text.txt", "正文");
  await store.writeArtifact(run, "trace.json", "{}");
  await store.markRunComplete(run);

  const entries = await store.listRun(run);
  expect(entries.map((entry) => entry.name)).toEqual(["docx/text.txt", "trace.json"]);
  expect(entries.find((entry) => entry.name === "docx/text.txt")?.bytes).toBeGreaterThan(0);
  expect(await store.readArtifact(run, "missing.txt")).toBeUndefined();
  expect(await store.listRun(ref(workspace, "session-1", "run-2"))).toEqual([]);
});

test("refuses artifact paths that climb out of the run directory", async () => {
  const { store } = await makeStore();
  const workspace = await makeDir("artifact-workspace-");
  const run = ref(workspace, "session-1", "run-1");

  await expect(store.writeArtifact(run, "../escape.txt", "x")).rejects.toThrow(
    /Invalid artifact name/,
  );
  await expect(store.writeArtifact(run, "", "x")).rejects.toThrow(/Invalid artifact name/);
  await expect(store.writeArtifact(ref(workspace, "..", "run-1"), "x.txt", "x")).rejects.toThrow(
    /Invalid sessionId/,
  );
  await expect(
    store.writeArtifact(ref(workspace, "session-1", "a/b"), "x.txt", "x"),
  ).rejects.toThrow(/Invalid runId/);
});

test("cleanup keeps the newest completed runs and never removes an unfinished one", async () => {
  const { store } = await makeStore({ maxRunsPerWorkspace: 2, maxBytesPerWorkspace: 1_000_000 });
  const workspace = await makeDir("artifact-workspace-");
  const oldest = ref(workspace, "session-1", "run-oldest");
  const middle = ref(workspace, "session-1", "run-middle");
  const newest = ref(workspace, "session-1", "run-newest");
  const unfinished = ref(workspace, "session-1", "run-unfinished");

  await seed(store, oldest, "oldest", 30);
  await seed(store, middle, "middle", 20);
  await seed(store, newest, "newest", 10);
  await seed(store, unfinished, "still running", 40, false);

  const result = await store.cleanup(workspace);

  expect(result.removedRuns).toEqual(["session-1/run-oldest"]);
  expect(result.retainedRuns).toEqual([
    "session-1/run-middle",
    "session-1/run-newest",
    "session-1/run-unfinished",
  ]);
  expect(await store.readArtifact(oldest, "payload.txt")).toBeUndefined();
  expect((await store.readArtifact(middle, "payload.txt"))?.toString()).toBe("middle");
  expect((await store.readArtifact(unfinished, "payload.txt"))?.toString()).toBe("still running");
});

test("cleanup trims the oldest completed runs to stay under the byte cap", async () => {
  const { store } = await makeStore({ maxRunsPerWorkspace: 10, maxBytesPerWorkspace: 150 });
  const workspace = await makeDir("artifact-workspace-");
  const oldest = ref(workspace, "session-1", "run-oldest");
  const newest = ref(workspace, "session-1", "run-newest");

  await seed(store, oldest, "a".repeat(100), 30);
  await seed(store, newest, "b".repeat(100), 10);

  const result = await store.cleanup(workspace);

  expect(result.removedRuns).toEqual(["session-1/run-oldest"]);
  expect((await store.readArtifact(newest, "payload.txt"))?.byteLength).toBe(100);
});

test("cleanup leaves visible products and everything else untouched", async () => {
  const { store, userData } = await makeStore({ maxRunsPerWorkspace: 0, maxBytesPerWorkspace: 0 });
  const workspace = await makeDir("artifact-workspace-");
  const product = join(workspace, "投标文件-批注.docx");
  await writeFile(product, "visible product");
  const outside = join(userData, "artifacts-sentinel.txt");
  await writeFile(outside, "keep me");
  await seed(store, ref(workspace, "session-1", "run-1"), "internal", 5);

  await store.cleanup(workspace);

  expect(await readFile(product, "utf8")).toBe("visible product");
  expect(await readFile(outside, "utf8")).toBe("keep me");
});

test("preserves and rebuilds a corrupt index instead of failing", async () => {
  const { store, userData } = await makeStore();
  const workspace = await makeDir("artifact-workspace-");
  await mkdir(join(userData, "artifacts"), { recursive: true });
  const indexPath = join(userData, "artifacts", "workspaces.json");
  await writeFile(indexPath, "{ not json");

  const key = await store.keyFor(workspace);

  expect(key).toMatch(/^[0-9a-f]{16}$/);
  const index = JSON.parse(await readFile(indexPath, "utf8")) as Record<string, string>;
  expect(index[key]).toBe(await realpath(workspace));
  const preserved = (await readdir(join(userData, "artifacts"))).find((name) =>
    name.startsWith("workspaces.json.corrupt-"),
  );
  expect(preserved).toBeDefined();
  expect(await readFile(join(userData, "artifacts", preserved ?? ""), "utf8")).toBe("{ not json");
});
