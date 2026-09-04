import { BrowserContext, Page } from 'playwright';

/**
 * TabManager manages Playwright pages within a browser context.
 * Tracks the current page for use by validatePage().
 */
export class TabManager {
  private context: BrowserContext;
  private currentPage: Page | null = null;
  private currentIndex: number = -1;

  constructor(context: BrowserContext) {
    this.context = context;
    this.initialize();
  }

  /**
   * Initialize the TabManager by:
   * 1. Setting up listeners for new pages
   * 2. Setting up listeners for page close events
   * 3. Setting the initial current page if pages exist
   */
  private initialize(): void {
    // Listen for new pages created in the context
    this.context.on('page', async (page: Page) => {
      await this.handleNewPage(page);
    });

    // Get existing pages and set initial current page
    const existingPages = this.context.pages();
    if (existingPages.length > 0) {
      this.currentPage = existingPages[0];
      this.currentIndex = 0;
    }

    // Listen for new pages that might be created before we set up listeners
    // This handles the case where pages exist before TabManager is created
    for (const page of existingPages) {
      this.setupPageListeners(page);
    }
  }

  /**
   * Handle a new page being created
   */
  private async handleNewPage(page: Page): Promise<void> {
    try {
      this.setupPageListeners(page);
      const index = this.context.pages().indexOf(page);
      await this.setCurrentPage(page, index);
    } catch (error) {
      // Ignore errors for auto opened and closed pages
    }
  }

  /**
   * Set up listeners for a page (close event)
   */
  private setupPageListeners(page: Page): void {
    page.on('close', async () => {
      await this.handlePageClose(page);
    });
  }

  /**
   * Handle a page being closed
   */
  private async handlePageClose(closedPage: Page): Promise<void> {
    try {
      // If the closed page was the current page, switch to the last available page
      if (this.currentPage === closedPage) {
        const pages = this.context.pages();

        // Find first non-closed page from last to first
        // Use slice() to avoid mutating the original array
        const firstNonClosedPage = pages.slice().reverse().find(page => !page.isClosed());
        if (firstNonClosedPage) {
          await this.setCurrentPage(firstNonClosedPage, pages.indexOf(firstNonClosedPage));
        }
      }
    } catch (error) {
      // Ignore errors during cleanup/shutdown when page/context is closing
      // This is expected behavior when tests end
    }
  }

  /**
   * Set the current page
   */
  private async setCurrentPage(page: Page, index: number): Promise<void> {
    const pageChanged = this.currentPage !== page

    // Only bring to front if it's a different page
    this.currentPage = page;
    this.currentIndex = index;

    // Must first update the current page and index, then bring to front
    if (pageChanged) {
      await page.bringToFront();
    }
  }

  /**
   * Switch to a page by index
   * @param index - The index of the page to switch to (0-based)
   * @throws Error if the index is invalid
   */
  async switchToPage(index: number): Promise<Page> {
    const pages = this.context.pages();
    if (index < 0 || index >= pages.length) {
      throw new Error(`Invalid page index: ${index}. Available pages: 0-${pages.length - 1}`);
    }

    const targetPage = pages[index];
    if (targetPage.isClosed()) {
      throw new Error(`Page at index ${index} is closed`);
    }

    await this.setCurrentPage(targetPage, index);
    return targetPage;
  }

  /**
   * Close a page by index
   * @param index - The index of the page to close (0-based)
   * @throws Error if the index is invalid
   */
  async closePage(index: number): Promise<void> {
    const pages = this.context.pages();

    if (index < 0 || index >= pages.length) {
      throw new Error(`Invalid page index: ${index}. Available pages: 0-${pages.length - 1}`);
    }

    const targetPage = pages[index];
    if (targetPage.isClosed()) {
      throw new Error(`Page at index ${index} is already closed`);
    }

    await targetPage.close();
    // The handlePageClose method will automatically handle switching to the last page
    // if the closed page was the current page
  }

  /**
   * Get the current page
   * @returns The current page, or null if no pages are available
   */
  getCurrentPage(): Page | null {
    return this.currentPage;
  }

  /**
   * Get the index of the current page
   * @returns The index of the current page, or -1 if no page is current
   */
  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * Get all pages in the context
   * @returns Array of all pages
   */
  getAllPages(): Page[] {
    return this.context.pages();
  }

  /**
   * Get the number of pages
   * @returns The number of pages in the context
   */
  getPageCount(): number {
    return this.context.pages().length;
  }
}
