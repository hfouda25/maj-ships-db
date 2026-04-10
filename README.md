# MAJ Ships Database – Netlify Ready

This folder contains your React + Vite app exported from Google AI Studio, prepared for deployment on Netlify.

## 1. Run locally (optional)

**Prerequisite:** Node.js (version 18 or later).

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create or edit the `.env.local` file and set your Gemini API key **using this exact name**:

   ```bash
   VITE_GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE
   ```

3. Start the dev server:

   ```bash
   npm run dev
   ```

   Then open the link shown in the terminal (usually `http://localhost:5173`).

## 2. Deploy to Netlify (recommended)

### Option A – Netlify builds the app for you (easiest after first setup)

1. **Upload this ZIP to a Git provider** (GitHub, GitLab, or Bitbucket).  
   - Create a new repository.
   - Upload **all files** from this zip (keep the same structure).

2. **In Netlify**:
   - Click **“Add new site” → “Import from Git”**.
   - Connect to your Git provider and choose this repository.

3. **Build settings** in Netlify:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`

   If Netlify detects Vite automatically, it may fill this for you. Make sure they match the above.

4. **Environment variable in Netlify**:
   - Go to **Site settings → Build & deploy → Environment → Environment variables**.
   - Add a new variable:
     - **Name:** `VITE_GEMINI_API_KEY`
     - **Value:** your Gemini API key (from Google AI Studio / Google Cloud).
   - Save.

5. Trigger a **new deploy** (Netlify usually does this automatically after you save).

After the build finishes, Netlify will give you a URL like:

`https://your-site-name.netlify.app`

This is the link you can share.

### Option B – Build on your computer and upload the `dist` folder

If you don’t want to use Git:

1. On your computer (in this project folder), run:

   ```bash
   npm install
   VITE_GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE npm run build
   ```

   or set `VITE_GEMINI_API_KEY` in `.env.local` first, then:

   ```bash
   npm run build
   ```

2. After it finishes, a new folder **`dist`** will appear.

3. **Zip only the contents of `dist`**.

4. Go to **Netlify → “Add new site” → “Deploy manually” (or “Upload a folder”)** and upload the **`dist` zip or folder**.

Netlify will host it as a static site and give you a public URL.

---

No code changes are needed from your side; just make sure the environment variable is correct and Netlify build settings are set as listed above.
