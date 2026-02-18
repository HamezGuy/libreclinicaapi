import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function takeScreenshot(page: Page, name: string, description: string) {
  const screenshotDir = path.join(__dirname, '..', 'fresh-test-screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
  const screenshotPath = path.join(screenshotDir, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`\n📸 Screenshot: ${name}.png`);
  console.log(`   ${description}`);
  return screenshotPath;
}

async function freshFormTest() {
  console.log('='.repeat(80));
  console.log('FRESH INCOGNITO FORM TEST');
  console.log('Testing form filling with clean browser state');
  console.log('='.repeat(80));
  
  const browser: Browser = await chromium.launch({ 
    headless: false,
    slowMo: 800  // Slow down to observe behavior
  });
  
  // Create incognito context (private browsing)
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    // Incognito mode - no cache, no cookies
    ignoreHTTPSErrors: true
  });
  
  const page: Page = await context.newPage();

  // Collect all console messages
  const consoleMessages: any[] = [];
  const errors: any[] = [];
  
  page.on('console', msg => {
    const text = msg.text();
    const type = msg.type();
    consoleMessages.push({ type, text, timestamp: new Date().toISOString() });
    
    if (type === 'error' || type === 'warning') {
      console.log(`[BROWSER ${type.toUpperCase()}] ${text}`);
    }
  });
  
  page.on('pageerror', error => {
    errors.push({ message: error.message, stack: error.stack, timestamp: new Date().toISOString() });
    console.error(`[PAGE ERROR] ${error.message}`);
  });

  try {
    // STEP 1: Navigate
    console.log('\n' + '='.repeat(80));
    console.log('STEP 1: Navigate to EDC Application');
    console.log('='.repeat(80));
    
    await page.goto('https://edc-real.vercel.app', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await takeScreenshot(page, '01-login-page', 'Fresh login page (incognito mode)');
    console.log('✅ Page loaded');

    // STEP 2: Login
    console.log('\n' + '='.repeat(80));
    console.log('STEP 2: Login');
    console.log('='.repeat(80));
    
    await page.waitForSelector('input[name="username"], input[type="text"]', { timeout: 10000 });
    await page.locator('input[name="username"], input[type="text"]').first().fill('jamesgui333');
    await page.locator('input[name="password"], input[type="password"]').first().fill('Leagueoflegends111@');
    console.log('✅ Credentials entered');
    
    await takeScreenshot(page, '02-credentials-filled', 'Login form with credentials');
    
    await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first().click();
    console.log('✅ Login button clicked, waiting for dashboard...');
    
    await page.waitForTimeout(5000);  // Wait for dashboard to load
    await takeScreenshot(page, '03-dashboard', 'Dashboard after login');

    // STEP 3: Find patient SUBJ-001
    console.log('\n' + '='.repeat(80));
    console.log('STEP 3: Find Patient SUBJ-001');
    console.log('='.repeat(80));
    
    // Check if patient is visible
    const patientVisible = await page.locator('text="SUBJ-001"').isVisible({ timeout: 5000 }).catch(() => false);
    
    if (patientVisible) {
      console.log('✅ Patient SUBJ-001 found');
    } else {
      console.log('⚠️  Patient not immediately visible, checking if study needs to be selected...');
      
      // Try to select study
      try {
        const studySelector = await page.locator('select').first();
        if (await studySelector.isVisible({ timeout: 3000 })) {
          await studySelector.click();
          await page.waitForTimeout(1000);
          const studyOption = page.locator('text="Automated E2E Test Study"').first();
          if (await studyOption.isVisible({ timeout: 2000 })) {
            await studyOption.click();
            console.log('✅ Selected study');
            await page.waitForTimeout(2000);
          }
        }
      } catch (e) {
        console.log('⚠️  Could not select study');
      }
    }
    
    await takeScreenshot(page, '04-patient-list', 'Patient list view');

    // STEP 4: Click on SUBJ-001
    console.log('\n' + '='.repeat(80));
    console.log('STEP 4: Click on Patient SUBJ-001');
    console.log('='.repeat(80));
    
    const patient = page.locator('text="SUBJ-001"').first();
    await patient.waitFor({ state: 'visible', timeout: 10000 });
    await patient.click();
    console.log('✅ Clicked on SUBJ-001');
    
    await page.waitForTimeout(3000);
    await takeScreenshot(page, '05-patient-details', 'Patient details page with visits');

    // STEP 5: Click View Details on Screening Visit
    console.log('\n' + '='.repeat(80));
    console.log('STEP 5: Open Screening Visit');
    console.log('='.repeat(80));
    
    const viewDetailsBtn = page.locator('button:has-text("View Details"), button:has-text("Enter Data")').first();
    await viewDetailsBtn.waitFor({ state: 'visible', timeout: 10000 });
    const btnText = await viewDetailsBtn.textContent();
    console.log(`✅ Found button: "${btnText}"`);
    
    await viewDetailsBtn.click();
    console.log('✅ Clicked View Details');
    
    await page.waitForTimeout(3000);
    await takeScreenshot(page, '06-screening-visit-modal', 'Screening Visit modal with forms list');

    // STEP 6: Click Fill on General Assessment Form
    console.log('\n' + '='.repeat(80));
    console.log('STEP 6: Click Fill/Edit Button on General Assessment Form');
    console.log('='.repeat(80));
    
    // Clear error tracking
    const errorsBeforeFill = errors.length;
    const consoleErrorsBeforeFill = consoleMessages.filter(m => m.type === 'error').length;
    
    console.log('🔍 Looking for Fill/Edit button...');
    
    // Look for any button that might be the Fill button
    // It could be a button with text "Fill" or an icon button
    const allButtons = await page.locator('button').all();
    console.log(`Found ${allButtons.length} buttons on the page`);
    
    // Try to find a Fill button by text first
    let fillButton = null;
    try {
      fillButton = page.locator('button:has-text("Fill"), button:has-text("fill"), button:has-text("Edit"), button:has-text("edit")').first();
      if (await fillButton.isVisible({ timeout: 2000 })) {
        const text = await fillButton.textContent();
        console.log(`✅ Found Fill button with text: "${text}"`);
      } else {
        throw new Error('Not visible');
      }
    } catch (e) {
      console.log('⚠️  Text-based Fill button not found, looking at all buttons...');
      
      // List all visible buttons
      for (let i = 0; i < Math.min(allButtons.length, 20); i++) {
        const btn = allButtons[i];
        if (await btn.isVisible().catch(() => false)) {
          const text = (await btn.textContent() || '').trim();
          const ariaLabel = await btn.getAttribute('aria-label');
          const title = await btn.getAttribute('title');
          console.log(`  Button ${i}: "${text}" aria-label="${ariaLabel}" title="${title}"`);
        }
      }
      
      // Try to find button by looking for the first button in the modal/dialog
      fillButton = page.locator('[role="dialog"] button, .modal button').first();
    }
    
    console.log('📸 Taking screenshot before clicking Fill...');
    await takeScreenshot(page, '07-before-fill-click', 'Right before clicking Fill button');
    
    console.log('🖱️  Clicking Fill button...');
    await fillButton.click();
    console.log('✅ Fill button clicked!');
    
    // Wait for modal to appear or any change
    await page.waitForTimeout(3000);

    // STEP 7: Check what appears after clicking Fill
    console.log('\n' + '='.repeat(80));
    console.log('STEP 7: Analyzing Form Modal');
    console.log('='.repeat(80));
    
    await takeScreenshot(page, '08-after-fill-click', 'Immediately after clicking Fill');
    
    // Check for modals/dialogs
    const modalCount = await page.locator('[role="dialog"], .modal, [class*="Modal"], [class*="modal"]').count();
    console.log(`\n🔍 Modals found: ${modalCount}`);
    
    if (modalCount > 0) {
      const modals = await page.locator('[role="dialog"], .modal, [class*="Modal"], [class*="modal"]').all();
      for (let i = 0; i < modals.length; i++) {
        const modal = modals[i];
        const isVisible = await modal.isVisible().catch(() => false);
        const classes = await modal.getAttribute('class');
        console.log(`  Modal ${i + 1}: visible=${isVisible}, classes="${classes}"`);
      }
    }
    
    // Check for overlay/backdrop
    const overlayCount = await page.locator('[class*="overlay"], [class*="backdrop"], [class*="Overlay"], [class*="Backdrop"]').count();
    console.log(`🔍 Overlays found: ${overlayCount}`);
    
    // Check for form title/header
    const formTitles = await page.locator('h1, h2, h3, h4').allTextContents();
    console.log('\n📝 Visible headers on page:');
    formTitles.slice(0, 10).forEach((title, i) => {
      if (title.trim()) console.log(`  ${i + 1}. "${title.trim()}"`);
    });
    
    // Check for form fields in detail
    const textInputs = await page.locator('input[type="text"]:visible').count();
    const numberInputs = await page.locator('input[type="number"]:visible').count();
    const dateInputs = await page.locator('input[type="date"]:visible').count();
    const emailInputs = await page.locator('input[type="email"]:visible').count();
    const radioButtons = await page.locator('input[type="radio"]:visible').count();
    const checkboxes = await page.locator('input[type="checkbox"]:visible').count();
    const textareas = await page.locator('textarea:visible').count();
    const selects = await page.locator('select:visible').count();
    
    console.log('\n📋 Form Fields Detected:');
    console.log(`  ✏️  Text inputs: ${textInputs}`);
    console.log(`  🔢 Number inputs: ${numberInputs}`);
    console.log(`  📅 Date inputs: ${dateInputs}`);
    console.log(`  📧 Email inputs: ${emailInputs}`);
    console.log(`  🔘 Radio buttons: ${radioButtons}`);
    console.log(`  ☑️  Checkboxes: ${checkboxes}`);
    console.log(`  📝 Textareas: ${textareas}`);
    console.log(`  📂 Select dropdowns: ${selects}`);
    
    const totalFields = textInputs + numberInputs + dateInputs + emailInputs + radioButtons + checkboxes + textareas + selects;
    console.log(`  ✅ TOTAL VISIBLE FIELDS: ${totalFields}`);
    
    // Wait a bit more to see if form is loading
    console.log('\n⏳ Waiting 3 more seconds to see if form loads...');
    await page.waitForTimeout(3000);
    
    await takeScreenshot(page, '09-final-state', 'Final state after waiting');
    
    // Re-check fields after waiting
    const totalFieldsAfterWait = await page.locator('input:visible, textarea:visible, select:visible').count();
    console.log(`📋 Form fields after waiting: ${totalFieldsAfterWait}`);

    // STEP 8: Error Analysis
    console.log('\n' + '='.repeat(80));
    console.log('STEP 8: Error Analysis');
    console.log('='.repeat(80));
    
    const errorsAfterFill = errors.length;
    const newPageErrors = errors.slice(errorsBeforeFill);
    
    console.log(`\n🔍 Page errors before Fill: ${errorsBeforeFill}`);
    console.log(`🔍 Page errors after Fill: ${errorsAfterFill}`);
    console.log(`🔍 New page errors: ${newPageErrors.length}`);
    
    if (newPageErrors.length > 0) {
      console.log('\n❌ NEW PAGE ERRORS DETECTED:');
      newPageErrors.forEach((err, i) => {
        console.log(`\n  Error ${i + 1}:`);
        console.log(`    Message: ${err.message}`);
        console.log(`    Time: ${err.timestamp}`);
        if (err.stack) {
          console.log(`    Stack: ${err.stack.split('\n').slice(0, 3).join('\n')}`);
        }
      });
    } else {
      console.log('\n✅ No new page errors');
    }
    
    const consoleErrorsAfterFill = consoleMessages.filter(m => m.type === 'error');
    const newConsoleErrors = consoleErrorsAfterFill.slice(consoleErrorsBeforeFill);
    
    console.log(`\n🔍 Console errors before Fill: ${consoleErrorsBeforeFill}`);
    console.log(`🔍 Console errors after Fill: ${consoleErrorsAfterFill.length}`);
    console.log(`🔍 New console errors: ${newConsoleErrors.length}`);
    
    if (newConsoleErrors.length > 0) {
      console.log('\n❌ NEW CONSOLE ERRORS:');
      newConsoleErrors.forEach((msg, i) => {
        console.log(`\n  ${i + 1}. ${msg.text}`);
        console.log(`     Time: ${msg.timestamp}`);
      });
    } else {
      console.log('\n✅ No new console errors');
    }

    // FINAL VERDICT
    console.log('\n' + '='.repeat(80));
    console.log('FINAL REPORT');
    console.log('='.repeat(80));
    
    console.log('\n📊 SUMMARY:');
    console.log(`  🖼️  Modals visible: ${modalCount}`);
    console.log(`  🎨 Dark overlay present: ${overlayCount > 0 ? 'YES' : 'NO'}`);
    console.log(`  📝 Form fields visible: ${totalFieldsAfterWait}`);
    console.log(`  ❌ JavaScript errors: ${newPageErrors.length + newConsoleErrors.length}`);
    
    if (modalCount > 0 && totalFieldsAfterWait > 2) {
      console.log('\n✅✅✅ SUCCESS! Form modal opened with fields!');
    } else if (totalFieldsAfterWait > 2) {
      console.log('\n⚠️  Form fields detected but no modal container found');
    } else if (modalCount > 0) {
      console.log('\n⚠️  Modal container found but no form fields visible');
    } else {
      console.log('\n❌ Form modal did NOT open - no modal or fields visible');
    }
    
    if (newPageErrors.length > 0 || newConsoleErrors.length > 0) {
      console.log('\n⚠️  JavaScript errors were detected during form opening');
    }
    
    console.log('\n📸 All screenshots saved to: tests-live/fresh-test-screenshots/');
    console.log('\n⏸️  Keeping browser open for 20 seconds for manual inspection...');
    await page.waitForTimeout(20000);

  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('❌ TEST FAILED');
    console.error('='.repeat(80));
    console.error(error);
    await takeScreenshot(page, '99-error', 'Error state');
  } finally {
    await context.close();
    await browser.close();
    console.log('\n✅ Test complete, browser closed');
  }
}

freshFormTest().catch(console.error);
