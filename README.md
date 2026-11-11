# The Quiz Master Show — Online Edition (prototype)

Host dashboard: `/?view=host` · Projector: `/?view=screen` · Participant: `/?view=player`.

The Node.js server requires a **HOST_KEY** environment variable with a strong 20+ character secret. Set it in Render's service environment (never commit the secret to GitHub). Start command: `npm start`. No build packages are required.

Participants register using a name, phone number and game PIN. The host assigns Team A or B, chooses the next question timer (5–300 seconds), and controls revealing results and advancing. Each correct answer adds exactly 1 team point. The result highlights the winning team or a draw and names the fastest correct responder from either team. The quiz ends with congratulations and names of the winning team; a tie congratulates both teams. Mobile numbers are not displayed publicly.

**Testing limitations:** This is an early prototype, not a production event platform. The free service can sleep and restart, which resets all registrations and scores because they are held in RAM. Phone numbers are not SMS-verified; the game PIN is not an account authentication factor. There are no anti-bot controls, durable database, or account management. Keep testing with consenting participants only; use test phone numbers, not real contact details. The application's appearance is an interpretation of the PowerPoint rather than a precise reproduction.

36 questions were imported. Questions 19–36 have answer keys but placeholder prompts, which must be completed before they are used. The host's question set is loaded from `questions.json`; editing questions currently requires a code update. Multiple-choice format is supported by setting `type` to `choice` and supplying a `choices` array.

The server's `/health` endpoint returns `{"ok":true}` when running.
