import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function takeScreenshot(page: Page, name: string) {
  const screenshotDir = path.join(__dirname, '..', 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
  const screenshotPath = path.join(screenshotDir, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot saved: ${screenshotPath}`);
}

async function testFormFlow() {
  console.log('Starting form filling flow test...\n');
  
  const browser: Browser = await chromium.launch({ 
    headless: false,
    slowMo: 1000 // Slow down by 1 second for visibility
  });
  
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  
  const page: Page = await context.newPage();

  try {
    // Step 1: Navigate to the site
    console.log('Step 1: Navigating to https://edc-real.vercel.app');
    await page.goto('https://edc-real.vercel.app', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await takeScreenshot(page, '01-homepage');
    console.log('✓ Homepage loaded\n');

    // Step 2: Login
    console.log('Step 2: Logging in with username: jamesgui333');
    
    // Wait for login form
    await page.waitForSelector('input[name="username"], input[type="text"]', { timeout: 10000 });
    
    // Fill username
    const usernameInput = await page.locator('input[name="username"], input[type="text"]').first();
    await usernameInput.fill('jamesgui333');
    
    // Fill password
    const passwordInput = await page.locator('input[name="password"], input[type="password"]').first();
    await passwordInput.fill('Leagueoflegends111@');
    
    await takeScreenshot(page, '02-login-form-filled');
    
    // Click login button
    const loginButton = await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first();
    await loginButton.click();
    
    console.log('✓ Login submitted, waiting for dashboard...');
    await page.waitForTimeout(3000);
    await takeScreenshot(page, '03-after-login');
    console.log('✓ Login complete\n');

    // Step 3: Select study
    console.log('Step 3: Looking for study selector/switcher');
    
    // Look for study selector - try various selectors
    const studySelector = await page.locator(
      'select, [role="combobox"], button:has-text("Study"), button:has-text("Select"), .study-selector'
    ).first();
    
    if (await studySelector.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('✓ Study selector found');
      await studySelector.click();
      await page.waitForTimeout(1000);
      
      // Try to find and click on "Automated E2E Test Study"
      const studyOption = await page.locator('text="Automated E2E Test Study"').first();
      if (await studyOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await studyOption.click();
        console.log('✓ Selected "Automated E2E Test Study"');
      } else {
        console.log('⚠ Could not find "Automated E2E Test Study" option');
        console.log('Available options:');
        const options = await page.locator('option, [role="option"]').allTextContents();
        options.forEach(opt => console.log(`  - ${opt}`));
      }
    } else {
      console.log('⚠ Study selector not found - might already be on correct study');
    }
    
    await page.waitForTimeout(2000);
    await takeScreenshot(page, '04-study-selected');
    console.log('');

    // Step 4: Find and click patient SUBJ-001
    console.log('Step 4: Looking for patient list and SUBJ-001');
    
    await page.waitForTimeout(2000);
    
    // Try to find patient SUBJ-001
    const patient = await page.locator('text="SUBJ-001"').first();
    if (await patient.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('✓ Patient SUBJ-001 found');
      await patient.click();
      console.log('✓ Clicked on patient SUBJ-001');
    } else {
      console.log('✗ Cannot see patient SUBJ-001 in the list');
      console.log('Visible text on page:');
      const bodyText = await page.locator('body').textContent();
      console.log(bodyText?.substring(0, 500));
    }
    
    await page.waitForTimeout(2000);
    await takeScreenshot(page, '05-patient-clicked');
    console.log('');

    // Step 5: Look for Screening Visit
    console.log('Step 5: Looking for Screening Visit');
    
    const screeningVisit = await page.locator('text=/Screening.*Visit/i').first();
    if (await screeningVisit.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('✓ Screening Visit found');
      
      // Try to see the forms
      const formsVisible = await page.locator('.form, [data-testid*="form"], .ecrf').count();
      console.log(`✓ Can see ${formsVisible} form element(s) in/near the visit`);
    } else {
      console.log('✗ Cannot see Screening Visit');
    }
    
    await takeScreenshot(page, '06-screening-visit');
    console.log('');

    // Step 6: Click "View Details" or "Enter Data" on Screening Visit
    console.log('Step 6: Looking for "View Details" or "Enter Data" button');
    
    const actionButton = await page.locator(
      'button:has-text("View Details"), button:has-text("Enter Data"), button:has-text("View"), button:has-text("Details")'
    ).first();
    
    if (await actionButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      const buttonText = await actionButton.textContent();
      console.log(`✓ Found button: "${buttonText}"`);
      await actionButton.click();
      console.log('✓ Clicked the button');
      await page.waitForTimeout(2000);
    } else {
      console.log('⚠ Could not find "View Details" or "Enter Data" button');
      console.log('Trying to click directly on Screening Visit...');
      const screeningVisit2 = await page.locator('text=/Screening.*Visit/i').first();
      if (await screeningVisit2.isVisible().catch(() => false)) {
        await screeningVisit2.click();
      }
    }
    
    await takeScreenshot(page, '07-event-details-modal');
    console.log('');

    // Step 7: Click "Fill" on one of the forms
    console.log('Step 7: Looking for "Fill" button on a form');
    
    const fillButton = await page.locator('button:has-text("Fill")').first();
    if (await fillButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('✓ Found "Fill" button');
      await fillButton.click();
      console.log('✓ Clicked "Fill" button');
      await page.waitForTimeout(3000);
      
      // Check if form opened
      const formFields = await page.locator('input[type="text"], input[type="number"], textarea, select').count();
      console.log(`✓ Form opened with ${formFields} field(s)`);
      
      if (formFields > 0) {
        console.log('✓ SUCCESS: Form fields are visible!');
      } else {
        console.log('✗ WARNING: No form fields detected');
      }
    } else {
      console.log('✗ Cannot find "Fill" button');
    }
    
    await takeScreenshot(page, '08-form-opened');
    console.log('');

    // Final summary
    console.log('\n=== SUMMARY ===');
    console.log('✓ Can you see the patient? - Checking...');
    const patientVisible = await page.locator('text="SUBJ-001"').isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`  ${patientVisible ? '✓ YES' : '✗ NO'}`);
    
    console.log('✓ Can you see the visits?');
    const visitsVisible = await page.locator('text=/visit/i').count();
    console.log(`  ${visitsVisible > 0 ? `✓ YES (${visitsVisible} found)` : '✗ NO'}`);
    
    console.log('✓ Can you see the forms inside a visit?');
    const formsInVisit = await page.locator('.form, [data-testid*="form"]').count();
    console.log(`  ${formsInVisit > 0 ? `✓ YES (${formsInVisit} found)` : '✗ NO'}`);
    
    console.log('✓ Does clicking "Fill" open a form with fields?');
    const fieldsCount = await page.locator('input[type="text"], input[type="number"], textarea, select').count();
    console.log(`  ${fieldsCount > 0 ? `✓ YES (${fieldsCount} fields)` : '✗ NO'}`);
    
    console.log('✓ Any error messages or blank screens?');
    const errorMessages = await page.locator('text=/error/i, .error, [role="alert"]').count();
    console.log(`  ${errorMessages > 0 ? `⚠ YES (${errorMessages} found)` : '✓ NO errors detected'}`);

    console.log('\n✓ Test completed! Check the screenshots folder for visual evidence.');
    
    // Keep browser open for 10 seconds to review
    await page.waitForTimeout(10000);

  } catch (error) {
    console.error('\n✗ ERROR:', error);
    await takeScreenshot(page, 'error-state');
  } finally {
    await browser.close();
  }
}

testFormFlow().catch(console.error);
