import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

interface JsonRpcResponse {
  readonly id: number;
  readonly result?: unknown;
  readonly error?: unknown;
}

interface PendingResponse {
  readonly reject: (error: Error) => void;
  readonly resolve: (response: JsonRpcResponse) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export interface StartedRequest {
  readonly id: number;
  readonly response: Promise<JsonRpcResponse>;
}

export class McpStdioClient {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #forbiddenLogFragments: readonly string[];
  readonly #pending = new Map<number, PendingResponse>();
  readonly #stderr: string[] = [];
  #nextId = 1;

  private constructor(
    binary: string,
    forbiddenLogFragments: readonly string[],
  ) {
    this.#forbiddenLogFragments = Object.freeze([...forbiddenLogFragments]);
    this.#child = spawn(binary, ["mcp-stdio"], {
      env: { ...process.env, MCPATCH_LOG: "info", RUST_LOG: "info" },
      stdio: "pipe",
    });
    createInterface({ input: this.#child.stdout }).on("line", (line) => {
      this.#receive(line);
    });
    this.#child.stderr.setEncoding("utf8");
    this.#child.stderr.on("data", (chunk: string) => this.#stderr.push(chunk));
    this.#child.once("error", (error) => this.#failAll(error));
    this.#child.once("exit", (code, signal) => {
      if (this.#pending.size > 0) {
        this.#failAll(
          new Error(
            `MCP stdio exited early (${String(code)}/${String(signal)})`,
          ),
        );
      }
    });
  }

  static async connect(
    binary: string,
    forbiddenLogFragments: readonly string[] = [],
  ): Promise<McpStdioClient> {
    const client = new McpStdioClient(binary, forbiddenLogFragments);
    const initialized = await client.request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "mcpatch-chromium-fixture", version: "0.1.0" },
    });
    if (initialized.error !== undefined) {
      throw new Error("MCP initialize failed");
    }
    client.notify("notifications/initialized", {});
    return client;
  }

  async listTools(): Promise<readonly unknown[]> {
    const response = await this.request("tools/list", {});
    const result = dataObject(response.result);
    const tools = result?.["tools"];
    if (response.error !== undefined || !Array.isArray(tools)) {
      throw new Error("MCP tools/list failed");
    }
    return tools;
  }

  callTool(
    name: string,
    arguments_: Record<string, unknown> = {},
    timeoutMs = 5_000,
  ): StartedRequest {
    return this.startRequest(
      "tools/call",
      { name, arguments: arguments_ },
      name,
      timeoutMs,
    );
  }

  cancel(requestId: number): void {
    this.notify("notifications/cancelled", {
      requestId,
      reason: "chromium fixture cancellation",
    });
    // MCP cancellation is terminal and the server is not required to answer the
    // cancelled request. Retire the local waiter after the notification.
    const pending = this.#pending.get(requestId);
    if (pending !== undefined) {
      this.#pending.delete(requestId);
      clearTimeout(pending.timeout);
      pending.resolve({ id: requestId });
    }
  }

  async close(): Promise<void> {
    this.#child.stdin.end();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const exited = new Promise<void>((resolve, reject) => {
      this.#child.once("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`MCP stdio exited with ${String(code)}`));
      });
      this.#child.once("error", reject);
    });
    try {
      await Promise.race([
        exited,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("MCP stdio close timed out")),
            5_000,
          );
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
    const stderr = this.#stderr.join("");
    for (const secret of [
      "initial",
      "updated",
      "fixture.current_state",
      "fixture.wait",
      ...this.#forbiddenLogFragments,
    ]) {
      if (stderr.includes(secret)) {
        throw new Error("MCP logs contain fixture capability data");
      }
    }
  }

  request(method: string, params: unknown): Promise<JsonRpcResponse> {
    return this.startRequest(method, params).response;
  }

  startRequest(
    method: string,
    params: unknown,
    label = method,
    timeoutMs = 5_000,
  ): StartedRequest {
    const id = this.#nextId++;
    const response = new Promise<JsonRpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`MCP ${label} response timed out`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timeout });
    });
    this.#write({ jsonrpc: "2.0", id, method, params });
    return { id, response };
  }

  notify(method: string, params: unknown): void {
    this.#write({ jsonrpc: "2.0", method, params });
  }

  #write(value: unknown): void {
    this.#child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  #receive(line: string): void {
    let response: unknown;
    try {
      response = JSON.parse(line);
    } catch {
      this.#failAll(new Error("MCP stdout contained malformed JSON"));
      return;
    }
    const object = dataObject(response);
    const id = object?.["id"];
    if (typeof id !== "number" || !Number.isSafeInteger(id)) return;
    const pending = this.#pending.get(id);
    if (pending === undefined) return;
    this.#pending.delete(id);
    clearTimeout(pending.timeout);
    pending.resolve(response as JsonRpcResponse);
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

export function structuredContent(response: JsonRpcResponse): unknown {
  const result = dataObject(response.result);
  if (response.error !== undefined || result?.["isError"] === true) {
    throw new Error("MCP tool call returned an error");
  }
  return result?.["structuredContent"];
}

export function mcpImageContent(response: JsonRpcResponse): {
  readonly data: string;
  readonly mimeType: string;
} {
  const result = dataObject(response.result);
  const content = result?.["content"];
  if (
    response.error !== undefined ||
    result?.["isError"] === true ||
    !Array.isArray(content)
  ) {
    throw new Error("MCP tool call did not return content");
  }
  const images = content
    .map(dataObject)
    .filter((item) => item?.["type"] === "image");
  if (images.length !== 1) {
    throw new Error("MCP tool call did not return exactly one image");
  }
  const image = images[0];
  if (
    image === undefined ||
    typeof image["data"] !== "string" ||
    typeof image["mimeType"] !== "string"
  ) {
    throw new Error("MCP image content is malformed");
  }
  return { data: image["data"], mimeType: image["mimeType"] };
}

function dataObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
