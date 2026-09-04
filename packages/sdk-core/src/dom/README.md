# DOM Module

DOM extraction and processing module for AI-powered browser automation, ported from [browser-use](https://github.com/browser-use/browser-use) Python implementation.

## Overview

This module provides functionality to:
- Extract interactive/clickable elements from web pages
- Convert DOM to LLM-friendly text format
- Track DOM state changes across page transitions
- Handle shadow DOM and cross-origin iframes

## Architecture

```
dom/
├── service.ts           # Main DomService orchestrator
├── nodes.ts             # DOM node implementations
├── types.ts             # TypeScript type definitions
├── dom-tree/
│   └── index.js        # 62KB JavaScript for in-browser DOM analysis
├── history/
│   └── processor.ts    # Element tracking & comparison
└── utils/
    └── textUtils.ts    # Text processing utilities
```

## Usage

### Basic DOM Extraction

```typescript
import { Page } from 'playwright';
import { DomService } from 'sdk-core';

const page: Page = /* your Playwright page */;
const domService = new DomService(page);

// Extract clickable elements
const domState = await domService.getClickableElements({
  highlightElements: true,      // Highlight elements in browser
  focusElement: -1,              // Focus on specific element (-1 = all)
  viewportExpansion: 0,          // Include elements outside viewport
  interactiveClassNames: [],     // Custom interactive CSS classes
  playwrightFrameFallbackDomains: [], // Domains for Playwright iframe fallback
  alwaysHighlightFileInput: false
});

// Access results
console.log(`Found ${domState.selectorMap.size} clickable elements`);

// Convert to LLM-readable format
const domText = domState.elementTree.clickableElementsToString({
  includeAttributes: ['title', 'type', 'role', 'value', 'placeholder'],
  includeClassesWithRename: {
    'react-flow__(\\S+)': '$1'  // Regex pattern -> replacement
  }
});

console.log(domText);
// Output:
// [1]<button type="submit">Sign In />
// [2]<input type="text" placeholder="Email" />
// [3]<a href="/forgot-password">Forgot Password? />
```

### SoM (Set-of-Mark) Screenshots

Capture screenshots with numbered highlights for vision-based AI models:

```typescript
import { DomService } from 'sdk-core';
import { writeFileSync } from 'fs';

const domService = new DomService(page);

// Get DOM + screenshot with highlights in one call
const { domState, screenshot } = await domService.getClickableElementsWithScreenshot({
  highlightElements: true,
  viewportExpansion: 0
});

// Save screenshot
writeFileSync('som-screenshot.png', Buffer.from(screenshot, 'base64'));

// Get text representation
const domText = domState.elementTree.clickableElementsToString();

// Now you have:
// 1. Screenshot with numbered highlights [1], [2], [3]...
// 2. Text description matching those numbers
// Perfect for vision + text AI models!
```

**How it works:**
1. JavaScript adds visual highlights to elements (colored boxes + numbers)
2. Screenshot captures the page with highlights visible
3. Element indices in screenshot match indices in text output
4. AI can use both modalities (vision + text) for better understanding

### Element Lookup

```typescript
// Get specific element by highlight index
const element = domState.selectorMap.get(1); // Button at index 1

if (element) {
  console.log(element.tagName);        // "button"
  console.log(element.attributes);     // { type: "submit" }
  console.log(element.isVisible);      // true
  console.log(element.isInViewport);   // true

  // Get all text within element
  const text = element.getAllTextTillNextClickableElement();
  console.log(text);  // "Sign In"
}
```

### Cross-Origin IFrames

```typescript
// Find iframes from different origins (useful for multi-frame navigation)
const iframeUrls = await domService.getCrossOriginIframes();

// Automatically filters out:
// - Ad networks (doubleclick.net, adroll.com, etc.)
// - Hidden tracking iframes
// - Same-origin iframes
```

### History Tracking

Track which elements are new vs. persistent across page updates:

```typescript
import { HistoryTreeProcessor } from 'sdk-core';

// First page state
const state1 = await domService.getClickableElements();
const history1 = state1.selectorMap.get(1);
const historyElement = HistoryTreeProcessor.convertDomElementToHistoryElement(history1!);

// Navigate or update page...
await page.click('button');

// Second page state
const state2 = await domService.getClickableElements();

// Find element in new state
const foundElement = HistoryTreeProcessor.findHistoryElementInTree(
  historyElement,
  state2.elementTree
);

if (foundElement) {
  console.log('Element persisted across page transition');
} else {
  console.log('Element disappeared');
}

// Mark new elements
for (const [index, element] of state2.selectorMap.entries()) {
  const isNew = !HistoryTreeProcessor.compareHistoryElementAndDomElement(
    historyElement,
    element
  );
  element.isNew = isNew;  // Will show as *[index] in string output
}
```

## How It Works

### Two-Phase Processing

1. **JavaScript Phase** (in-browser)
   - Injects `dom-tree/index.js` into the page
   - Analyzes DOM structure
   - Detects interactive elements (buttons, links, inputs, etc.)
   - Uses heuristics + event listener detection
   - Calculates viewport positions
   - Returns JSON structure

2. **TypeScript Phase** (Node.js)
   - Constructs typed DOM tree from JSON
   - Provides rich API for element access
   - Converts to LLM-friendly string format
   - Tracks state changes

### Element Detection

Elements are marked as interactive/clickable if they:
- Are standard interactive elements (`<button>`, `<a>`, `<input>`, etc.)
- Have event listeners (click, mousedown, etc.)
- Have role="button" or similar ARIA roles
- Match heuristic patterns (class names like "btn", "clickable", etc.)
- Are custom interactive elements specified via `interactiveClassNames`

### String Format for LLMs

The `clickableElementsToString()` method generates token-efficient output:

```
[1]<button type="submit">Sign In />
[2]<input type="email" placeholder="Email address" />
[3]<input type="password" placeholder="Password" />
[4]<a href="/forgot">Forgot password? />
[5] (SCROLLABLE)<div>Terms and Conditions... />
```

Features:
- Numbered highlights [1], [2], etc.
- Only includes essential attributes
- Removes duplicate attribute values
- Indicates scrollable containers
- Shows element hierarchy with indentation
- Marks new elements with `*[index]` prefix

## Types

### Core Types

```typescript
interface DOMState {
  elementTree: DOMElementNode;
  selectorMap: Map<number, DOMElementNode>;
}

interface DOMElementNode {
  tagName: string;
  xpath: string;
  attributes: Record<string, string>;
  children: DOMBaseNode[];
  isVisible: boolean;
  isInteractive: boolean;
  isScrollable: boolean;
  isInViewport: boolean;
  highlightIndex: number | null;
  isNew: boolean | null;  // Set by history tracking

  getAllTextTillNextClickableElement(maxDepth?: number): string;
  clickableElementsToString(config?: StringifyConfig): string;
}

interface DOMExtractionOptions {
  highlightElements?: boolean;
  focusElement?: number;
  viewportExpansion?: number;
  interactiveClassNames?: string[];
  playwrightFrameFallbackDomains?: string[];
  alwaysHighlightFileInput?: boolean;
}
```

## Integration with Agent

The DOM module integrates seamlessly with the Shiplight Agent:

```typescript
import { Agent, DomService } from 'sdk-core';

// In your agent implementation
async execute(page: Page, statement: string) {
  // Extract DOM locally (faster than backend)
  const domService = new DomService(page);
  const domState = await domService.getClickableElements();
  const domText = domState.elementTree.clickableElementsToString();

  // Pass to AI with pre-extracted DOM
  const result = await generateAiActionEntity(
    cdpUrl,
    page,
    statement,
    sensitiveData,
    contextData,
    organizationId,
    organizationSettings,
    executionHistory,
    domText  // <-- Pre-extracted DOM
  );

  // Execute action...
}
```

## Performance

- **DOM extraction**: ~200-500ms for typical pages
- **JavaScript bundle**: 62KB (injected once per page)
- **Memory efficient**: Uses WeakMaps for caching in browser
- **No backend roundtrip**: Everything runs client-side

## Comparison with Python Version

This TypeScript implementation is functionally equivalent to the Python browser-use version:

| Feature | Python (browser-use) | TypeScript (web-sdk) |
|---------|---------------------|----------------------|
| DOM extraction | ✅ | ✅ |
| Element highlighting | ✅ | ✅ |
| String conversion | ✅ | ✅ |
| History tracking | ✅ | ✅ |
| Cross-origin iframes | ✅ | ✅ |
| Shadow DOM support | ✅ | ✅ |
| Language | Python 3.11+ | TypeScript/Node.js 18+ |
| Runtime | AsyncIO | Async/Await |
| Type safety | Dataclasses | Interfaces + Classes |

## Examples

See `examples/basicUsage.ts` for a complete working example.

## Credits

Ported from [browser-use](https://github.com/browser-use/browser-use) Python implementation.
