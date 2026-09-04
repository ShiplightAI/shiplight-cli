/**
 * Simplified WebDriverAgent Client
 * Basic HTTP client for iOS WebDriverAgent communication
 */

import axios, { type AxiosInstance } from 'axios';

export interface WDAClientOptions {
  host?: string;
  port?: number;
  deviceId?: string;
}

export class WDAClient {
  private baseURL: string;
  private client: AxiosInstance;
  private sessionId: string | null = null;

  constructor(options: WDAClientOptions = {}) {
    const host = options.host || 'localhost';
    const port = options.port || 8100;
    this.baseURL = `http://${host}:${port}`;

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async createSession(): Promise<void> {
    try {
      const response = await this.client.post('/session', {
        capabilities: {
          alwaysMatch: {},
        },
      });

      this.sessionId = response.data.value.sessionId || response.data.sessionId;
    } catch (error: any) {
      throw new Error(`Failed to create WDA session: ${error.message}`);
    }
  }

  async deleteSession(): Promise<void> {
    if (!this.sessionId) return;

    try {
      await this.client.delete(`/session/${this.sessionId}`);
      this.sessionId = null;
    } catch (error) {
      // Ignore errors when deleting session
    }
  }

  async takeScreenshot(): Promise<string> {
    this.ensureSession();

    try {
      const response = await this.client.get(`/session/${this.sessionId}/screenshot`);
      return response.data.value;
    } catch (error: any) {
      throw new Error(`Failed to take screenshot: ${error.message}`);
    }
  }

  async getWindowSize(): Promise<{ width: number; height: number; scale: number }> {
    this.ensureSession();

    try {
      const response = await this.client.get(`/session/${this.sessionId}/window/size`);
      const { width, height } = response.data.value;

      // Get device scale
      const statusResponse = await this.client.get('/status');
      const scale = statusResponse.data.value?.ios?.scale || 1;

      return { width, height, scale };
    } catch (error: any) {
      throw new Error(`Failed to get window size: ${error.message}`);
    }
  }

  async tap(x: number, y: number): Promise<void> {
    this.ensureSession();

    try {
      await this.client.post(`/session/${this.sessionId}/wda/tap/0`, {
        x,
        y,
      });
    } catch (error: any) {
      throw new Error(`Failed to tap at (${x}, ${y}): ${error.message}`);
    }
  }

  async doubleTap(x: number, y: number): Promise<void> {
    this.ensureSession();

    try {
      await this.client.post(`/session/${this.sessionId}/wda/doubleTap`, {
        x,
        y,
      });
    } catch (error: any) {
      throw new Error(`Failed to double tap at (${x}, ${y}): ${error.message}`);
    }
  }

  async longPress(x: number, y: number, duration: number = 1000): Promise<void> {
    this.ensureSession();

    try {
      await this.client.post(`/session/${this.sessionId}/wda/touchAndHold`, {
        x,
        y,
        duration: duration / 1000, // WDA expects duration in seconds
      });
    } catch (error: any) {
      throw new Error(`Failed to long press at (${x}, ${y}): ${error.message}`);
    }
  }

  async swipe(fromX: number, fromY: number, toX: number, toY: number, duration: number = 500): Promise<void> {
    this.ensureSession();

    try {
      await this.client.post(`/session/${this.sessionId}/wda/dragfromtoforduration`, {
        fromX,
        fromY,
        toX,
        toY,
        duration: duration / 1000, // WDA expects duration in seconds
      });
    } catch (error: any) {
      throw new Error(`Failed to swipe: ${error.message}`);
    }
  }

  async typeText(text: string): Promise<void> {
    this.ensureSession();

    try {
      await this.client.post(`/session/${this.sessionId}/wda/keys`, {
        value: [text],
      });
    } catch (error: any) {
      throw new Error(`Failed to type text: ${error.message}`);
    }
  }

  async pressKey(key: string): Promise<void> {
    this.ensureSession();

    try {
      await this.client.post(`/session/${this.sessionId}/wda/keys`, {
        value: [key],
      });
    } catch (error: any) {
      throw new Error(`Failed to press key: ${error.message}`);
    }
  }

  async pressHomeButton(): Promise<void> {
    this.ensureSession();

    try {
      await this.client.post(`/session/${this.sessionId}/wda/pressButton`, {
        name: 'home',
      });
    } catch (error: any) {
      throw new Error(`Failed to press home button: ${error.message}`);
    }
  }

  private ensureSession(): void {
    if (!this.sessionId) {
      throw new Error('WDA session not initialized. Call createSession() first.');
    }
  }
}
