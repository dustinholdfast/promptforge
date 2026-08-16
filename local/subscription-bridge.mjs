import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4317;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_DIAGNOSTIC_CHARS = 8_000;

const jsonRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : null;
const finiteNumber = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export function mapCliModel(provider, model) {
  if (provider === "openai") {
    return (
      {
        "gpt-5.6": "gpt-5.6-sol",
        "gpt-5.6-sol": "gpt-5.6-sol",
        "gpt-5.6-terra": "gpt-5.6-terra",
        "gpt-5.6-luna": "gpt-5.6-luna",
      }[model] ?? model
    );
  }
  return (
    {
      "claude-sonnet-5": "sonnet",
      "claude-opus-5": "opus",
      "claude-haiku-4-5": "haiku",
    }[model] ?? model
  );
}

export function buildCodexPrompt(systemPrompt, prompt, maxTokens) {
  const system = systemPrompt.trim();
  return [
    "Generate the requested content directly. Do not inspect files or run commands.",
    `Keep the response within approximately ${maxTokens} output tokens.`,
    system ? `<system_instructions>\n${system}\n</system_instructions>` : "",
    `<user_prompt>\n${prompt}\n</user_prompt>`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function decodeCodexLine(payload) {
  const event = jsonRecord(payload);
  if (!event) return [];
  if (event.type === "item.completed") {
    const item = jsonRecord(event.item);
    return item?.type === "agent_message" && typeof item.text === "string" && item.text
      ? [{ type: "text", text: item.text }]
      : [];
  }
  if (event.type === "turn.completed") {
    const usage = jsonRecord(event.usage);
    return usage
      ? [
          {
            type: "usage",
            inputTokens: finiteNumber(usage.input_tokens),
            outputTokens: finiteNumber(usage.output_tokens),
          },
        ]
      : [];
  }
  if (event.type === "error") {
    throw new Error(String(event.message ?? "Codex execution failed."));
  }
  return [];
}

export function decodeClaudeLine(payload) {
  const message = jsonRecord(payload);
  if (!message) return [];
  if (message.type === "stream_event") {
    const event = jsonRecord(message.event);
    const delta = jsonRecord(event?.delta);
    if (event?.type === "content_block_delta" && delta?.type === "text_delta" && typeof delta.text === "string") {
      return delta.text ? [{ type: "text", text: delta.text }] : [];
    }
  }
  if (message.type === "result") {
    if (message.is_error === true || message.subtype === "error") {
      throw new Error(String(message.result ?? "Claude execution failed."));
    }
    const usage = jsonRecord(message.usage);
    return usage
      ? [
          {
            type: "usage",
            inputTokens: finiteNumber(usage.input_tokens),
            outputTokens: finiteNumber(usage.output_tokens),
          },
        ]
      : [];
  }
  return [];
}

function commandSummary(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  if (result.error) return { ready: false, detail: result.error.message };
  const raw = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  let detail = raw.split(/\r?\n/, 1)[0] ?? "";
  if (command === "claude") {
    try {
      const auth = JSON.parse(result.stdout ?? "");
      detail = [auth.authMethod, auth.subscriptionType].filter(Boolean).join(" / ");
    } catch {
      detail = result.status === 0 ? "Authenticated" : detail;
    }
  }
  return { ready: result.status === 0, detail: detail.slice(0, 200) };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function validateGenerateInput(value) {
  const body = jsonRecord(value);
  if (!body || !["openai", "anthropic"].includes(body.provider)) {
    throw new Error("provider must be openai or anthropic.");
  }
  if (typeof body.model !== "string" || !body.model.trim()) throw new Error("model is required.");
  if (typeof body.prompt !== "string" || !body.prompt.trim()) throw new Error("prompt is required.");
  return {
    provider: body.provider,
    model: body.model.trim(),
    systemPrompt: typeof body.systemPrompt === "string" ? body.systemPrompt : "",
    prompt: body.prompt,
    maxTokens: Math.min(32_000, Math.max(256, Math.round(finiteNumber(body.maxTokens) || 2_000))),
  };
}

async function generate(request, response, input) {
  const cliModel = mapCliModel(input.provider, input.model);
  const codexPrompt = buildCodexPrompt(input.systemPrompt, input.prompt, input.maxTokens);
  const command = input.provider === "openai" ? "codex" : "claude";
  const args =
    input.provider === "openai"
      ? [
          "exec",
          "--json",
          "--ephemeral",
          "--sandbox",
          "read-only",
          "--skip-git-repo-check",
          "--ignore-user-config",
          "--ignore-rules",
          "--model",
          cliModel,
          "-",
        ]
      : [
          "-p",
          "--output-format",
          "stream-json",
          "--verbose",
          "--include-partial-messages",
          "--model",
          cliModel,
          "--tools",
          "",
          "--safe-mode",
          "--no-session-persistence",
          "--disable-slash-commands",
          ...(input.systemPrompt.trim() ? ["--system-prompt", input.systemPrompt.trim()] : []),
        ];

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  let ended = false;
  let stderr = "";
  let streamError = "";
  const child = spawn(command, args, {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const send = (payload) => {
    if (!ended && !response.destroyed) response.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const stop = () => {
    if (!ended && child.exitCode === null) child.kill();
  };
  request.once("aborted", stop);
  response.once("close", stop);

  const decoder = input.provider === "openai" ? decodeCodexLine : decodeClaudeLine;
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    try {
      const payload = JSON.parse(line);
      for (const event of decoder(payload)) send(event);
    } catch (error) {
      if (error instanceof SyntaxError) return;
      streamError = error instanceof Error ? error.message : "Subscription CLI failed.";
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-MAX_DIAGNOSTIC_CHARS);
  });

  child.stdin.end(input.provider === "openai" ? codexPrompt : input.prompt);
  const heartbeat = setInterval(() => {
    if (!response.destroyed) response.write(": keep-alive\n\n");
  }, 15_000);

  await new Promise((resolve) => {
    child.once("error", (error) => {
      streamError = `Could not start ${command}: ${error.message}`;
      resolve();
    });
    child.once("close", (code) => {
      if (code !== 0 && !streamError) {
        streamError = stderr.trim() || `${command} exited with code ${code}.`;
      }
      resolve();
    });
  });

  clearInterval(heartbeat);
  ended = true;
  if (streamError && !response.destroyed) sendJsonEvent(response, { type: "error", message: streamError.slice(0, 2_000) });
  if (!response.destroyed) response.end();
}

function sendJsonEvent(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function startSubscriptionBridge({ host = DEFAULT_HOST, port = DEFAULT_PORT } = {}) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        providers: {
          openai: commandSummary("codex", ["login", "status"]),
          anthropic: commandSummary("claude", ["auth", "status"]),
        },
      });
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/generate") {
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    try {
      const input = validateGenerateInput(JSON.parse(await readBody(request)));
      await generate(request, response, input);
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : "Invalid request." });
      } else if (!response.destroyed) {
        sendJsonEvent(response, { type: "error", message: error instanceof Error ? error.message : "Generation failed." });
        response.end();
      }
    }
  });
  server.listen(port, host, () => {
    process.stdout.write(`PromptForge subscription bridge listening on http://${host}:${port}\n`);
  });
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PROMPTFORGE_BRIDGE_PORT || DEFAULT_PORT);
  startSubscriptionBridge({ port });
}
