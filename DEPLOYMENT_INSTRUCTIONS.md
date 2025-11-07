# Deployment Instructions - ArcVest Tools Site Update

## What Was Changed

### Summary
The arcvest-tools.vercel.app site has been updated to include full ArcVest branding (header and footer) so it can function as a standalone site. This eliminates the need for iframe embedding and resolves all scrolling issues.

### Files Modified

1. **New Components Created:**
   - `components/Header.tsx` - Full ArcVest header with logo and navigation menu
   - `components/Footer.tsx` - Full ArcVest footer with contact info and social links

2. **Updated Files:**
   - `app/layout.tsx` - Now includes Header and Footer components
   - `app/calculator/page.tsx` - Navigation link changed from arcvest.com/investment-tools to /
   - `app/retirement-simulator/page.tsx` - Navigation link changed from arcvest.com/investment-tools to /
   - `app/fee-calculator/page.tsx` - Navigation link changed from arcvest.com/investment-tools to /
   - `app/treat-yourself/page.tsx` - Navigation link changed from arcvest.com/investment-tools to /
   - `app/chat/page.tsx` - Navigation link changed from arcvest.com/investment-tools to /

### What's New

**Header Features:**
- ArcVest logo (links to arcvest.com)
- Full navigation menu: Home, About, FAQs, Contact, Disclosure & Fees, Investment Tools
- Mobile-responsive hamburger menu
- Matching arcvest.com styling with transparent overlay effect

**Footer Features:**
- "Welcome to a better investing experience" tagline
- ArcVest logo
- Instagram social link
- Contact information (address, email, phone)
- Copyright notice
- 4-column responsive grid layout

**Navigation Updates:**
- All "Back to Tools" links now point to `/` (homepage) instead of arcvest.com/investment-tools
- This keeps users within the tools site instead of redirecting back to the iframe version

## Deployment Steps

### Step 1: Deploy to Vercel

The changes are in the `fargason-capital-site` directory, which is connected to `arcvest-tools.vercel.app`.

**Option A: Automatic Deployment (if GitHub connected)**
1. Commit and push the changes to your GitHub repository
2. Vercel will automatically detect the changes and deploy them
3. Wait for the deployment to complete (usually 1-2 minutes)

**Option B: Manual Deployment via Vercel CLI**
```bash
cd fargason-capital-site
npm install -g vercel  # If not already installed
vercel --prod
```

### Step 2: Test the Deployed Site

1. Visit https://arcvest-tools.vercel.app
2. Verify the header appears with logo and navigation menu
3. Verify the footer appears with contact info
4. Test each tool page:
   - https://arcvest-tools.vercel.app/calculator
   - https://arcvest-tools.vercel.app/retirement-simulator
   - https://arcvest-tools.vercel.app/fee-calculator
   - https://arcvest-tools.vercel.app/treat-yourself
   - https://arcvest-tools.vercel.app/chat
5. Click "Back to Tools" on each page - should go to homepage (/)
6. Test mobile responsiveness (resize browser or use mobile device)
7. Test hamburger menu on mobile

### Step 3: Add Redirect on Hostinger

Once you've verified the new site works properly, add the redirect on Hostinger:

**File to Edit:** `arcvest-site/hostinger-redirects/.htaccess`

**Add this line:**
```apache
Redirect 301 /investment-tools https://arcvest-tools.vercel.app
```

**The updated file should look like:**
```apache
# ArcVest Landing Pages - Redirect to Vercel
# Upload this file to your public_html folder on Hostinger

# Investment Tools Redirect
Redirect 301 /investment-tools https://arcvest-tools.vercel.app

# Redirect landing pages to Vercel (clean permanent URLs)
Redirect 301 /women-investors https://arcvest-site.vercel.app/women-investors
Redirect 301 /high-net-worth https://arcvest-site.vercel.app/high-net-worth
Redirect 301 /risk-averse https://arcvest-site.vercel.app/risk-averse
Redirect 301 /aggressive-growth https://arcvest-site.vercel.app/aggressive-growth
Redirect 301 /entrepreneurs https://arcvest-site.vercel.app/entrepreneurs
Redirect 301 /parents-family-planners https://arcvest-site.vercel.app/parents-family-planners
Redirect 301 /skeptics-data-driven https://arcvest-site.vercel.app/skeptics-data-driven
Redirect 301 /young-professionals https://arcvest-site.vercel.app/young-professionals
Redirect 301 /retirees https://arcvest-site.vercel.app/retirees
Redirect 301 /tech-savvy-millennials https://arcvest-site.vercel.app/tech-savvy-millennials
```

**Upload to Hostinger:**
1. Log in to your Hostinger control panel
2. Go to File Manager
3. Navigate to `public_html` directory
4. Upload or edit the `.htaccess` file
5. Save changes

### Step 4: Verify the Redirect

1. Clear your browser cache
2. Visit https://arcvest.com/investment-tools
3. You should be automatically redirected to https://arcvest-tools.vercel.app
4. The URL should change in your browser address bar
5. Test on both desktop and mobile

## Benefits of This Solution

✅ **No More Scrolling Issues** - Eliminates double scrolling (page + iframe)
✅ **Better Mobile Experience** - Native responsive design without iframe constraints
✅ **Faster Loading** - No iframe overhead
✅ **Better SEO** - Search engines can properly index the tools
✅ **Consistent Branding** - Full ArcVest header and footer on every page
✅ **Simpler Navigation** - Users can use browser back button properly
✅ **Better Performance** - Single page load instead of nested frames

## Troubleshooting

### If the header/footer don't appear:
1. Check that the deployment completed successfully in Vercel dashboard
2. Clear your browser cache (Ctrl+Shift+Delete or Cmd+Shift+Delete)
3. Try in an incognito/private browser window
4. Check browser console for any JavaScript errors

### If the redirect doesn't work:
1. Verify the `.htaccess` file was uploaded to the correct directory
2. Check that mod_rewrite is enabled on your Hostinger server
3. Clear your browser cache
4. Try accessing from a different device/network
5. Wait 5-10 minutes for DNS propagation

### If mobile menu doesn't work:
1. Check browser console for JavaScript errors
2. Ensure JavaScript is enabled in the browser
3. Try refreshing the page

## Rollback Plan

If you need to revert the changes:

1. In Vercel dashboard, go to the project deployments
2. Find the previous deployment (before these changes)
3. Click "..." menu and select "Promote to Production"
4. Remove the redirect line from `.htaccess` on Hostinger

## Next Steps (Optional)

Consider these future enhancements:
- Add a disclaimer notice on the tools homepage
- Add analytics tracking to the tools site
- Create a dedicated "About These Tools" page
- Add breadcrumb navigation on tool pages
- Add share buttons for social media

## Contact

If you need help with deployment, contact:
- Email: wealth@arcvest.com
- Phone: 713-581-4550

