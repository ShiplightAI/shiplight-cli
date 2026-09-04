/**
 * Minimal MCP stdio client for smoke-testing the built server.
 *
 * Deliberately hand-rolled rather than using the MCP SDK's client: the point of
 * these tests is to verify the wire format the server actually emits. Going
 * through the SDK on both ends would hide a malformed frame that a real editor
 * client would choke on.
 *
 * The server is spawned as `node dist/index.js` — the shipped artifact, not the
 * TypeScript source — so the tests also cover the tsup bundle.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface JsonRpcError {
  code: number;
  message: string;
}

interface PendingRequest {
  resolve: (value: { result?: unknown; error?: JsonRpcError }) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export interface McpStdioClientOptions {
  serverPath: string;
  env?: Record<string, string>;
  /** Per-request timeout. */
  timeoutMs?: number;
}

export class McpStdioClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly timeoutMs: number;
  private nextId = 1;
  private stdoutBuffer = '';
  private stderrChunks: string[] = [];

  /**
   * stdout lines that were not parseable JSON-RPC.
   *
   * On a stdio transport stdout is the protocol channel: a single stray
   * console.log corrupts the stream and breaks every client. Tests assert this
   * stays empty.
   */
  readonly protocolViolations: string[] = [];

  private constructor(options: McpStdioClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.child = spawn(process.execPath, [options.serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...options.env },
    }) as ChildProcessWithoutNullStreams;

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => this.stderrChunks.push(chunk));
  }

  static async start(options: McpStdioClientOptions): Promise<McpStdioClient> {
    const client = new McpStdioClient(options);
    await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mcp-stdio-smoke', version: '0.0.0' },
    });
    client.notify('notifications/initialized');
    return client;
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) this.onLine(line);
    }
  }

  private onLine(line: string): void {
    let message: { id?: number; result?: unknown; error?: JsonRpcError; jsonrpc?: string };
    try {
      message = JSON.parse(line);
    } catch {
      // Anything non-JSON on stdout corrupts the transport.
      this.protocolViolations.push(line);
      return;
    }

    if (message.jsonrpc !== '2.0') {
      this.protocolViolations.push(line);
      return;
    }

    if (typeof message.id !== 'number') return; // server-initiated notification
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    pending.resolve({ result: message.result, error: message.error });
  }

  /** Sends a request and resolves with the raw envelope (result OR error). */
  private send(method: string, params?: unknown): Promise<{ result?: unknown; error?: JsonRpcError }> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${this.timeoutMs}ms. stderr: ${this.stderr()}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  /** Sends a request, failing if the server returns a JSON-RPC error. */
  async request(method: string, params?: unknown): Promise<Record<string, unknown>> {
    const { result, error } = await this.send(method, params);
    if (error) {
      throw new Error(`MCP "${method}" returned error ${error.code}: ${error.message}`);
    }
    return (result ?? {}) as Record<string, unknown>;
  }

  /** Sends a request expecting a JSON-RPC error, and returns it. */
  async requestExpectingError(method: string, params?: unknown): Promise<JsonRpcError> {
    const { error } = await this.send(method, params);
    if (!error) throw new Error(`MCP "${method}" unexpectedly succeeded`);
    return error;
  }

  notify(method: string, params?: unknown): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  stderr(): string {
    return this.stderrChunks.join('');
  }

  async close(): Promise<number | null> {
    for (const [, pending] of this.pending) clearTimeout(pending.timer);
    this.pending.clear();
    if (this.child.exitCode !== null) return this.child.exitCode;
    const exited = new Promise<number | null>((resolve) => {
      this.child.once('exit', (code) => resolve(code));
    });
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 5_000);
    const code = await exited;
    clearTimeout(timer);
    return code;
  }
}
