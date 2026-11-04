# Bill Snap

Installable mobile PWA: capture/select a bill → vision-model bill check and field extraction → review uncertain fields → save locally in IndexedDB.

## Deploy to Vercel

1. Push this folder to a GitHub repository.
2. Import the repository in Vercel. Keep the default settings.
3. In Vercel Project Settings → Environment Variables, add `ANTHROPIC_API_KEY`. Optionally add `BILL_MODEL` (defaults to `claude-sonnet-5-5`).
4. Redeploy, then open the deployment URL in Android Chrome and choose Add to Home screen / Install app.

The Anthropic key is used only by the serverless API route; never put it in frontend files or commit it. Scanning requires internet. Saved bills remain in the browser's local IndexedDB on that device.

## Local development

Install Node.js 18 or newer, then run `npm install -g vercel` and `vercel dev`. Set `ANTHROPIC_API_KEY` in your local environment first. On Windows PowerShell: `$env:ANTHROPIC_API_KEY="your-key"`.

## ML evaluation

1. Add exactly 15 real bill images and 5 non-bill images to `eval/images/` (JPG, PNG or WebP).
2. Fill `eval/truth.csv` with the true labels **before** running the evaluation. Columns: `file,is_bill,merchant,date,total,category`. For non-bills, leave the bill fields empty. Categories must match one of Food, Groceries, Utilities, Transport, Shopping, Health, Entertainment, Other.
3. Set `ANTHROPIC_API_KEY`, then run `npm run eval`. PowerShell: `$env:ANTHROPIC_API_KEY="your-key"; npm run eval`.
4. Inspect `eval/results.csv` and report the failures honestly. API errors count as incorrect, not silently excluded.

The evaluation measures bill/not-bill, merchant, date, total and category correctness. Merchant comparison ignores punctuation/case and accepts one name being contained in the other; date and amount require exact date and a 0.01 amount tolerance.

## Trade-offs

- Bill detection and extraction use one hosted vision-model call; scanning therefore needs a connection and API usage can incur cost.
- The API endpoint is publicly callable unless protected by deployment-level access controls or rate limiting.
- Bills are stored locally in the browser on the device; they are not synced across devices.
- The PWA icon is SVG. Add platform-specific PNG icons if a more consistent install icon is needed.
