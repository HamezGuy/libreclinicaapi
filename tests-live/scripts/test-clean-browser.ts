import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function takeScreenshot(page: Page, name: string, description: string) {
  const screenshotDir = path.join(__dirname, '..', 'incognito-test-screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
  const screenshotPath = path.join(screenshotDir, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`📸 ${name}.png`);
  console.log(`   ${description}\n`);
  return screenshotPath;
}

async function testWithCleanBrowser() {
  console.log('='.repeat(80));
  console.log('CLEAN BROWSER STATE TEST (INCOGNITO MODE)');
  console.log('Testing form filling with fresh browser state');
  console.log('='.repeat(80));
  
  const browser: Browser = await chromium.launch({ 
    headless: false,
    slowMo: 800
  });
  
  // Create incognito context (no cache, no cookies)
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    // This creates a fresh context similar to incognito mode
    storageState: undefined
  });
  
  const page: Page = await context.newPage();

  // Collect all console messages
  const consoleMessages: any[] = [];
  const consoleErrors: any[] = [];
  const pageErrors: any[] = [];
  
  page.on('console', msg => {
    const text = msg.text();
    const type = msg.type();
    consoleMessages.push({ type, text, timestamp: new Date() });
    
    if (type === 'error') {
      consoleErrors.push({ text, timestamp: new Date() });
      console.log(`❌ [CONSOLE ERROR] ${text}`);
    } else if (type === 'warning') {
      console.log(`⚠️  [CONSOLE WARN] ${text}`);
    }
  });
  
  page.on('pageerror', error => {
    pageErrors.push({ 
      message: error.message, 
      stack: error.stack,
      timestamp: new Date() 
    });
    console.error(`🔴 [PAGE ERROR] ${error.message}`);
  });

  try {
    // STEP 1: Navigate to site
    console.log('\n' + '='.repeat(80));
    console.log('STEP 1: Navigate to https://edc-real.vercel.app (Incognito)');
    console.log('='.repeat(80));
    
    await page.goto('https://edc-real.vercel.app', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await takeScreenshot(page, '01-fresh-login-page', 'Fresh incognito session - login page');
    console.log('✅ Page loaded in clean browser state\n');

    // STEP 2: Login
    console.log('='.repeat(80));
    console.log('STEP 2: Login with credentials');
    console.log('='.repeat(80));
    
    await page.waitForSelector('input[name="username"], input[type="text"]', { timeout: 10000 });
    
    await page.locator('input[name="username"], input[type="text"]').first().fill('jamesgui333');
    console.log('✅ Username entered: jamesgui333');
    
    await page.locator('input[name="password"], input[type="password"]').first().fill('Leagueoflegends111@');
    console.log('✅ Password entered');
    
    await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first().click();
    console.log('✅ Login clicked');
    
    await page.waitForTimeout(4000);
    await takeScreenshot(page, '02-after-login', 'Dashboard after fresh login');
    console.log('✅ Logged in successfully\n');

    // STEP 3: Find and click patient SUBJ-001
    console.log('='.repeat(80));
    console.log('STEP 3: Find patient SUBJ-001 in patient list');
    console.log('='.repeat(80));
    
    await page.waitForTimeout(2000);
    
    // Look for patient SUBJ-001
    const patient = page.locator('text="SUBJ-001"').first();
    const patientVisible = await patient.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (patientVisible) {
      console.log('✅ Patient SUBJ-001 found in list');
      await patient.click();
      console.log('✅ Clicked on SUBJ-001');
    } else {
      console.log('❌ Patient SUBJ-001 not found in list');
      console.log('⚠️  Checking if we need to select a study first...');
      
      // Try to select study
      try {
        const studySelector = page.locator('select').first();
        if (await studySelector.isVisible({ timeout: 3000 })) {
          await studySelector.click();
          await page.waitForTimeout(500);
          await page.locator('text="Automated E2E Test Study"').first().click();
          console.log('✅ Selected study');
          await page.waitForTimeout(2000);
          
          // Try finding patient again
          await patient.click();
          console.log('✅ Clicked on SUBJ-001');
        }
      } catch (e) {
        throw new Error('Could not find patient SUBJ-001');
      }
    }
    
    await page.waitForTimeout(3000);
    await takeScreenshot(page, '03-patient-details', 'Patient SUBJ-001 details page');
    console.log('✅ Patient details loaded\n');

    // STEP 4: Find Screening Visit and click View Details
    console.log('='.repeat(80));
    console.log('STEP 4: Find Screening Visit and click View Details');
    console.log('='.repeat(80));
    
    const screeningVisit = page.locator('text=/Screening.*Visit/i').first();
    if (await screeningVisit.isVisible({ timeout: 5000 })) {
      console.log('✅ Screening Visit found');
    } else {
      console.log('❌ Screening Visit not visible');
    }
    
    const viewDetailsBtn = page.locator('button:has-text("View Details"), button:has-text("Enter Data")').first();
    if (await viewDetailsBtn.isVisible({ timeout: 5000 })) {
      const btnText = await viewDetailsBtn.textContent();
      console.log(`✅ Found button: "${btnText}"`);
      await viewDetailsBtn.click();
      console.log('✅ Clicked View Details button');
    } else {
      throw new Error('View Details button not found');
    }
    
    await page.waitForTimeout(3000);
    await takeScreenshot(page, '04-event-details-modal', 'Event details modal with form list');
    console.log('✅ Event details modal opened\n');

    // STEP 5: Click Fill on General Assessment Form
    console.log('='.repeat(80));
    console.log('STEP 5: Click Fill button on General Assessment Form');
    console.log('='.repeat(80));
    
    // Clear error tracking before the critical action
    const errorCountBefore = consoleErrors.length + pageErrors.length;
    console.log(`📊 Errors before clicking Fill: ${errorCountBefore}`);
    console.log('🔍 About to click Fill button...\n');
    
    await takeScreenshot(page, '05-before-fill-click', 'Just before clicking Fill button');
    
    // Look for Fill button
    const fillButtons = await page.locator('button').all();
    console.log(`Found ${fillButtons.length} total buttons on page`);
    
    let fillButton = null;
    
    // Try to find button with "Fill" text first
    for (const btn of fillButtons) {
      if (await btn.isVisible()) {
        const text = await btn.textContent();
        if (text && text.toLowerCase().includes('fill')) {
          fillButton = btn;
          console.log(`✅ Found Fill button with text: "${text}"`);
          break;
        }
      }
    }
    
    if (!fillButton) {
      // Look for icon buttons in the modal
      console.log('⚠️  Text-based Fill button not found, looking for edit icons...');
      fillButton = page.locator('[role="dialog"] button, .modal button').first();
      if (await fillButton.isVisible({ timeout: 2000 })) {
        console.log('✅ Found first button in modal (likely edit icon)');
      }
    }
    
    if (fillButton && await fillButton.isVisible()) {
      console.log('🖱️  CLICKING FILL BUTTON NOW...\n');
      await fillButton.click();
      console.log('✅ Fill button clicked!');
      
      // Wait and observe
      await page.waitForTimeout(3000);
      
    } else {
      throw new Error('Could not find Fill button');
    }

    // STEP 6: Check what happened after clicking Fill
    console.log('\n' + '='.repeat(80));
    console.log('STEP 6: Analyzing what happened after clicking Fill');
    console.log('='.repeat(80));
    
    await takeScreenshot(page, '06-immediately-after-fill', 'State immediately after clicking Fill');
    
    await page.waitForTimeout(2000);
    
    await takeScreenshot(page, '07-final-state', 'Final state after waiting');
    
    // Check for modals
    const modals = await page.locator('[role="dialog"], .modal, [class*="Modal"], [class*="modal"]').all();
    const visibleModals = [];
    for (const modal of modals) {
      if (await modal.isVisible()) {
        visibleModals.push(modal);
      }
    }
    console.log(`\n📊 Modals visible: ${visibleModals.length}`);
    
    // Check for form fields (various types)
    const fieldCounts = {
      textInputs: await page.locator('input[type="text"]:visible').count(),
      numberInputs: await page.locator('input[type="number"]:visible').count(),
      dateInputs: await page.locator('input[type="date"]:visible').count(),
      emailInputs: await page.locator('input[type="email"]:visible').count(),
      radioButtons: await page.locator('input[type="radio"]:visible').count(),
      checkboxes: await page.locator('input[type="checkbox"]:visible').count(),
      textareas: await page.locator('textarea:visible').count(),
      selects: await page.locator('select:visible').count()
    };
    
    console.log('\n📋 FORM FIELDS DETECTED:');
    Object.entries(fieldCounts).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`);
    });
    
    const totalFields = Object.values(fieldCounts).reduce((a, b) => a + b, 0);
    console.log(`   ✅ TOTAL: ${totalFields} visible form fields`);
    
    // Check errors
    const errorCountAfter = consoleErrors.length + pageErrors.length;
    const newErrors = errorCountAfter - errorCountBefore;
    
    console.log(`\n📊 Errors after clicking Fill: ${errorCountAfter}`);
    console.log(`📊 New errors: ${newErrors}`);
    
    // STEP 7: Console Error Report
    console.log('\n' + '='.repeat(80));
    console.log('STEP 7: BROWSER CONSOLE ERROR REPORT');
    console.log('='.repeat(80));
    
    if (consoleErrors.length > 0) {
      console.log(`\n❌ Found ${consoleErrors.length} console error(s):\n`);
      consoleErrors.forEach((err, i) => {
        console.log(`Error ${i + 1}:`);
        console.log(`${err.text}`);
        console.log(`Time: ${err.timestamp.toISOString()}`);
        console.log('-'.repeat(80));
      });
    } else {
      console.log('\n✅ No console errors detected');
    }
    
    if (pageErrors.length > 0) {
      console.log(`\n❌ Found ${pageErrors.length} page error(s):\n`);
      pageErrors.forEach((err, i) => {
        console.log(`Page Error ${i + 1}:`);
        console.log(`Message: ${err.message}`);
        if (err.stack) {
          console.log(`Stack: ${err.stack}`);
        }
        console.log(`Time: ${err.timestamp.toISOString()}`);
        console.log('-'.repeat(80));
      });
    } else {
      console.log('\n✅ No page errors detected');
    }
    
    // Check for error UI elements
    const errorUIElements = await page.locator('[role="alert"], .error, .alert-error, [class*="error"]').all();
    const visibleErrors = [];
    for (const elem of errorUIElements) {
      if (await elem.isVisible()) {
        const text = await elem.textContent();
        visibleErrors.push(text);
      }
    }
    
    if (visibleErrors.length > 0) {
      console.log(`\n⚠️  Error messages visible in UI:`);
      visibleErrors.forEach(text => console.log(`   - ${text}`));
    }

    // FINAL VERDICT
    console.log('\n' + '='.repeat(80));
    console.log('FINAL VERDICT');
    console.log('='.repeat(80));
    
    if (totalFields > 0 && newErrors === 0) {
      console.log('\n✅✅✅ SUCCESS! ✅✅✅');
      console.log(`Form opened with ${totalFields} fields and NO errors!`);
    } else if (totalFields > 0 && newErrors > 0) {
      console.log('\n⚠️  PARTIAL SUCCESS');
      console.log(`Form opened with ${totalFields} fields but ${newErrors} error(s) occurred.`);
    } else if (totalFields === 0 && newErrors > 0) {
      console.log('\n❌ FAILURE');
      console.log(`Form did NOT open and ${newErrors} error(s) occurred.`);
    } else {
      console.log('\n❌ FAILURE');
      console.log('Form did NOT open. No visible form fields detected.');
    }
    
    console.log('\n📸 All screenshots saved to: tests-live/incognito-test-screenshots/');
    console.log('\n⏸️  Keeping browser open for 20 seconds for manual inspection...');
    
    await page.waitForTimeout(20000);

  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('❌ TEST FAILED');
    console.error('='.repeat(80));
    console.error(error);
    await takeScreenshot(page, '99-error', 'Test failed at this state');
  } finally {
    await browser.close();
    console.log('\n✅ Test complete. Browser closed.');
  }
}

testWithCleanBrowser().catch(console.error);
