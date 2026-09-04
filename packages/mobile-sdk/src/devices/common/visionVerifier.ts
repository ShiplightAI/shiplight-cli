/**
 * Vision-based verification using AI
 * Uses Gemini to analyze screenshots and verify conditions
 */

import { GoogleGenAI } from '@google/genai';

export interface VerificationResult {
  verified: boolean;
  confidence: number; // 0-1
  reasoning: string;
}

export class VisionVerifier {
  private genAI: GoogleGenAI;
  private model: string;

  constructor(options?: {
    apiKey?: string;
    model?: string;
  }) {
    const apiKey = options?.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required for vision verification');
    }

    this.genAI = new GoogleGenAI({
      vertexai: process.env.GOOGLE_GENAI_USE_VERTEXAI === 'True',
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION
    });

    this.model = options?.model || 'gemini-2.0-flash-exp';
  }

  /**
   * Verify a condition on a screenshot using vision AI
   */
  async verify(screenshot: string, condition: string): Promise<VerificationResult> {
    try {
      // Remove data URI prefix if present
      const base64Image = screenshot.replace(/^data:image\/\w+;base64,/, '');

      const prompt = `You are a visual verification assistant for mobile test automation. Analyze this screenshot and determine if the following condition is met:

Condition: "${condition}"

Analyze the screenshot carefully and respond with:
1. Whether the condition is verified (true/false)
2. Your confidence level (0.0 to 1.0)
3. Brief reasoning explaining what you see

Respond in JSON format:
{
  "verified": boolean,
  "confidence": number,
  "reasoning": "brief explanation"
}

Examples:
- Condition: "login button is visible" → Check if there's a button labeled "login", "log in", or "sign in"
- Condition: "home screen is displayed" → Check if this looks like a home/main screen
- Condition: "error message is shown" → Check if there's any error text or red/warning indicators
- Condition: "loading spinner is present" → Check if there's a loading indicator or spinner
- Condition: "user is logged in" → Check for indicators like profile icon, username, or logged-in UI

Be strict: only verify as true if you're confident the condition is clearly met.`;

      const result = await this.genAI.models.generateContent({
        model: this.model,
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: base64Image,
                },
              },
            ],
          },
        ],
        config: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      });

      const responseText = result.text?.trim();
      if (!responseText) {
        throw new Error('No response from vision AI');
      }

      // Parse JSON response
      const parsed = JSON.parse(responseText);

      return {
        verified: parsed.verified === true,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        reasoning: parsed.reasoning || 'No reasoning provided',
      };
    } catch (error: any) {
      console.error('Vision verification failed:', error.message);

      // Return failure result on error
      return {
        verified: false,
        confidence: 0,
        reasoning: `Verification failed: ${error.message}`,
      };
    }
  }

  /**
   * Verify multiple conditions at once
   */
  async verifyMultiple(
    screenshot: string,
    conditions: string[]
  ): Promise<Record<string, VerificationResult>> {
    const results: Record<string, VerificationResult> = {};

    // Run verifications sequentially to avoid rate limits
    for (const condition of conditions) {
      results[condition] = await this.verify(screenshot, condition);
    }

    return results;
  }
}
