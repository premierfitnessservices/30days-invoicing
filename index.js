const puppeteer = require('puppeteer');
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

app.post('/send-emails', async (req, res) => {
  const invoiceUrls = req.body.invoice;

  if (!Array.isArray(invoiceUrls) || invoiceUrls.length === 0) {
    return res.status(400).json({ error: 'No invoice URLs provided' });
  }

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const results = [];

  try {
    const page = await browser.newPage();

    // Login to ServiceFusion
    await page.goto('https://auth.servicefusion.com/auth/login', { waitUntil: 'networkidle2' });
    await page.type('#company', 'pfs21485');
    await page.type('#uid', 'Lui-G');
    await page.type('#pwd', 'Premierlog5335!');
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    for (let url of invoiceUrls) {
      try {
        console.log(`📨 Opening invoice: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2' });

        // Click "Send" button to open modal
        await page.waitForSelector('a.btn[onclick^="showEmailInvoice"]', { timeout: 10000 });
        await page.click('a.btn[onclick^="showEmailInvoice"]');

        // Wait for modal to appear
        await page.waitForSelector('#email-modal', { visible: true, timeout: 10000 });

        // Try to select Other Contact
        let contactEmails = [];

        try {
          await page.waitForSelector('button.dropdown-toggle[data-toggle="dropdown"]', { visible: true, timeout: 5000 });
          await page.click('button.dropdown-toggle[data-toggle="dropdown"]');
          await new Promise(resolve => setTimeout(resolve, 1000));

          const contactClicked = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('ul.customer-other-contacts li:not(.disabled) a'))
              .filter(a => a.getAttribute('onclick')?.includes('setemails'));

            if (items.length > 0) {
              items[0].click();
              return true;
            }
            return false;
          });

          if (contactClicked) {
            console.log('✅ Successfully selected an Other Contact.');
          } else {
            console.log('ℹ️ No selectable Other Contact found or visible.');
          }
        } catch {
          console.log('ℹ️ Other Contact dropdown not available.');
        }

        // Collect emails from selected contacts in the To field
        contactEmails = await page.evaluate(() => {
          const emailNodes = Array.from(document.querySelectorAll('ul.select2-choices li.select2-search-choice div'));
          return emailNodes.map(div => div.textContent.trim());
        });

        const formattedContacts = {};
        contactEmails.forEach((email, i) => {
          formattedContacts[`contact_${i + 1}`] = email;
          console.log(`📬 Contact ${i + 1}: ${email}`);
        });

        // Select template
        await page.waitForSelector('#s2id_customForms .select2-choice', { visible: true });
        await page.click('#s2id_customForms .select2-choice');

        await page.waitForSelector('.select2-drop-active .select2-search input', { visible: true });
        await page.type('.select2-drop-active .select2-search input', '30 Days Past Due');
        await page.keyboard.press('Enter');

        console.log('✅ Template "30 Days Past Due" selected.');

        // Wait for review (optional)
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('📩 Sending email now...');

        // Click Send
        await page.waitForSelector('#btn-load-then-complete', { visible: true });
        await page.click('#btn-load-then-complete');

        results.push({
          invoice: url,
          emails: formattedContacts
        });

        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (e) {
        console.error(`❌ Failed for ${url}:`, e.message);
      }
    }

    await browser.close();
    return res.json({
      success: true,
      sent: invoiceUrls.length,
      contacts: results
    });

  } catch (err) {
    await browser.close();
    return res.status(500).json({
      error: 'Automation failed',
      details: err.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running at http://localhost:${PORT}/send-emails`);
});
