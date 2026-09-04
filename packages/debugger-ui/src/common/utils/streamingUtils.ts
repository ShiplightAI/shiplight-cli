/**
 * Generic event callback type for streaming events
 */
export type StreamEventCallback<T = any> = (event: T) => void;

/**
 * Options for client-side streaming requests
 */
export interface StreamingRequestOptions {
  method?: string;
  body?: any;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Client-side utility to handle Server-Sent Events (SSE) parsing
 * Abstracts the common pattern of reading response body, parsing lines, and handling events
 * The stream will continue until the server closes the connection
 */
export async function parseSSEStream<T = any>(
  response: Response,
  onEvent: StreamEventCallback<T>
): Promise<void> {
  if (!response.body) {
    throw new Error('Response body is null');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

      for (const line of lines) {
        let event: T | null = null;

        if (line.startsWith('data: ')) {
          try {
            const eventData = line.slice(6); // Remove 'data: ' prefix
            if (eventData.trim()) {
              event = JSON.parse(eventData) as T;
            }
          } catch (parseError) {
            console.error(`Failed to parse SSE event: ${line}`, parseError);
            continue;
          }
        }

        if (event) {
          onEvent(event);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Client-side utility to make streaming HTTP requests
 * Combines fetch with SSE parsing in a reusable way
 */
export async function makeStreamingRequest<T = any>(
  url: string,
  onEvent: StreamEventCallback<T>,
  options: StreamingRequestOptions = {}
): Promise<void> {
  const {
    method = 'POST',
    body,
    params,
    headers = {},
    signal,
  } = options;

  // Construct URL with params if provided
  let fullUrl = url;
  if (params) {
    const searchParams = new URLSearchParams(params);
    fullUrl += `?${searchParams.toString()}`;
  }

  const response = await fetch(fullUrl, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!response.ok) {
    throw new Error(`Streaming request failed: ${response.statusText || `HTTP ${response.status}`}`);
  }

  return parseSSEStream(response, onEvent);
}

/**
 * Client-side utility specifically for authenticated streaming requests
 * Includes authorization header and base URL handling
 */
export async function makeAuthenticatedStreamingRequest<T = any>(
  accessToken: string,
  endpoint: string,
  onEvent: StreamEventCallback<T>,
  options: StreamingRequestOptions & { baseURL?: string } = {}
): Promise<void> {
  const { baseURL, headers = {}, ...restOptions } = options;

  const url = baseURL ? `${baseURL}${endpoint}` : endpoint;

  return makeStreamingRequest<T>(url, onEvent, {
    ...restOptions,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...headers,
    },
  });
}

/**
 * Server-side utility for writing SSE events
 * Abstracts the common pattern of writing SSE formatted data
 */
export function writeSSEEvent(res: any, event: any): boolean {
  try {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    return true;
  } catch (error) {
    console.error('Error writing SSE event:', error);
    return false;
  }
}

/**
 * Server-side utility to set up SSE response headers
 */
export function setupSSEHeaders(res: any): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });
}

/**
 * Server-side utility to handle SSE streaming with automatic cleanup
 * The server application logic should call res.end() when appropriate to close the stream
 */
export async function handleSSEStreaming<T>(
  req: any,
  res: any,
  streamFunction: (writeEvent: (event: T) => void) => Promise<void>
): Promise<void> {
  setupSSEHeaders(res);

  // Handle client disconnect
  const cleanup = () => {
    console.log('Client disconnected from SSE stream');
  };

  req.on('close', cleanup);
  req.on('aborted', cleanup);

  const writeEvent = (event: T) => {
    return writeSSEEvent(res, event);
  };

  try {
    await streamFunction(writeEvent);
    // Close the stream after successful completion
    res.end();
  } catch (error) {
    console.error('Error in SSE stream:', error);

    // Send error event and close stream
    // Use data.error to match frontend expectations (AgentStepEventTypes.Error)
    const errorEvent = {
      type: 'error',
      data: {
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    };

    writeSSEEvent(res, errorEvent);
    res.end();
  }
}