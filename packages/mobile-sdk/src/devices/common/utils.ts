/**
 * Common utility functions for mobile device automation
 */

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create base64 data URL from buffer
 */
export function createBase64Image(buffer: Buffer, format: 'png' | 'jpg' = 'png'): string {
  return `data:image/${format};base64,${buffer.toString('base64')}`;
}

/**
 * Extract base64 data from data URL
 */
export function extractBase64Data(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/\w+;base64,/, '');
}

/**
 * Generate unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Validate if buffer is a valid PNG image
 */
export function isValidPNGBuffer(buffer: Buffer): boolean {
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

/**
 * Coordinate adjustment for scaling
 */
export class CoordinateAdjuster {
  constructor(private scalingRatio: number = 1) {}

  adjust(x: number, y: number): { x: number; y: number } {
    return {
      x: Math.round(x / this.scalingRatio),
      y: Math.round(y / this.scalingRatio),
    };
  }

  setScalingRatio(ratio: number): void {
    this.scalingRatio = ratio;
  }
}
