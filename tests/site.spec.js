import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readResumeContent } from '../scripts/resume-content.js';

for (const colorScheme of ['light', 'dark']) {
  for (const width of [375, 768, 1440]) {
    test(`home and career are accessible and fit at ${width}px in ${colorScheme} mode`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 900 });
      const failures = [];
      page.on('pageerror', (error) => failures.push(error.message));
      page.on('response', (response) => {
        if (response.url().startsWith('http://127.0.0.1') && response.status() >= 400)
          failures.push(response.url());
      });
      for (const path of ['/', '/career/']) {
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator('h1')).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        for (const image of await page.locator('img').all()) {
          await image.scrollIntoViewIfNeeded();
          await expect
            .poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0))
            .toBe(true);
        }
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        expect(results.violations).toEqual([]);
      }
      expect(failures).toEqual([]);
    });
  }
}

test('browser theme changes update the site and both dashboard previews immediately', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('[data-project="metrics"]').click();
  for (const colorScheme of ['dark', 'light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator('html')).toHaveCSS(
      'background-color',
      colorScheme === 'dark' ? 'rgb(13, 20, 33)' : 'rgb(255, 255, 255)',
    );
    for (const selector of ['.eye-dashboard img', '.dialog-preview img']) {
      await expect
        .poll(() => page.locator(selector).evaluate((image) => image.currentSrc))
        .toContain(`the-eye-${colorScheme}`);
      await expect
        .poll(() =>
          page.locator(selector).evaluate((image) => image.complete && image.naturalWidth > 0),
        )
        .toBe(true);
    }
  }
  await expect(page.locator('#project-dialog-title')).toHaveText('The Eye');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('project dialogs support keyboard close, focus restoration, and valid destinations', async ({
  page,
}) => {
  await page.goto('/');
  for (const project of ['auction', 'metrics', 'community']) {
    const trigger = page.locator(`[data-project="${project}"]`);
    await trigger.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('#project-dialog-title')).not.toBeEmpty();
    await expect(page.getByRole('dialog').getByRole('link').first()).toHaveAttribute(
      'href',
      /^(https:\/\/|mailto:|\.\/career\/)/,
    );
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(page.locator('body')).not.toHaveClass(/dialog-open/);
  }
});

test('career direct links, old links, and back navigation work', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Career' })
    .click();
  await expect(page).toHaveURL(/\/career\/$/);
  await page.reload();
  await expect(page).toHaveTitle(/Career & Resume/);
  await page.goBack();
  await expect(page).toHaveURL('http://127.0.0.1:4173/');
  await page.goto('/#career');
  await expect(page).toHaveURL(/\/career\/$/);
  await page
    .getByRole('navigation', { name: 'Career sections' })
    .getByRole('link', { name: 'Skills', exact: true })
    .click();
  await expect(page).toHaveURL(/#capabilities$/);
  await expect(
    page.locator('#capabilities').getByRole('heading', { name: 'AI Proficiency' }),
  ).toBeVisible();
});

test('email copy handles success and an unavailable clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  for (const route of ['/', '/career/']) {
    await page.goto(route);
    await page.getByRole('button', { name: 'Copy email address' }).click();
    await expect(page.getByRole('status')).toHaveText('Email copied!');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'jon.k.williams.711@gmail.com',
    );
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => {
        throw new Error('Denied');
      };
    });
    await page.getByRole('button', { name: 'Copy email address' }).click();
    await expect(page.getByRole('status')).toContainText('Select the email address');
  }
});

test('email links target the correct address and clicks are not blocked by the site', async ({
  page,
}) => {
  for (const route of ['/', '/career/']) {
    await page.goto(route);
    await expect(page.locator('.header-contact')).toHaveAttribute(
      'href',
      'mailto:jon.k.williams.711@gmail.com',
    );
    await page.evaluate(() => {
      window.emailClicks = [];
      window.addEventListener('click', (event) => {
        const link = event.target.closest('a[href^="mailto:"]');
        if (!link) return;
        window.emailClicks.push({ href: link.href, blocked: event.defaultPrevented });
        // Observe the real click without opening an external email application during the test.
        event.preventDefault();
      });
    });
    const links = await page.locator('a[href^="mailto:"]').all();
    for (const link of links) await link.click();
    const clicks = await page.evaluate(() => window.emailClicks);
    expect(clicks).toHaveLength(links.length);
    for (const click of clicks) {
      expect(click.blocked).toBe(false);
      expect(new URL(click.href).pathname).toBe('jon.k.williams.711@gmail.com');
    }
  }
});

test('resume downloads a complete PDF without requesting a printer', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/career/');
  await page.evaluate(() => {
    window.print = () => {
      window.printRequested = true;
    };
  });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download resume (PDF)' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('Jon-Williams-Resume.pdf');
  expect(await download.failure()).toBeNull();
  expect(await page.evaluate(() => window.printRequested)).toBeUndefined();
  await expect(page).toHaveURL(/\/career\/$/);
  await expect(page.locator('#career-title')).toBeVisible();
  const path = testInfo.outputPath('resume.pdf');
  await download.saveAs(path);
  const bytes = await readFile(path);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try {
    const pdf = await task.promise;
    expect(pdf.numPages).toBe(2);
    const pages = [];
    const urls = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const pdfPage = await pdf.getPage(i);
      const content = await pdfPage.getTextContent();
      const strings = content.items.filter((item) => 'str' in item);
      pages.push(
        strings
          .map((item) => item.str)
          .join(' ')
          .replace(/\s+/g, ' '),
      );
      // Text must stay inside the page rather than being clipped or pushed into a footer.
      for (const item of strings.filter((item) => item.str.trim())) {
        expect(item.transform[4]).toBeGreaterThanOrEqual(40);
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(570);
        expect(item.transform[5]).toBeGreaterThan(28);
      }
      urls.push(
        ...(await pdfPage.getAnnotations()).map((annotation) => annotation.url).filter(Boolean),
      );
    }
    const text = pages.join(' ');
    const source = await readResumeContent();
    const values = (value) =>
      typeof value === 'string' ? [value] : Object.values(value).flatMap(values);
    for (const value of values(source))
      expect(text).toContain(
        value.replace('https://github.com/Jonny-Ringo', 'github.com/Jonny-Ringo'),
      );
    for (const link of source.projects.flatMap((project) => project.links))
      expect(urls).toContain(link.url);
    expect(pages[0]).toContain('Technical Support Specialist');
    expect(pages[1]).toContain('AI Proficiency');
    expect(text).toContain('Maintained PPE and ergonomic practices');
  } finally {
    await task.destroy();
  }
});

test('content and navigation work without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/');
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(13, 20, 33)');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Career' })
    .click();
  await expect(page).toHaveURL(/\/career\/$/);
  await expect(page.locator('#experience')).toContainText('Intel', { ignoreCase: true });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download resume (PDF)' }).click();
  expect(await (await downloadEvent).failure()).toBeNull();
  await context.close();
});
