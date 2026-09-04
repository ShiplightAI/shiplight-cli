/**
 * Mailgun email provider for email content extraction
 */

import { generateText } from 'ai';
import { convert as htmlToText } from 'html-to-text';
import { getModel, getProviderOptions, resolveTemperature } from '../agent/llmProvider';
import logger from '../utils/logger';
import { withLlmTimeout } from '../agent/llm/timeout';

/**
 * Extraction type enum
 */
export type ExtractionType = 'verification_code' | 'activation_link' | 'custom';

/**
 * Email filters
 */
export interface EmailFilters {
  from_email?: string;
  subject?: string;
  since?: number; // milliseconds timestamp
  body_contains?: string;
  to_email?: string;
}

/**
 * Email extraction request
 */
export interface ExtractEmailContentRequest {
  model: string; // LLM model to use
  forward_email: string;
  extraction_type: ExtractionType;
  prompt?: string;
  filters?: EmailFilters;
  timeout?: number; // seconds, default 60
}

/**
 * Email extraction response
 */
export interface ExtractEmailContentResponse {
  data?: string;
  status: 'success' | 'error';
  result_variable?: string;
  message: string;
}

/**
 * Email data structure
 */
interface EmailData {
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
  message_id?: string;
}

/**
 * Mailgun configuration
 */
export interface MailgunConfig {
  apiKey: string;
  domain: string;
  /** Overrides https://api.mailgun.net when routing through the Shiplight proxy */
  baseURL?: string;
  /** Overrides the Basic auth header (e.g. Bearer token for proxy) */
  authHeader?: string;
}

/**
 * Fetch emails via Mailgun API
 */
export async function fetchEmailsViaMailgun(
  config: MailgunConfig,
  forwardEmail: string,
  filters: EmailFilters
): Promise<EmailData[]> {
  const { apiKey, domain } = config;
  if (!apiKey) {
    throw new Error(
      'Mailgun configuration missing. Please provide apiKey and domain'
    );
  }

  const isProxy = !!config.baseURL;
  const mailgunBase = config.baseURL || 'https://api.mailgun.net';
  const authHeader = config.authHeader || `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`;

  const emails: EmailData[] = [];

  try {
    // Get events — proxy uses flat paths, direct Mailgun includes /v3/{domain}
    const eventsUrl = isProxy
      ? `${mailgunBase}/events`
      : `${mailgunBase}/v3/${domain}/events`;

    // Build query parameters
    const params: Record<string, string> = {
      event: 'accepted',
      limit: '10',
      ascending: 'yes',
      recipient: forwardEmail,
    };

    if (filters.from_email) {
      params.from = filters.from_email;
    }

    // Add date filter
    if (filters.since) {
      // Convert milliseconds to seconds
      params.begin = Math.floor(filters.since / 1000).toString();
    } else {
      // Default to last 10 minutes
      const sinceDate = new Date(Date.now() - 10 * 60 * 1000);
      params.begin = Math.floor(sinceDate.getTime() / 1000).toString();
    }

    logger.info(`Mailgun params: ${JSON.stringify(params)}`);

    // Get events
    const eventsResponse = await fetch(eventsUrl + '?' + new URLSearchParams(params), {
      method: 'GET',
      headers: {
        Authorization: authHeader,
      },
    });

    if (!eventsResponse.ok) {
      const errorText = await eventsResponse.text();
      throw new Error(`Mailgun events API error: ${errorText}`);
    }

    const eventsData = await eventsResponse.json();
    const events = eventsData.items || [];

    // Process each event
    for (const event of events.slice(0, 10)) {
      if (event.event !== 'accepted') {
        continue;
      }

      const storage = event.storage || {};
      const messageUrl = storage.url;

      logger.info(`message_url: ${messageUrl}`);

      if (!messageUrl) {
        // If no stored message URL, try to get basic info from event
        const messageData = event.message || {};
        const headers = messageData.headers || {};

        const subject = headers.subject || '';
        const fromAddr = headers.from || '';
        const toAddr = headers.to || '';

        // Apply filters
        if (filters.from_email && !fromAddr.toLowerCase().includes(filters.from_email.toLowerCase())) {
          continue;
        }

        if (filters.to_email && !toAddr.toLowerCase().includes(filters.to_email.toLowerCase())) {
          continue;
        }

        if (filters.subject && !subject.toLowerCase().includes(filters.subject.toLowerCase())) {
          continue;
        }

        emails.push({
          subject,
          from: fromAddr,
          to: toAddr,
          date: new Date(event.timestamp * 1000).toUTCString(),
          body: 'Message body not available (Mailgun storage disabled)',
          message_id: headers['message-id'] || '',
        });
        continue;
      }

      // Extract storage key from URL
      const urlParts = messageUrl.split('/');
      const storageKey = urlParts[urlParts.length - 1];

      logger.info(`Storage key: ${storageKey}`);

      // Try to get parsed message data
      if (storageKey) {
        const messagesApiUrl = isProxy
          ? `${mailgunBase}/messages/${storageKey}`
          : `${mailgunBase}/v3/domains/${domain}/messages/${storageKey}`;

        try {
          const parsedResponse = await fetch(messagesApiUrl, {
            method: 'GET',
            headers: {
              Authorization: authHeader,
              Accept: 'application/json',
            },
          });

          if (parsedResponse.ok) {
            const messageData = await parsedResponse.json();

            const subject = messageData.Subject || '';
            const fromAddr = messageData.From || '';
            const toAddr = messageData.To || '';
            const date = messageData.Date || '';
            const messageId = messageData['Message-Id'] || '';

            logger.info(`subject: ${subject}`);
            logger.info(`from_addr: ${fromAddr}`);
            logger.info(`to_addr: ${toAddr}`);
            logger.info(`date: ${date}`);
            logger.info(`message_id: ${messageId}`);

            // Get body content - prefer body-html
            let body = messageData['body-html'] || messageData['body-plain'] || '';

            // Convert HTML to plain text
            if (body && body.includes('<')) {
              body = htmlToText(body);
            }

            logger.info(`Body: ${body.substring(0, 200)}...`);

            // Apply filters
            if (filters.from_email && !fromAddr.toLowerCase().includes(filters.from_email.toLowerCase())) {
              continue;
            }

            if (filters.to_email && !toAddr.toLowerCase().includes(filters.to_email.toLowerCase())) {
              continue;
            }

            if (filters.subject && !subject.toLowerCase().includes(filters.subject.toLowerCase())) {
              continue;
            }

            if (filters.body_contains && !body.toLowerCase().includes(filters.body_contains.toLowerCase())) {
              continue;
            }

            emails.push({
              subject,
              from: fromAddr,
              to: toAddr,
              date,
              body,
              message_id: messageId,
            });
            continue; // Successfully processed
          } else {
            logger.warn(`Messages API returned ${parsedResponse.status}`);
          }
        } catch (e) {
          logger.warn(`Failed to parse JSON response: ${e}`);
        }
      }

      // Fallback: Fetch raw message
      try {
        const msgResponse = await fetch(messageUrl, {
          method: 'GET',
          headers: {
            Authorization: authHeader,
          },
        });

        if (!msgResponse.ok) {
          logger.warn(`Could not fetch stored message: ${msgResponse.status}`);
          continue;
        }

        // Parse raw email (simplified - in production you'd want a proper email parser)
        const rawEmail = await msgResponse.text();
        logger.info(`Fallback: Raw email length: ${rawEmail.length}`);

        // Simple email parsing (extract headers and body)
        const lines = rawEmail.split('\n');
        let inHeaders = true;
        const headers: Record<string, string> = {};
        let body = '';

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.trim() === '' && inHeaders) {
            inHeaders = false;
            continue;
          }

          if (inHeaders) {
            const match = line.match(/^([^:]+):\s*(.+)$/);
            if (match) {
              headers[match[1].toLowerCase()] = match[2];
            }
          } else {
            body += line + '\n';
          }
        }

        const subject = headers.subject || '';
        const fromAddr = headers.from || '';
        const toAddr = headers.to || '';
        const date = headers.date || '';
        const messageId = headers['message-id'] || '';

        // Apply filters
        if (filters.from_email && !fromAddr.toLowerCase().includes(filters.from_email.toLowerCase())) {
          continue;
        }

        if (filters.to_email && !toAddr.toLowerCase().includes(filters.to_email.toLowerCase())) {
          continue;
        }

        if (filters.subject && !subject.toLowerCase().includes(filters.subject.toLowerCase())) {
          continue;
        }

        if (filters.body_contains && !body.toLowerCase().includes(filters.body_contains.toLowerCase())) {
          continue;
        }

        emails.push({
          subject,
          from: fromAddr,
          to: toAddr,
          date,
          body: body.trim(),
          message_id: messageId,
        });
      } catch (e) {
        logger.warn(`Error fetching raw message: ${e}`);
      }
    }

    // Sort emails by date and return only the most recent one
    if (emails.length > 0) {
      try {
        emails.sort((a, b) => {
          const dateA = new Date(a.date).getTime();
          const dateB = new Date(b.date).getTime();
          return dateB - dateA; // Most recent first
        });
      } catch (e) {
        // If date parsing fails, keep original order
      }

      // Return only the most recent email
      const mostRecent = emails[0];
      logger.info(`Returning most recent email: ${mostRecent.subject}`);
      return [mostRecent];
    }

    return emails;
  } catch (error: any) {
    logger.error(`Error fetching emails from Mailgun: ${error.message}`);
    throw new Error(`Error fetching emails from Mailgun: ${error.message}`);
  }
}

/**
 * Get extraction prompt based on extraction type
 */
function getExtractionPrompt(extractionType: ExtractionType, customPrompt?: string): string {

  if (extractionType === 'verification_code') {
    return `You are analyzing an email to extract an OTP (One-Time Password) or verification code.

Please carefully examine the email content and look for:
1. Numeric codes (usually 4-8 digits)
2. Alphanumeric codes
3. Verification codes, OTP codes, authentication codes
4. Text like "Your code is", "Verification code:", "Enter this code", etc.

Extract the code exactly as shown in the email.
If you find a code, return just the code.
If you cannot find a code, return "NOT_FOUND".

Examples of what to extract:
- From: "Your verification code is: 123456"
  Extract: 123456

- From: "Enter code: ABC123XYZ"
  Extract: ABC123XYZ

- From: "OTP: 789012 (valid for 10 minutes)"
  Extract: 789012

- From: "Use this code to verify: AB12-CD34-EF56"
  Extract: AB12-CD34-EF56

Return ONLY the extracted code or "NOT_FOUND".`;
  } else if (extractionType === 'activation_link') {
    return `You are analyzing an email to extract a magic link or verification link.

Please carefully examine the email content and look for:
1. URLs that contain terms like "verify", "confirm", "activate", "login", "auth"
2. Button links with text like "Verify Email", "Confirm Account", "Click Here"
3. Links that appear to be for authentication or verification purposes

CRITICAL INSTRUCTIONS:
- Extract the COMPLETE URL from start to finish
- Include the ENTIRE URL starting with http:// or https://
- Include ALL query parameters, tokens, and path segments
- Do NOT truncate, shorten, or cut off any part of the URL
- Do NOT add ellipsis (...) or any other modifications
- Return the URL exactly as it appears in the email

If you find a magic link, return ONLY the complete URL with nothing else.
If you cannot find a magic link, return "NOT_FOUND".

Examples of what to extract:
- From: "Click here to verify: https://example.com/verify?token=abc123def456ghi789"
  Extract: https://example.com/verify?token=abc123def456ghi789

- From: "Confirm your account: https://app.example.com/auth/confirm/xyz789?user_id=12345&redirect=/dashboard"
  Extract: https://app.example.com/auth/confirm/xyz789?user_id=12345&redirect=/dashboard

- From: "[Verify Email](https://service.com/v/longtoken123456789abcdefghijklmnopqrstuvwxyz?param1=value1&param2=value2)"
  Extract: https://service.com/v/longtoken123456789abcdefghijklmnopqrstuvwxyz?param1=value1&param2=value2

- From: "Verify Email [https://service.com/v/longtoken123456789abcdefghijklmnopqrstuvwxyz?param1=value1&param2=value2]"
  Extract: https://service.com/v/longtoken123456789abcdefghijklmnopqrstuvwxyz?param1=value1&param2=value2

Return ONLY the complete extracted URL or "NOT_FOUND".`;
  } else if (extractionType === 'custom') {
    if (!customPrompt) {
      throw new Error('Custom prompt is required when extraction_type is custom');
    }
    return customPrompt + '\nReturn only the required content or \'NOT_FOUND\'.';
  } else {
    throw new Error(`Unsupported extraction type: ${extractionType}`);
  }
}

/**
 * Strip LLM generation artifacts (stray markdown/quote wrappers, trailing
 * punctuation such as a lone "_") from an extracted verification code.
 * Verification codes are alphanumeric, optionally hyphen-segmented (e.g.
 * "AB12-CD34-EF56"), so only leading/trailing non-alphanumeric characters
 * are trimmed — internal hyphens are preserved.
 */
export function sanitizeVerificationCode(raw: string): string {
  const trimmed = raw.trim();
  const unwrapped = trimmed.replace(/^[`"'*_]+|[`"'*_]+$/g, '').trim();
  const cleaned = unwrapped.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
  return cleaned || unwrapped || trimmed;
}

/**
 * Extract content from email using LLM
 */
export async function extractContentWithLLM(emailContent: string, extractionPrompt: string, modelName: string, extractionType?: ExtractionType): Promise<string> {

  try {
    const fullPrompt = `${extractionPrompt}
---
Email Content:
---
${emailContent}
---
`;

    const model = getModel(modelName);
    // Sampling-free Anthropic models (Opus 4.7/4.8, Sonnet 5, Fable 5) reject a
    // non-default temperature with a 400 — omit the field for those.
    const temperature = resolveTemperature(modelName, undefined);
    const result = await withLlmTimeout((abortSignal) =>
      generateText({
        model,
        abortSignal,
        messages: [{ role: 'user', content: fullPrompt }],
        ...(temperature !== undefined ? { temperature } : {}),
        providerOptions: getProviderOptions(modelName, 0), // Text only, no images
      }),
    );

    let extractedContent = result.text.trim();
    if (!extractedContent) {
      return 'NOT_FOUND';
    }
    if (extractionType === 'verification_code' && extractedContent !== 'NOT_FOUND') {
      const sanitized = sanitizeVerificationCode(extractedContent);
      if (sanitized !== extractedContent) {
        logger.warn(`Sanitized verification code from LLM extraction: "${extractedContent}" -> "${sanitized}"`);
      }
      extractedContent = sanitized;
    }
    return extractedContent;
  } catch (error: any) {
    logger.error(`Error in LLM extraction: ${error.message}`);
    throw new Error(`Error in LLM extraction: ${error.message}`);
  }
}

/**
 * Main email extraction function with polling support
 */
export async function extractEmailContent(
  config: MailgunConfig,
  request: ExtractEmailContentRequest
): Promise<ExtractEmailContentResponse> {
  logger.info(
    `extract_email_content:
    forward_email: ${request.forward_email}
    extraction_type: ${request.extraction_type}
    filters: ${JSON.stringify(request.filters || {})}
    timeout: ${request.timeout || 60}
    polling_interval: 10`
  );

  const timeout = request.timeout || 60;
  const pollingInterval = 10;

  try {
    // Validate custom prompt requirement
    if (request.extraction_type === 'custom' && !request.prompt) {
      return {
        data: undefined,
        status: 'error',
        message: 'Custom prompt is required when extraction_type is custom',
      };
    }

    // Get the appropriate extraction prompt
    const extractionPrompt = getExtractionPrompt(request.extraction_type, request.prompt);

    // Initialize polling parameters
    const startTime = new Date();
    const maxEndTime = new Date(startTime.getTime() + timeout * 1000);
    let attemptCount = 0;

    logger.info(
      `Starting email polling for ${timeout} seconds with ${pollingInterval}s intervals`
    );

    while (new Date() < maxEndTime) {
      attemptCount++;
      logger.info(`Polling attempt ${attemptCount}`);

      try {
        // Fetch emails using Mailgun API
        const filters = request.filters || {};
        const emails = await fetchEmailsViaMailgun(config, request.forward_email, filters);

        if (emails.length > 0) {
          logger.info(`Found ${emails.length} emails matching criteria`);

          // Process emails and extract content
          const extractedResults: Array<{
            content: string;
            email_subject: string;
            email_from: string;
            email_date: string;
          }> = [];

          for (const emailData of emails) {
            // Combine email content for LLM analysis
            const emailContent = `Subject: ${emailData.subject}
From: ${emailData.from}
To: ${emailData.to}
Date: ${emailData.date}

Body:
${emailData.body}`;

            // Extract content using LLM
            const extractedContent = await extractContentWithLLM(emailContent, extractionPrompt, request.model, request.extraction_type);

            logger.info(`Extracted content: ${extractedContent}`);

            if (extractedContent && extractedContent !== 'NOT_FOUND') {
              extractedResults.push({
                content: extractedContent,
                email_subject: emailData.subject,
                email_from: emailData.from,
                email_date: emailData.date,
              });
            }
          }

          if (extractedResults.length > 0) {
            // Return the first successful extraction (most recent)
            const result = extractedResults[0];

            let variableName = `$email_${request.extraction_type}`;
            if (request.extraction_type === 'custom') {
              variableName = '$email_extracted_content';
            } else if (request.extraction_type === 'activation_link') {
              variableName = '$email_magic_link';
            } else if (request.extraction_type === 'verification_code') {
              variableName = '$email_otp_code';
            }

            const totalTime = (new Date().getTime() - startTime.getTime()) / 1000;
            logger.info(
              `Successfully extracted content after ${attemptCount} attempts in ${totalTime.toFixed(1)} seconds`
            );
            return {
              data: result.content,
              result_variable: variableName,
              status: 'success',
              message: `Successfully extracted content from email: ${result.email_subject.substring(0, 50)}... (attempts: ${attemptCount})`,
            };
          } else {
            logger.info(`Found emails but no extractable content in attempt ${attemptCount}`);
          }
        } else {
          logger.info(`No emails found in attempt ${attemptCount}`);
        }
      } catch (error: any) {
        logger.warn(`Error in polling attempt ${attemptCount}: ${error.message}`);
      }

      // Check if we have time for another attempt
      const nextAttemptTime = new Date(Date.now() + pollingInterval * 1000);
      if (nextAttemptTime >= maxEndTime) {
        logger.info('Not enough time for another polling attempt');
        break;
      }

      // Wait before next polling attempt
      logger.info(`Waiting ${pollingInterval} seconds before next attempt...`);
      await new Promise((resolve) => setTimeout(resolve, pollingInterval * 1000));
    }

    // If we reach here, we've exhausted all polling attempts
    const totalTime = (new Date().getTime() - startTime.getTime()) / 1000;
    return {
      data: undefined,
      status: 'error',
      message: `No emails with extractable content found after ${attemptCount} attempts over ${totalTime.toFixed(1)} seconds`,
    };
  } catch (error: any) {
    logger.error(`Error extracting email content: ${error.message}`);
    return {
      data: undefined,
      status: 'error',
      message: `Error extracting email content: ${error.message}`,
    };
  }
}
