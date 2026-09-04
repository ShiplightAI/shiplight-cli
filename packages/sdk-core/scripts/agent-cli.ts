/**
 * Interactive Web Agent Chat & Single Task Runner
 *
 * Two modes:
 * 1. Interactive Mode: Chat with the agent, maintains conversation context
 * 2. Single Task Mode: Run one task and exit (useful for testing)
 *
 * Usage:
 *   # Interactive mode
 *   GEMINI_API_KEY=your_key pnpm --filter sdk-core agent
 *
 *   # Single task mode
 *   GEMINI_API_KEY=your_key pnpm --filter sdk-core agent --task "Search for Playwright"
 *
 *   # With cookies file
 *   pnpm --filter sdk-core agent --url https://example.com --cookies ./cookies.json
 *
 * Options:
 *   --task <task>      - Run single task and exit (disables interactive mode)
 *   --url <url>        - Starting URL (optional, default: blank page)
 *   --cookies <file>   - Path to JSON file containing cookies array
 *
 * Interactive Commands:
 *   - Type your request and press Enter
 *   - /exit or /quit - End the session
 *   - /history - Show the conversation history
 *   - /clear - Clear the chat history
 *   - /help - Show available commands
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

// Get the directory of this file (ESM equivalent of __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from the same directory as this script
config({ path: resolve(__dirname, '.env') });

import { Page } from 'playwright';
import { WebAgent, createAgentContext, ActionEntity, configureSdk, BrowserManager, BrowserInstance } from 'sdk-core';
import { VariableStore } from 'shiplight-types';
import * as readline from 'readline';

// Configure SDK with environment variables for LLM providers
const envKeys = [
	'GOOGLE_API_KEY',
	'GOOGLE_GENAI_USE_VERTEXAI',
	'GOOGLE_CLOUD_PROJECT',
	'GOOGLE_CLOUD_LOCATION',
];
const sdkEnv: Record<string, string> = {};
for (const key of envKeys) {
	if (process.env[key]) {
		sdkEnv[key] = process.env[key]!;
	}
}
configureSdk({ env: sdkEnv });

/**
 * Chat message for conversation history
 */
interface ChatMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

/**
 * Extended chat message with action entities
 */
interface ExtendedChatMessage extends ChatMessage {
	actions?: ActionEntity[];
}

/**
 * Format action entity for display
 */
function formatActionEntity(action: ActionEntity, index: number): string {
	const lines: string[] = [];
	lines.push(`   ${index + 1}. ${action.action_description}`);

	if (action.action_data) {
		const actionName = action.action_data.action_name || 'unknown';
		lines.push(`      Action: ${actionName}`);

		// Show kwargs if present
		if (action.action_data.kwargs) {
			const kwargs = action.action_data.kwargs;
			Object.keys(kwargs).forEach(key => {
				const value = kwargs[key];
				if (typeof value === 'string' && value.length > 100) {
					lines.push(`      ${key}: ${value.substring(0, 100)}...`);
				} else {
					lines.push(`      ${key}: ${JSON.stringify(value)}`);
				}
			});
		}
	}

	if (action.locator) {
		lines.push(`      Locator: ${action.locator}`);
	}

	if (action.xpath) {
		lines.push(`      XPath: ${action.xpath}`);
	}

	if (action.url) {
		lines.push(`      URL: ${action.url}`);
	}

	return lines.join('\n');
}

/**
 * Format chat history for display
 */
function formatChatHistory(chatHistory: ExtendedChatMessage[]): string {
	const lines: string[] = [];
	chatHistory.forEach((msg, idx) => {
		const icon = msg.role === 'user' ? '👤' : '🤖';
		const label = msg.role === 'user' ? 'You' : 'Agent';
		lines.push(`${icon} ${label}:` );

		// For assistant messages, format nicely
		if (msg.role === 'assistant') {
			const content = msg.content.replace(/^Steps taken:\n/, '').replace(/\n\nStatus: /, '\n\n→ Status: ');
			lines.push(content);

			// Show action entities if present
			if (msg.actions && msg.actions.length > 0) {
				lines.push('');
				lines.push('   Actions:');
				msg.actions.forEach((action, actionIdx) => {
					lines.push(formatActionEntity(action, actionIdx));
				});
			}
		} else {
			lines.push(msg.content);
		}

		if (idx < chatHistory.length - 1) {
			lines.push('');
		}
	});
	return lines.join('\n');
}

/**
 * Parse command line arguments
 */
function parseArgs() {
	const args = process.argv.slice(2);
	function getArg(name: string): string | undefined;
	function getArg(name: string, defaultValue: string): string;
	function getArg(name: string, defaultValue?: string): string | undefined {
		const index = args.indexOf(name);
		return index >= 0 && args[index + 1] ? args[index + 1] : defaultValue;
	}

	// Load cookies from file if provided
	const cookiesFile = getArg('--cookies');
	let cookies: any[] | undefined;
	if (cookiesFile) {
		try {
			const cookiesPath = resolve(process.cwd(), cookiesFile);
			const cookiesJson = readFileSync(cookiesPath, 'utf-8');
			cookies = JSON.parse(cookiesJson);
			console.log(`🍪 Loaded ${cookies?.length || 0} cookies from ${cookiesFile}`);
		} catch (error: any) {
			console.error(`❌ Failed to load cookies from ${cookiesFile}:`, error.message);
			process.exit(1);
		}
	}

	return {
		task: getArg('--task'),
		url: getArg('--url'), // No default URL - start blank unless specified
		cookies,
	};
}

/**
 * Run single task mode (for testing)
 */
async function runSingleTask(task: string, options: ReturnType<typeof parseArgs>) {
	console.log('🚀 Single Task Mode');
	console.log('━'.repeat(50));
	console.log(`Task: "${task}"`);
	console.log(`URL: ${options.url || '(blank page)'}`);
	if (options.cookies) {
		console.log(`Cookies: ${options.cookies.length} cookies loaded`);
	}
	console.log('');

	// Launch browser using BrowserManager
	console.log('🌐 Launching browser...');
	const browserManager = new BrowserManager({
		headless: false,
	});
	const browserInstance: BrowserInstance = await browserManager.launchBrowser({
		cookies: options.cookies,
	});
	const page: Page = await browserInstance.context.newPage();

	// Create WebAgent
	const variableStore = new VariableStore();
	const agentContext = createAgentContext({
		model: 'gemini-2.5-pro',
		variableStore,
		testDataDir: '/tmp',
	});
	const agent = new WebAgent(agentContext);

	if (options.url) {
		await page.goto(options.url);
		console.log(`✅ Navigated to ${options.url}`);
	} else {
		console.log('✅ Browser ready (no initial URL)');
	}
	console.log('');

	try {
		console.log('🤖 Running task...');
		console.log('');

		const result = await agent.run(page, task);

		console.log('');
		console.log('━'.repeat(50));
		console.log('📊 RESULTS');
		console.log('━'.repeat(50));
		console.log(`Status: ${result.success ? 'success' : 'error'}`);
		console.log(`Details: ${result.details}`);
		console.log(`Actions: ${result.actions?.length || 0}`);
		console.log('');

		// Wait a bit to see the result
		await page.waitForTimeout(3000);

	} catch (error: any) {
		console.error('');
		console.error('❌ Error:', error.message);
	} finally {
		await browserManager.terminateBrowser(browserInstance);
		console.log('');
		console.log('👋 Done!');
	}
}

/**
 * Main agent chat loop
 */
async function agentChat() {
	console.log('🤖 Web Agent Chat');
	console.log('━'.repeat(50));
	console.log('');

	// Parse command line args
	const options = parseArgs();

	// Single task mode
	if (options.task) {
		await runSingleTask(options.task, options);
		return;
	}

	// Interactive mode
	// Launch browser using BrowserManager
	console.log('🚀 Launching browser...');
	const browserManager = new BrowserManager({
		headless: false,
	});
	const browserInstance: BrowserInstance = await browserManager.launchBrowser({
		cookies: options.cookies,
	});
	const page: Page = await browserInstance.context.newPage();

	// Navigate to URL if provided
	if (options.url) {
		await page.goto(options.url);
		console.log(`✅ Navigated to ${options.url}`);
	}

	// Create WebAgent
	const variableStore = new VariableStore();
	const agentContext = createAgentContext({
		model: 'gemini-2.5-pro',
		variableStore,
		testDataDir: '/tmp',
	});
	const agent = new WebAgent(agentContext);

	console.log('✅ Browser ready!');
	console.log('');
	console.log('💡 Commands:');
	console.log('   /help     - Show available commands');
	console.log('   /history  - Show conversation history');
	console.log('   /clear    - Clear the chat history');
	console.log('   /reset    - Reset everything (new browser, new session)');
	console.log('   /exit     - End the session');
	console.log('');
	console.log('━'.repeat(50));
	console.log('');

	// Initialize chat history
	const chatHistory: ExtendedChatMessage[] = [];

	// Create readline interface
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: '👤 You: ',
	});

	// Show prompt
	rl.prompt();

	// Handle user input
	rl.on('line', async (input: string) => {
		const trimmed = input.trim();

		// Handle slash commands
		if (trimmed.startsWith('/')) {
			const command = trimmed.toLowerCase();

			if (command === '/exit' || command === '/quit') {
				rl.close();
				return;
			}

			if (command === '/help') {
				console.log('');
				console.log('📖 Available Commands:');
				console.log('━'.repeat(50));
				console.log('   /help     - Show this help message');
				console.log('   /history  - Show full conversation history');
				console.log('   /clear    - Clear the chat history (keeps browser session)');
				console.log('   /reset    - Reset everything (new browser, new session)');
				console.log('   /exit     - End the session and close browser');
				console.log('');
				console.log('💡 Tip: Just type your request to interact with the agent!');
				console.log('━'.repeat(50));
				console.log('');
				rl.prompt();
				return;
			}

			if (command === '/history') {
				console.log('');
				console.log('📜 Conversation History:');
				console.log('━'.repeat(50));
				if (chatHistory.length === 0) {
					console.log('(empty)');
				} else {
					console.log(formatChatHistory(chatHistory));
				}
				console.log('━'.repeat(50));
				console.log('');
				rl.prompt();
				return;
			}

			if (command === '/clear') {
				chatHistory.length = 0;
				console.log('');
				console.log('🗑️  Chat history cleared (browser session continues)');
				console.log('');
				rl.prompt();
				return;
			}

			if (command === '/reset') {
				console.log('');
				console.log('🔄 Resetting session...');

				// Close current browser
				await browserManager.terminateBrowser(browserInstance);

				// Clear chat history
				chatHistory.length = 0;

				// Launch new browser
				const newBrowserInstance = await browserManager.launchBrowser({
					cookies: options.cookies,
				});
				const newPage: Page = await newBrowserInstance.context.newPage();

				// Navigate to URL if provided
				if (options.url) {
					await newPage.goto(options.url);
				}

				// Update references
				Object.assign(browserInstance, newBrowserInstance);
				Object.assign(page, newPage);

				console.log('✅ New session started!');
				console.log('');
				rl.prompt();
				return;
			}

			// Unknown command
			console.log('');
			console.log(`❌ Unknown command: ${command}`);
			console.log('   Type /help to see available commands');
			console.log('');
			rl.prompt();
			return;
		}

		if (!trimmed) {
			rl.prompt();
			return;
		}

		// Add user message to history
		chatHistory.push({ role: 'user', content: trimmed });

		console.log('');
		console.log('🤖 Agent: Working on it...');
		console.log('');

		try {
			// Run the task with WebAgent
			const result = await agent.run(page, trimmed);

			// Create chat summary from result
			const chatSummary = result.details || (result.success ? 'Task completed' : 'Task failed');

			// Add assistant response to chat history
			chatHistory.push({
				role: 'assistant',
				content: chatSummary,
				actions: result.actions
			});

			// Display formatted result
			console.log('');
			console.log('━'.repeat(50));
			console.log('');

			if (result.success) {
				console.log('✅ Task completed!');
			} else {
				console.log('❌ Task failed');
			}

			console.log('');
			console.log(chatSummary);

			// Show action count if available
			const actionCount = result.actions?.length || 0;
			if (actionCount > 0) {
				console.log('');
				console.log(`Actions executed: ${actionCount}`);
			}

			console.log('');
			console.log('━'.repeat(50));
		} catch (error) {
			console.error('');
			console.error('❌ Error:', (error as Error).message);
			console.error('');
		}

		console.log('');
		rl.prompt();
	});

	rl.on('close', async () => {
		console.log('');
		console.log('👋 Goodbye!');
		await browserManager.terminateBrowser(browserInstance);
		process.exit(0);
	});
}

// Run agent chat
agentChat().catch(console.error);
