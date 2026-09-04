import { test, expect } from '@playwright/test';

test.describe('fixture exports', () => {
  test('exports test as a function (extended base test)', async () => {
    const fixture = await import('../../src/fixture');
    expect(typeof fixture.test).toBe('function');
    // Playwright's extended test has an `extend` method
    expect(typeof fixture.test.extend).toBe('function');
    expect(typeof fixture.test.describe).toBe('function');
  });

  test('exports expect from Playwright', async () => {
    const fixture = await import('../../src/fixture');
    expect(typeof fixture.expect).toBe('function');
    // Verify it's Playwright's expect — it has .soft and .configure
    expect(typeof (fixture.expect as any).soft).toBe('function');
    expect(typeof (fixture.expect as any).configure).toBe('function');
  });

  test('test and expect are distinct from each other', async () => {
    const fixture = await import('../../src/fixture');
    expect(fixture.test).not.toBe(fixture.expect);
  });

  test('test.extend is available for further extension', async () => {
    const fixture = await import('../../src/fixture');
    // User should be able to further extend the fixture
    const extended = fixture.test.extend<{ myFixture: string }>({
      myFixture: async ({}, use) => { // eslint-disable-line no-empty-pattern
        await use('hello');
      },
    });
    expect(typeof extended).toBe('function');
    expect(typeof extended.describe).toBe('function');
  });
});
