class NodeJSCodeCommon {
    private readonly version: string;
    private readonly goal: string;
    private readonly url: string;

    constructor(version: string, data: { goal: string, url: string }) {
        this.version = version;
        this.goal = data.goal;
        this.url = data.url;
    }

    // Returns the code for the prelude
    generatePrelude(): string {
        let prelude = `// version ${this.version}\n`;

        const goal = this.goal;
        const url = this.url;

        prelude += `// Navigate to the specified URL
const targetUrl = process.env.PLAYWRIGHT_STARTING_URL || '${url}';
if (targetUrl !== null) {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
}

// wait for page to load and give it a chance to stabilize
await page.waitForLoadState('load', { timeout: 15000 });
await page.waitForTimeout(2000);
\n`;

        // goal can be a multiple line string, so we need to split it into multiple lines
        prelude += `  // Goal:\n`;
        const goalLines = goal.trim().split('\n');
        for (const line of goalLines) {
            prelude += `  //    ${line}\n`;
        }
        return prelude;
    }

    // Returns the code for the postlude
    generatePostlude(): string {
        return "";
    }
}

export { NodeJSCodeCommon };
