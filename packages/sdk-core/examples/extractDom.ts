/**
 * DOM Extraction Tool (TypeScript)
 *
 * Extract DOM tree and screenshot from a URL.
 * Outputs:
 *   - dom.txt: Clickable elements in text format
 *   - screenshot.png: SoM screenshot with numbered highlights
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// Dynamic imports to ensure proper module loading order
const { Page } = await import('playwright');
const { DomService, BrowserManager } = await import('sdk-core');

// Simple console logger
const logger = {
	info: (msg: string) => console.log(`[INFO] ${msg}`),
	error: (msg: string) => console.error(`[ERROR] ${msg}`),
};

interface ExtractionResult {
	domFile: string;
	screenshotFile: string;
	elementCount: number;
}

async function extractDomAndScreenshot(url: string, outputDir: string): Promise<ExtractionResult> {
	/**
	 * Extract DOM tree and screenshot from a URL.
	 */
	// Create output directory
	mkdirSync(outputDir, { recursive: true });

	// Launch browser using BrowserManager
	const browserManager = new BrowserManager({ headless: false });
	const browserInstance = await browserManager.launchBrowser();
	const context = browserInstance.context;
	const page: Page = await context.newPage();

	try {
		// Navigate to URL
		logger.info(`🌐 Navigating to ${url}`);
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
		await page.waitForLoadState('domcontentloaded');

		// Create DOM service
		const domService = new DomService(page);

		// Extract clickable elements with highlights and screenshot
		logger.info('🔍 Extracting clickable elements...');
		const { domState, screenshot } = await domService.getClickableElementsWithScreenshot({
			highlightElements: true,
			focusElement: -1,
			viewportExpansion: 0,
		});

		logger.info(`✅ Found ${domState.selectorMap.size} clickable elements`);

		// Convert to string
		const domText = domState.elementTree.clickableElementsToString();

		// Save outputs
		const domFile = join(outputDir, 'dom.txt');
		const screenshotFile = join(outputDir, 'screenshot.png');

		const domContent = `URL: ${url}\nFound ${domState.selectorMap.size} clickable elements\n\n${domText}`;
		writeFileSync(domFile, domContent);
		writeFileSync(screenshotFile, Buffer.from(screenshot, 'base64'));

		logger.info(`💾 DOM saved to: ${domFile}`);
		logger.info(`💾 Screenshot saved to: ${screenshotFile}`);

		// Keep browser open for 3 seconds to see highlights
		await page.waitForTimeout(3000);

		return {
			domFile,
			screenshotFile,
			elementCount: domState.selectorMap.size,
		};
	} finally {
		await browserManager.terminateBrowser(browserInstance);
	}
}

async function main() {
	const args = process.argv.slice(2);

	if (args.length < 2) {
		console.log('Usage: tsx extractDom.ts <url> <output_dir>');
		console.log('Example: tsx extractDom.ts https://github.com/login /tmp/typescript_output');
		process.exit(1);
	}

	const url = args[0];
	const outputDir = args[1];

	logger.info(`🚀 Starting DOM extraction for: ${url}`);
	logger.info(`📁 Output directory: ${outputDir}`);

	try {
		const result = await extractDomAndScreenshot(url, outputDir);

		logger.info('\n' + '='.repeat(60));
		logger.info('✅ Extraction complete!');
		logger.info(`   Elements found: ${result.elementCount}`);
		logger.info(`   DOM file: ${result.domFile}`);
		logger.info(`   Screenshot: ${result.screenshotFile}`);
		logger.info('='.repeat(60));
	} catch (error: any) {
		logger.error(`❌ Error: ${error.message}`);
		throw error;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		logger.error(`Fatal error: ${error}`);
		process.exit(1);
	});
}

export { extractDomAndScreenshot };
