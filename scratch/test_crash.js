const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));

  await page.goto('http://localhost:5173');
  
  await page.waitForSelector('input[type="text"]', { timeout: 5000 });
  await page.type('input[type="text"]', 'admin');
  await page.type('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  
  await new Promise(r => setTimeout(r, 2000));
  
  const elements = await page.$$('button, a, div');
  for (let el of elements) {
    const text = await page.evaluate(e => e.textContent, el);
    if (text && text.includes('Chiến dịch')) {
      await el.click();
      console.log('Clicked Chiến dịch');
      break;
    }
  }

  await new Promise(r => setTimeout(r, 3000));
  
  await page.screenshot({ path: 'crash_test_screenshot.png' });
  console.log('Saved screenshot to crash_test_screenshot.png');

  // Also check if there's any text in the body
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('Body text sample:', bodyText.substring(0, 200));

  await browser.close();
})();
