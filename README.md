# ScoreKer

Weekend football predictions for two players, played as a frame of snooker.

- **Website:** GitHub Pages (this repo) — add it to your phone's home screen to use it like an app.
- **Fixtures, odds and results:** [The Odds API](https://the-odds-api.com) free plan, fetched by a scheduled GitHub Action (`.github/workflows/scoreker.yml`) and saved in `data/`.
- **Predictions and logins:** Firebase (Firestore + Google sign-in), free Spark plan.

## How a frame works

1. Each weekend the Action picks 13 games: **1 red** (earliest kick-off), **6 free-colour games** (Championship) and **6 clearance games** (Premier League), plus a **tie-break** game (the last Premier League game of the weekend). Colours come from the odds: most one-sided = yellow (2), most even = black (7).
2. Both players predict every score before the red kicks off. Predictions are hidden from each other until then.
3. Red right = 1 point + choose a free colour (one of the Championship games) before they kick off. Pot it = its value; miss it = break over.
4. Miss the red = no free colour, but you still play the clearance.
5. Clearance: yellow → black in order; a miss ends the break.
6. Exact score = double points. Max break: 1×2 + 7×2 + 27×2 = 70.
7. Higher score wins the frame. Level → most exact scores (all 13 games) → closer prediction on the tie-break game → drawn.
8. Season: 1 point per frame won; highest break of the season gets +5 frames.

## Setup checklist

1. **Odds key:** GitHub repo → Settings → Secrets and variables → Actions → secret `ODDS_API_KEY`.
2. **Firebase:** create a project, Firestore database, enable Authentication → Google, add a Web app.
   - Paste the web config into `js/config.js` and set both players' emails there.
   - Paste `firestore.rules` into Firestore → Rules (with the same two emails) and Publish.
   - Authentication → Settings → Authorised domains → add `delooze29-stack.github.io`.
3. **GitHub Pages:** Settings → Pages → Deploy from a branch → `main` / root.
4. **First run:** Actions → *ScoreKer weekly data* → Run workflow → mode `select`.

## Schedule (UTC)

- Friday 07:07 — pick the weekend's games
- Friday 22:35, Saturday & Sunday 16:20 / 19:20 / 22:20, Monday 08:10 — fetch results

Roughly 10–40 API credits a week, well under the free 500 a month. You can also run the workflow by hand from the Actions tab.
