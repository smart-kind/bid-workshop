import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  writeProjectExtension,
} from "../helpers/electron-app";

const extensionSource = String.raw`
export default function askExtension(pi) {
  pi.registerCommand("ask-timeout", {
    description: "Ask a question that times out",
    handler: async (_args, ctx) => {
      const confirmed = await ctx.ui.confirm("Ship the draft?", "Nobody answers this.", {
        timeout: 2_000,
      });
      ctx.ui.notify(confirmed ? "Ask answered yes" : "Ask answered no", "info");
    },
  });

  pi.registerCommand("ask-open", {
    description: "Ask a question that waits for an answer",
    handler: async (_args, ctx) => {
      const confirmed = await ctx.ui.confirm("Keep waiting?", "This one has no timeout.");
      ctx.ui.notify(confirmed ? "Ask answered yes" : "Ask answered no", "info");
    },
  });
}
`;

async function launchWithAskExtension(name: string) {
  const workspacePath = await makeWorkspace(name);
  await writeProjectExtension(workspacePath, "ask-extension.ts", extensionSource);
  const harness = await launchDesktop(await makeUserDataDir(), {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  const window = await harness.firstWindow();
  return { harness, window };
}

test("a question nobody answers says so instead of vanishing, and is not re-asked", async () => {
  test.setTimeout(60_000);
  const { harness, window } = await launchWithAskExtension("ask-timeout");
  try {
    await createNamedThread(window, "Ask timeout");
    const composer = window.getByTestId("composer");
    await composer.fill("/ask-timeout ");
    await composer.press("Enter");

    const dialog = window.getByTestId("extension-dialog");
    await expect(dialog).toContainText("Ship the draft?");
    // The card settles on its own; the user is told why and nothing was chosen.
    await expect(dialog).toHaveCount(0, { timeout: 8_000 });
    await expect(window.getByTestId("extension-notices")).toContainText(
      "A question went unanswered and timed out. Nothing was chosen for you.",
    );
    await expect(window.getByTestId("extension-notices")).toContainText("Ask answered no");
    // No replay: the prompt does not come back with the answer the user never gave.
    await expect(dialog).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

test("an open question does not block closing the window", async () => {
  test.setTimeout(60_000);
  const { harness, window } = await launchWithAskExtension("ask-window-close");
  await createNamedThread(window, "Ask close");
  const composer = window.getByTestId("composer");
  await composer.fill("/ask-open ");
  await composer.press("Enter");
  await expect(window.getByTestId("extension-dialog")).toContainText("Keep waiting?");

  // Closing with a prompt still open must settle it, not wait on it.
  await harness.close();
});
