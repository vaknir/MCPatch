export interface DraftRegisteredTool {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema?: unknown;
  readonly window: unknown;
  readonly origin: string;
  readonly annotations?: unknown;
}

export interface DraftModelContext {
  addEventListener(type: "toolchange", listener: () => void): void;
  removeEventListener(type: "toolchange", listener: () => void): void;
  getTools(): Promise<unknown>;
  executeTool(
    tool: DraftRegisteredTool,
    input: unknown,
    options: { readonly signal: AbortSignal },
  ): Promise<unknown>;
}

export interface DraftWebMcpDocument {
  readonly modelContext?: unknown;
}
