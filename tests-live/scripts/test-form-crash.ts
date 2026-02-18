import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function takeScreenshot(page: Page, name: string, description: string) {
  const screenshotDir = path.join(__dirname, '..', 'crash-test-screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
  const screenshotPath = path.join(screenshotDir, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`\n📸 ${name}.png - ${description}`);
  return screenshotPath;
}

async function testFormFillingCrash() {
  console.log('='.repeat(80));
  console.log('FORM FILLING CRASH TEST');
  console.log('Testing if form opens correctly without crashing');
  console.log('='.repeat(80));
  
  const browser: Browser = await chromium.launch({ 
    headless: false,
    slowMo: 500
  });
  
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  
  const page: Page = await context.newPage();

  // Collect console messages
  const consoleMessages: any[] = [];
  const errors: any[] = [];
  
  page.on('console', msg => {
    const text = msg.text();
    consoleMessages.push({ type: msg.type(), text });
    console.log(`[CONSOLE ${msg.type().toUpperCase()}] ${text}`);
  });
  
  page.on('pageerror', error => {
    errors.push(error);
    console.error(`[PAGE ERROR] ${error.message}`);
  });

  try {
    // STEP 1: Login
    console.log('\n' + '='.repeat(80));
    console.log('STEP 1: Login');
    console.log('='.repeat(80));
    
    await page.goto('https://edc-real.vercel.app', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await takeScreenshot(page, '01-login-page', 'Initial login page');

    // Fill and submit login
    await page.waitForSelector('input[name="username"], input[type="text"]');
    await page.locator('input[name="username"], input[type="text"]').first().fill('jamesgui333');
    await page.locator('input[name="password"], input[type="password"]').first().fill('Leagueoflegends111@');
    console.log('✓ Credentials entered');
    
    await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first().click();
    console.log('✓ Login clicked');

    // STEP 2: Wait for dashboard
    console.log('\n' + '='.repeat(80));
    console.log('STEP 2: Wait for Dashboard');
    console.log('='.repeat(80));
    
    await page.waitForTimeout(4000);
    await takeScreenshot(page, '02-dashboard-loaded', 'Dashboard after login');
    console.log('✓ Dashboard loaded');

    // STEP 3: Select study
    console.log('\n' + '='.repeat(80));
    console.log('STEP 3: Select Study');
    console.log('='.repeat(80));
    
    try {
      const studySelector = await page.locator('select, [role="combobox"], button:has-text("Filter by Study")').first();
      if (await studySelector.isVisible({ timeout: 3000 })) {
        await studySelector.click();
        await page.waitForTimeout(1000);
        
        const studyOption = page.locator('text="Automated E2E Test Study"').first();
        if (await studyOption.isVisible({ timeout: 2000 })) {
          await studyOption.click();
          console.log('✓ Selected "Automated E2E Test Study"');
        }
      }
    } catch (e) {
      console.log('⚠ Study selector not found or already selected');
    }
    
    await page.waitForTimeout(2000);
    await takeScreenshot(page, '03-study-selected', 'After study selection');

    // STEP 4: Click patient SUBJ-001
    console.log('\n' + '='.repeat(80));
    console.log('STEP 4: Click Patient SUBJ-001');
    console.log('='.repeat(80));
    
    const patient = page.locator('text="SUBJ-001"').first();
    if (await patient.isVisible({ timeout: 5000 })) {
      await patient.click();
      console.log('✓ Clicked patient SUBJ-001');
    } else {
      throw new Error('Patient SUBJ-001 not found');
    }
    
    await page.waitForTimeout(3000);
    await takeScreenshot(page, '04-patient-details', 'Patient details page');

    // STEP 5: Click View Details on Screening Visit
    console.log('\n' + '='.repeat(80));
    console.log('STEP 5: Open Screening Visit Details');
    console.log('='.repeat(80));
    
    const viewDetailsBtn = page.locator('button:has-text("View Details"), button:has-text("Enter Data")').first();
    if (await viewDetailsBtn.isVisible({ timeout: 5000 })) {
      const btnText = await viewDetailsBtn.textContent();
      console.log(`✓ Found button: "${btnText}"`);
      await viewDetailsBtn.click();
      console.log('✓ Clicked View Details');
    } else {
      throw new Error('View Details button not found');
    }
    
    await page.waitForTimeout(3000);
    await takeScreenshot(page, '05-event-modal-opened', 'Event details modal');

    // STEP 6: Click Fill on General Assessment Form
    console.log('\n' + '='.repeat(80));
    console.log('STEP 6: Click Fill Button on General Assessment Form');
    console.log('='.repeat(80));
    
    console.log('Looking for Fill button...');
    
    // Clear console before the critical action
    const errorsBefore = errors.length;
    
    // Try to find the Fill button - look for text "Fill" or edit icons
    const fillButtonSelectors = [
      'button:has-text("Fill")',
      'button:has-text("fill")',
      'button[aria-label*="fill" i]',
      'button[title*="fill" i]'
    ];
    
    let fillButton = null;
    for (const selector of fillButtonSelectors) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          fillButton = btn;
          console.log(`✓ Found Fill button with selector: ${selector}`);
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }
    
    if (!fillButton) {
      console.log('⚠ Text-based Fill button not found, looking for icon buttons...');
      // Look for buttons in the modal that might be the edit/fill icon
      const buttons = await page.locator('button').all();
      console.log(`Found ${buttons.length} buttons on page`);
      
      // Look for a button with an icon (might not have text)
      for (let i = 0; i < buttons.length; i++) {
        const btn = buttons[i];
        if (await btn.isVisible()) {
          const text = await btn.textContent();
          const ariaLabel = await btn.getAttribute('aria-label');
          console.log(`  Button ${i}: text="${text?.trim()}", aria-label="${ariaLabel}"`);
        }
      }
      
      // Try clicking the first visible button that might be a Fill button
      // Look for buttons inside the modal
      fillButton = page.locator('[role="dialog"] button, .modal button').first();
    }
    
    if (fillButton && await fillButton.isVisible({ timeout: 2000 })) {
      console.log('🔍 About to click Fill button...');
      console.log('🔍 Monitoring for errors...');
      
      await takeScreenshot(page, '06-before-fill-click', 'Just before clicking Fill');
      
      // Click the Fill button
      await fillButton.click();
      console.log('✓ Fill button clicked!');
      
      // Wait a moment for any modal or form to appear
      await page.waitForTimeout(2000);
      
    } else {
      throw new Error('Could not find Fill button');
    }

    // STEP 7: Check what appears after clicking Fill
    console.log('\n' + '='.repeat(80));
    console.log('STEP 7: Checking What Appeared After Fill Click');
    console.log('='.repeat(80));
    
    await takeScreenshot(page, '07-after-fill-click', 'Immediately after clicking Fill');
    
    // Wait a bit more to see if anything loads
    await page.waitForTimeout(2000);
    
    // Check for modal
    const modalVisible = await page.locator('[role="dialog"], .modal, [class*="Modal"]').count();
    console.log(`Modals visible: ${modalVisible}`);
    
    // Check for form fields
    const textInputs = await page.locator('input[type="text"]:visible').count();
    const numberInputs = await page.locator('input[type="number"]:visible').count();
    const dateInputs = await page.locator('input[type="date"]:visible').count();
    const radioButtons = await page.locator('input[type="radio"]:visible').count();
    const checkboxes = await page.locator('input[type="checkbox"]:visible').count();
    const textareas = await page.locator('textarea:visible').count();
    const selects = await page.locator('select:visible').count();
    
    console.log('\n📋 Form Fields Count:');
    console.log(`  - Text inputs: ${textInputs}`);
    console.log(`  - Number inputs: ${numberInputs}`);
    console.log(`  - Date inputs: ${dateInputs}`);
    console.log(`  - Radio buttons: ${radioButtons}`);
    console.log(`  - Checkboxes: ${checkboxes}`);
    console.log(`  - Textareas: ${textareas}`);
    console.log(`  - Select dropdowns: ${selects}`);
    
    const totalFields = textInputs + numberInputs + dateInputs + radioButtons + checkboxes + textareas + selects;
    console.log(`  - TOTAL VISIBLE FIELDS: ${totalFields}`);
    
    if (totalFields > 0) {
      console.log('\n✅ SUCCESS: Form fields are visible!');
    } else {
      console.log('\n⚠ WARNING: No visible form fields detected!');
    }
    
    await takeScreenshot(page, '08-form-state-final', 'Final state after waiting');

    // STEP 8: Check for errors
    console.log('\n' + '='.repeat(80));
    console.log('STEP 8: Error Check');
    console.log('='.repeat(80));
    
    const errorsAfter = errors.length;
    const newErrors = errors.slice(errorsBefore);
    
    console.log(`\n🔍 Errors before Fill click: ${errorsBefore}`);
    console.log(`🔍 Errors after Fill click: ${errorsAfter}`);
    console.log(`🔍 New errors: ${newErrors.length}`);
    
    if (newErrors.length > 0) {
      console.log('\n❌ ERRORS DETECTED:');
      newErrors.forEach((err, i) => {
        console.log(`\nError ${i + 1}:`);
        console.log(`  Message: ${err.message}`);
        console.log(`  Stack: ${err.stack}`);
      });
    } else {
      console.log('\n✅ No errors detected after clicking Fill');
    }
    
    // Check for error messages in the UI
    const errorElements = await page.locator('[role="alert"], .error, .alert-error, [class*="error" i]').count();
    console.log(`\nError UI elements visible: ${errorElements}`);
    
    if (errorElements > 0) {
      const errorTexts = await page.locator('[role="alert"], .error, .alert-error').allTextContents();
      console.log('Error messages:');
      errorTexts.forEach(text => console.log(`  - ${text}`));
    }

    // STEP 9: Console log summary
    console.log('\n' + '='.repeat(80));
    console.log('CONSOLE LOG SUMMARY');
    console.log('='.repeat(80));
    
    const consoleErrors = consoleMessages.filter(m => m.type === 'error');
    const consoleWarnings = consoleMessages.filter(m => m.type === 'warning');
    
    console.log(`Total console messages: ${consoleMessages.length}`);
    console.log(`  - Errors: ${consoleErrors.length}`);
    console.log(`  - Warnings: ${consoleWarnings.length}`);
    
    if (consoleErrors.length > 0) {
      console.log('\n❌ Console Errors:');
      consoleErrors.forEach((msg, i) => {
        console.log(`  ${i + 1}. ${msg.text}`);
      });
    }

    // Final summary
    console.log('\n' + '='.repeat(80));
    console.log('FINAL VERDICT');
    console.log('='.repeat(80));
    
    if (totalFields > 0 && newErrors.length === 0 && consoleErrors.length === 0) {
      console.log('\n✅✅✅ SUCCESS! Form opens without crashing! ✅✅✅');
      console.log(`Form has ${totalFields} visible fields and no errors detected.`);
    } else if (totalFields > 0 && (newErrors.length > 0 || consoleErrors.length > 0)) {
      console.log('\n⚠️ PARTIAL SUCCESS: Form opens but has errors');
      console.log(`Form has ${totalFields} visible fields but ${newErrors.length} errors detected.`);
    } else if (totalFields === 0) {
      console.log('\n❌ ISSUE: No form fields visible after clicking Fill');
      console.log('The form modal may not have opened correctly.');
    }
    
    console.log('\nKeeping browser open for 15 seconds for manual inspection...');
    await page.waitForTimeout(15000);

  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('❌ TEST FAILED WITH ERROR');
    console.error('='.repeat(80));
    console.error(error);
    await takeScreenshot(page, '99-error-state', 'Error state');
  } finally {
    await browser.close();
    console.log('\n✅ Browser closed. Test complete.');
    console.log(`\nScreenshots saved to: tests-live/crash-test-screenshots/`);
  }
}

testFormFillingCrash().catch(console.error);
