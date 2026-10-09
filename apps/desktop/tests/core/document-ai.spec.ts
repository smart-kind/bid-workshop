import { copyFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  selectSidePanel,
} from "../helpers/electron-app";

const repoRoot = resolve(__dirname, "../../../..");
/** The committed sample bid, opened from the workspace file tree. */
const SAMPLE_FILE = "投标文件-某软件科技.docx";
const sampleBidSource = join(repoRoot, "workspaces", "bid-sample", SAMPLE_FILE);

/** The only thing the stub model says. The panel can show it only if the whole chain ran. */
const REPLY = "Stub model reply.";

interface StubProvider {
  /** what a model would be pointed at; this is the shell's own provider configuration */
  readonly baseUrl: string;
  readonly requests: () => readonly { model?: string; authorization?: string }[];
  readonly close: () => Promise<void>;
}

/**
 * A local OpenAI-compatible endpoint standing in for the model. Nothing leaves
 * the machine, and every request it answers is evidence that the shell resolved
 * a provider, signed the request with its key, and streamed the answer back.
 */
async function startStubProvider(): Promise<StubProvider> {
  const seen: { model?: string; authorization?: string }[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
        model?: string;
      };
      seen.push({ model: body.model, authorization: request.headers.authorization });
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: REPLY } }] })}\n\n`);
      response.write(
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
      );
      response.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests: () => seen,
    close: () =>
      new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      }),
  };
}

/** The hosted document view is a WebContentsView; Playwright exposes it as its own page. */
async function waitForDocumentView(app: ElectronApplication, timeoutMs = 30_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = app.windows().find((candidate) => candidate.url().startsWith("bid-docs://"));
    if (page) return page;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  const urls = app.windows().map((candidate) => candidate.url() || "<empty>");
  throw new Error(`No document view appeared (windows: ${urls.join(", ") || "<none>"})`);
}

test("the editor's AI panel answers from the shell's own provider configuration", async () => {
  test.setTimeout(120_000);
  const provider = await startStubProvider();
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("document-ai-workspace");
  await copyFile(sampleBidSource, join(workspacePath, SAMPLE_FILE));
  // The agent dir is the shell's one model configuration; the editor's panel is
  // served from it rather than from a provider store of its own.
  await seedAgentDir(agentDir, { enabledModels: [] });
  await writeFile(
    join(agentDir, "models.json"),
    `${JSON.stringify(
      {
        providers: {
          openai: {
            baseUrl: provider.baseUrl,
            api: "openai-completions",
            apiKey: "stub-provider-key",
            models: [{ id: "stub-model", name: "Stub Model" }],
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Document AI session");
    await selectSidePanel(window, "Files");
    const tree = window.getByTestId("file-workbench-tree");
    const sampleRow = tree.locator(
      `.file-workbench__tree-row--file[data-file-path="${SAMPLE_FILE}"]`,
    );
    await expect(sampleRow).toBeVisible({ timeout: 15_000 });
    await sampleRow.click();

    // --- the panel is live in the document view and the turn reaches the stub ---
    const documentView = await waitForDocumentView(harness.electronApp);
    const composer = documentView.locator(".ai-input-box textarea");
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.fill("请回答一句测试话术");
    await documentView.locator(".ai-input-box .ai-send-btn").click();
    await expect(documentView.locator(".ai-msg-assistant")).toContainText(REPLY, {
      timeout: 30_000,
    });

    // The reply is only reachable if the shell resolved the provider from the
    // agent dir, signed with its key, and streamed the chunks back to the panel.
    expect(provider.requests()).toEqual([
      { model: "stub-model", authorization: "Bearer stub-provider-key" },
    ]);
  } finally {
    await harness.close();
    await provider.close();
  }
});
