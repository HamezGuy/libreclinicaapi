import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function takeScreenshot(page: Page, name: string, description: string) {
  const screenshotDir = path.join(__dirname, '..', 'ui-screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
  const screenshotPath = path.join(screenshotDir, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`\n📸 Screenshot: ${name}.png`);
  console.log(`   ${description}`);
  console.log(`   Saved to: ${screenshotPath}\n`);
}

async function detailedUITest() {
  console.log('='.repeat(80));
  console.log('DETAILED UI DIAGNOSTIC TEST');
  console.log('='.repeat(80));
  
  const browser: Browser = await chromium.launch({ 
    headless: false,
    slowMo: 500
  });
  
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  
  const page: Page = await context.newPage();

  try {
    // STEP 1: Login Page
    console.log('\n' + '='.repeat(80));
    console.log('STEP 1: Navigate to Login Page');
    console.log('='.repeat(80));
    await page.goto('https://edc-real.vercel.app', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await takeScreenshot(page, 'step1-login-page', 'Initial login page view');

    // STEP 2: Fill Login Form and Submit
    console.log('='.repeat(80));
    console.log('STEP 2: Login with Credentials');
    console.log('='.repeat(80));
    
    // Wait for and fill username
    await page.waitForSelector('input[name="username"], input[type="text"]', { timeout: 10000 });
    const usernameInput = await page.locator('input[name="username"], input[type="text"]').first();
    await usernameInput.fill('jamesgui333');
    console.log('✓ Entered username: jamesgui333');
    
    // Fill password
    const passwordInput = await page.locator('input[name="password"], input[type="password"]').first();
    await passwordInput.fill('Leagueoflegends111@');
    console.log('✓ Entered password');
    
    await takeScreenshot(page, 'step2-login-filled', 'Login form filled with credentials');
    
    // Click login
    const loginButton = await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first();
    await loginButton.click();
    console.log('✓ Clicked login button');
    
    await page.waitForTimeout(3000);

    // STEP 3: Dashboard After Login
    console.log('='.repeat(80));
    console.log('STEP 3: Dashboard After Login');
    console.log('='.repeat(80));
    await takeScreenshot(page, 'step3-dashboard', 'Dashboard view after successful login');
    
    const url = page.url();
    console.log(`Current URL: ${url}`);

    // STEP 4: Select Study
    console.log('='.repeat(80));
    console.log('STEP 4: Select Study "Automated E2E Test Study"');
    console.log('='.repeat(80));
    
    // Look for study selector
    await page.waitForTimeout(1000);
    
    // Try different selectors for study dropdown
    const studySelectors = [
      'button:has-text("Filter by Study")',
      'select',
      '[role="combobox"]',
      'button:has-text("Study")',
      '.study-selector',
      'button:has-text("Automated E2E")'
    ];
    
    let studySelectorFound = false;
    for (const selector of studySelectors) {
      try {
        const element = page.locator(selector).first();
        if (await element.isVisible({ timeout: 2000 })) {
          console.log(`✓ Found study selector with: ${selector}`);
          await element.click();
          await page.waitForTimeout(1000);
          studySelectorFound = true;
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }
    
    if (!studySelectorFound) {
      console.log('⚠ No obvious study selector found, might already be filtered');
    }
    
    // Try to select the study
    try {
      const studyOption = page.locator('text="Automated E2E Test Study"').first();
      if (await studyOption.isVisible({ timeout: 3000 })) {
        await studyOption.click();
        console.log('✓ Selected "Automated E2E Test Study"');
      }
    } catch (e) {
      console.log('⚠ Could not find study option to click');
    }
    
    await page.waitForTimeout(2000);
    await takeScreenshot(page, 'step4-study-selected', 'After selecting Automated E2E Test Study');

    // STEP 5: Find and Click Patient SUBJ-001
    console.log('='.repeat(80));
    console.log('STEP 5: Find and Click Patient SUBJ-001');
    console.log('='.repeat(80));
    
    await page.waitForTimeout(1000);
    
    // Look for patient SUBJ-001
    const patientLocators = [
      'text="SUBJ-001"',
      'td:has-text("SUBJ-001")',
      'tr:has-text("SUBJ-001")',
      '[data-testid*="SUBJ-001"]'
    ];
    
    let patientFound = false;
    for (const locator of patientLocators) {
      try {
        const patient = page.locator(locator).first();
        if (await patient.isVisible({ timeout: 3000 })) {
          console.log(`✓ Found patient with locator: ${locator}`);
          await patient.click();
          console.log('✓ Clicked on patient SUBJ-001');
          patientFound = true;
          break;
        }
      } catch (e) {
        // Try next locator
      }
    }
    
    if (!patientFound) {
      console.log('✗ Could not find patient SUBJ-001');
      console.log('Visible text on page:');
      const bodyText = await page.locator('body').textContent();
      console.log(bodyText?.substring(0, 300) + '...');
    }
    
    await page.waitForTimeout(3000);
    await takeScreenshot(page, 'step5-patient-details', 'Patient SUBJ-001 details page showing visits');

    // STEP 6: Click View Details on Screening Visit
    console.log('='.repeat(80));
    console.log('STEP 6: Click "View Details" on Screening Visit');
    console.log('='.repeat(80));
    
    // Look for Screening Visit and action buttons
    const screeningVisitLocators = [
      'button:has-text("View Details")',
      'button:has-text("Enter Data")',
      'text=/Screening.*Visit/i',
    ];
    
    let actionButtonFound = false;
    
    // First try to find View Details or Enter Data button directly
    for (const locator of ['button:has-text("View Details")', 'button:has-text("Enter Data")']) {
      try {
        const button = page.locator(locator).first();
        if (await button.isVisible({ timeout: 3000 })) {
          const buttonText = await button.textContent();
          console.log(`✓ Found button: "${buttonText}"`);
          await button.click();
          console.log('✓ Clicked the button');
          actionButtonFound = true;
          break;
        }
      } catch (e) {
        // Try next
      }
    }
    
    if (!actionButtonFound) {
      console.log('⚠ Specific action button not found, trying to click on Screening Visit text');
      try {
        const screeningVisit = page.locator('text=/Screening.*Visit/i').first();
        if (await screeningVisit.isVisible({ timeout: 3000 })) {
          await screeningVisit.click();
          console.log('✓ Clicked on Screening Visit');
        }
      } catch (e) {
        console.log('✗ Could not find or click Screening Visit');
      }
    }
    
    await page.waitForTimeout(3000);
    await takeScreenshot(page, 'step6-event-modal', 'Event details modal showing forms');

    // STEP 7: Click Fill Button on a Form
    console.log('='.repeat(80));
    console.log('STEP 7: Click "Fill" Button on a Form');
    console.log('='.repeat(80));
    
    // Look for Fill button
    const fillButtonLocators = [
      'button:has-text("Fill")',
      'button[title*="fill" i]',
      'button[aria-label*="fill" i]',
      '.fill-button',
      'button:has-text("Edit")',
      '[data-testid*="fill"]'
    ];
    
    let fillButtonFound = false;
    for (const locator of fillButtonLocators) {
      try {
        const fillButton = page.locator(locator).first();
        if (await fillButton.isVisible({ timeout: 3000 })) {
          const buttonText = await fillButton.textContent();
          console.log(`✓ Found fill/edit button: "${buttonText || 'icon button'}"`);
          await fillButton.click();
          console.log('✓ Clicked the fill button');
          fillButtonFound = true;
          break;
        }
      } catch (e) {
        // Try next
      }
    }
    
    if (!fillButtonFound) {
      console.log('✗ Could not find Fill button');
      console.log('Looking for any buttons in the modal...');
      const buttons = await page.locator('button').all();
      console.log(`Found ${buttons.length} buttons on page`);
      for (let i = 0; i < Math.min(buttons.length, 10); i++) {
        const text = await buttons[i].textContent();
        const visible = await buttons[i].isVisible();
        console.log(`  Button ${i}: "${text}" (visible: ${visible})`);
      }
    }
    
    await page.waitForTimeout(3000);
    await takeScreenshot(page, 'step7-after-fill-click', 'After clicking Fill button');

    // STEP 8: Form with Fields
    console.log('='.repeat(80));
    console.log('STEP 8: Check if Form Opened with Fields');
    console.log('='.repeat(80));
    
    // Count form fields
    const inputFields = await page.locator('input[type="text"], input[type="number"], input[type="date"]').count();
    const textareas = await page.locator('textarea').count();
    const selects = await page.locator('select').count();
    const totalFields = inputFields + textareas + selects;
    
    console.log(`Form Fields Found:`);
    console.log(`  - Text/Number/Date inputs: ${inputFields}`);
    console.log(`  - Textareas: ${textareas}`);
    console.log(`  - Select dropdowns: ${selects}`);
    console.log(`  - TOTAL: ${totalFields}`);
    
    if (totalFields > 0) {
      console.log('✅ SUCCESS: Form fields are visible!');
    } else {
      console.log('⚠ WARNING: No form fields detected');
      console.log('Page might show something else (error, loading, etc.)');
    }
    
    await takeScreenshot(page, 'step8-form-fields', 'Form view with input fields (if any)');

    // FINAL SUMMARY
    console.log('\n' + '='.repeat(80));
    console.log('FINAL SUMMARY');
    console.log('='.repeat(80));
    
    // Check what's currently visible
    const pageTitle = await page.title();
    const currentUrl = page.url();
    console.log(`Page Title: ${pageTitle}`);
    console.log(`Current URL: ${currentUrl}`);
    
    // Check for modals
    const modalCount = await page.locator('[role="dialog"], .modal, [class*="modal"]').count();
    console.log(`Modals visible: ${modalCount}`);
    
    // Check for forms
    const formCount = await page.locator('form').count();
    console.log(`Forms on page: ${formCount}`);
    
    // Check for any error messages
    const errorElements = await page.locator('[role="alert"], .error, .alert-error, [class*="error"]').count();
    console.log(`Error elements: ${errorElements}`);
    
    console.log('\n✅ All screenshots saved to: tests-live/ui-screenshots/');
    console.log('\nKeeping browser open for 10 seconds for manual inspection...');
    
    await page.waitForTimeout(10000);

  } catch (error) {
    console.error('\n❌ ERROR OCCURRED:', error);
    await takeScreenshot(page, 'error-final', 'Error state when test failed');
  } finally {
    await browser.close();
    console.log('\n✅ Test completed and browser closed.');
  }
}

detailedUITest().catch(console.error);
