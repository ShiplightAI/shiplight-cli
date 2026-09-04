/**
 * Generic event callback type for streaming events
 */
export type StreamEventCallback<T = any> = (event: T) => void;

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
