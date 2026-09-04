import { Page } from 'playwright';
import { TaskExecutionContext } from '../agent/core/types';
import { PageContext } from '../agent/action-generation/actionPrompts';
import { ActionIntent, DOMState } from '../dom/types';

interface TabInformation {
	currentTabText: string;
	tabsText: string;
}

async function formatTabInformation(page: Page): Promise<TabInformation> {
	// Get all pages from context (same as page.context().pages() in Python)
	const pages = page.context().pages();
	let currentTabId: number | null = null;

	const tabsList: string[] = [];
	for (let idx = 0; idx < pages.length; idx++) {
		const p = pages[idx];

		// Find current tab by comparing page objects
		if (p === page) {
			currentTabId = idx;
		}

		// Get title with timeout to avoid hanging
		let title = '(title unavailable)';
		try {
			// Using Promise.race for timeout
			title = await Promise.race([
				p.title(),
				new Promise<string>((_, reject) =>
					setTimeout(() => reject(new Error('timeout')), 1000)
				)
			]);
		} catch (error) {
			// Keep default title
		}

		let tabDesc = `Tab ${idx}: ${p.url()}`;
		if (title) {
			tabDesc += ` - ${title.slice(0, 50)}`;
		}
		tabsList.push(tabDesc);
	}

	const tabsText = tabsList.length > 0 ? tabsList.join('\n') : '';
	const currentTabText = currentTabId !== null ? `Current tab: ${currentTabId}\n` : '';

	return { currentTabText, tabsText };
}

/**
 * Format page context for LLM
 */
async function formatPageContext(page: Page, domTree: string): Promise<PageContext> {
	const { currentTabText, tabsText } = await formatTabInformation(page);

	return {
		elementsText: domTree,
		currentUrl: page.url(),
		currentTitle: await page.title(),
		currentTabText: currentTabText,
		tabsText: tabsText,
	};
}

export interface BuildPageContextResult {
	domTree: string;
	screenshotBase64: string;
	slicedScreenshotsBase64?: string[];
	domState: DOMState;
	pageContext: PageContext;
}

export interface BuildPageContextOptions {
	useCleanScreenshot?: boolean;
	useSlicedScreenshots?: boolean;
	resizeSlicedScreenshots?: boolean;
	/** Use Chrome Accessibility Tree for element detection (experimental) */
	useAccessibilityTree?: boolean;
	/** Action intent for filtering elements (click/input/scroll/all) */
	actionIntent?: ActionIntent;
}

/**
 * Build page context for action generation
 *
 * This function:
 * 1. Gets fresh DOM state and screenshot with Set-of-Mark
 * 2. Optionally slices the screenshot into 3 parts (left/middle/right)
 * 3. Formats page context for LLM prompts
 *
 * @param context - Task execution context with page, domService, and agentServices
 * @param options - Options for screenshot processing
 * @returns Complete page context data needed for action generation
 */
export async function buildPageContext(
	context: TaskExecutionContext,
	options?: BuildPageContextOptions | boolean // boolean for backward compat (useCleanScreenshot)
): Promise<BuildPageContextResult> {
	const { page, domService, agentServices } = context;

	// Handle backward compatibility: if boolean, treat as useCleanScreenshot
	const opts: BuildPageContextOptions = typeof options === 'boolean'
		? { useCleanScreenshot: options }
		: options || {};

	// Get fresh DOM state and screenshot with SOM (slicing handled in domService)
	const interactiveClassNames = agentServices.getInteractiveClassNames();
	const playwrightFrameFallbackDomains = agentServices.getIframeFallbackDomains();
	const { domState, screenshotBase64, slicedScreenshotsBase64 } =
		await domService.getClickableElementsWithScreenshot(page, {
			interactiveClassNames,
			playwrightFrameFallbackDomains,
			useCleanScreenshot: opts.useCleanScreenshot,
			useSlicedScreenshots: opts.useSlicedScreenshots,
			resizeSlicedScreenshots: opts.resizeSlicedScreenshots,
			useAccessibilityTree: opts.useAccessibilityTree,
			actionIntent: opts.actionIntent,
		});
	const domTree = domState.elementTree.clickableElementsToString();

	// Build browser state context
	const pageContext = await formatPageContext(page, domTree);

	// Add sliced screenshots to pageContext for prompt generation
	if (slicedScreenshotsBase64) {
		pageContext.slicedScreenshotsBase64 = slicedScreenshotsBase64;
	}

	return {
		domTree,
		screenshotBase64,
		slicedScreenshotsBase64,
		domState,
		pageContext,
	};
}
