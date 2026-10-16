# My Website

A simple static website hosted on GitHub Pages.

## Files
- `index.html` – the main page (GitHub Pages loads this first)
- `style.css` – styling
- `script.js` – small bit of interactivity

## How to host on GitHub Pages

### Option A – Using the GitHub website (no Git needed)
1. Sign in at https://github.com and click **New repository**.
2. Name it, e.g. `my-website`, set it to **Public**, and click **Create repository**.
3. Click **uploading an existing file**, drag in `index.html`, `style.css`, `script.js`, `README.md`, then click **Commit changes**.
4. Go to **Settings → Pages**.
5. Under **Build and deployment → Source**, choose **Deploy from a branch**.
6. Select branch **main** and folder **/ (root)**, then click **Save**.
7. Wait 1–2 minutes and refresh. Your site will be live at:
   `https://<your-username>.github.io/my-website/`

### Option B – Using Git from the command line
```bash
cd my-website
git init
git add .
git commit -m "First website"
git branch -M main
git remote add origin https://github.com/<your-username>/my-website.git
git push -u origin main
```
Then do steps 4–7 above.

### Tip
If you name the repository `<your-username>.github.io`, the site is served at
`https://<your-username>.github.io/` (no folder name in the URL).

### Updating the site
Edit the files, commit/upload again, and GitHub Pages redeploys automatically within a minute or two.
