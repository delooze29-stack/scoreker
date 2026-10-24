# ScoreKer

Weekend football predictions for two players, played as a frame of snooker.

- **Website:** GitHub Pages (this repo) — add it to your phone's home screen to use it like an app.
- **Fixtures, odds and results:** [The Odds API](https://the-odds-api.com) free plan, fetched by a scheduled GitHub Action (`.github/workflows/scoreker.yml`) and saved in `data/`.
- **Predictions and logins:** Firebase (Firestore + Google sign-in), free Spark plan.

## How a frame works

1. Each weekend the Action picks 13 games: **1 red** (earliest kick-off), **6 free-colour games** (Championship) and **6 clearance games** (Premier League), plus a **tie-break** game (the last Premier League game of the weekend). Colours come from the odds: most one-sided = yellow (2), most even = black (7).
2. Both players predict the red, the 6 clearance games and the tie-break before the red kicks off. Hidden from each other until then.
3. Free colour: pick ONE of the 6 Championship games and predict just that one, any time before they kick off (hidden from the other player until then). It only counts if you pot the red (right result = 1). Pot it = its value; miss it = break over.
4. Miss the red = no free colour, but you still play the clearance.
5. Clearance: yellow → black in order; a miss ends the break.
6. Exact score = double points. Max break: 1×2 + 7×2 + 27×2 = 70.
7. Higher score wins the frame. Level → most exact scores → closer prediction on the tie-break game → drawn.
8. Season: 1 point per frame won; highest break of the season gets +5 frames.

## Setup checklist

1. **Odds key:** GitHub repo → Settings → Secrets and variables → Actions → secret `ODDS_API_KEY`.
2. **Firebase:** create a project, Firestore database, enable Authentication → Google and Email/Password, add a Web app.
   - Paste the web config into `js/config.js` and set both players' emails there.
   - Paste `firestore.rules` into Firestore → Rules (with the same two emails) and Publish.
   - Authentication → Settings → Authorised domains → add `delooze29-stack.github.io`.
3. **GitHub Pages:** Settings → Pages → Deploy from a branch → `main` / root.
4. **First run:** Actions → *ScoreKer weekly data* → Run workflow → mode `select`.

## Schedule (UTC)

- Friday 07:07 — pick the weekend's games
- Friday 22:35, Saturday & Sunday 16:20 / 19:20 / 22:20, Monday 08:10 — fetch results

Roughly 10–40 API credits a week, well under the free 500 a month. You can also run the workflow by hand from the Actions tab.

## Cue Club

`play/` is a full 3D snooker and pool game, linked from the **Cue Club** tab in the bottom menu: snooker, UK 8-ball (pub two-shot rules), US 8-ball and 9-ball, against the computer (Easy, Medium, Hard, Pro) or a friend on the same phone. The physics (sliding and rolling, spin, throw, side off cushions, pocket jaws) is in `play/js/physics.js`, the rules in `play/js/rules.js` and the computer player in `play/js/ai.js`. It runs entirely in the browser: no login, no Firebase, nothing saved. The Practice table is linked from its menu.

## Practice table

`practice/` is a standalone 3D snooker and pool practice table, linked from the **Practice** tab in the bottom menu. It teaches cue ball contact (ghost ball, view down the cue, overlap check), spin and cushion escapes on snooker, US pool (8ft) and UK 8-ball (7ft) tables. It runs entirely in the browser: no login, no Firebase, nothing saved.

## Doughty's Links (golf game) leaderboard

The golf game lives in its own repo, Doughty-Links (https://delooze29-stack.github.io/Doughty-Links/), but its leaderboard saves rounds to this Firebase project in the `kfl_rounds` collection. Keep the `kfl_rounds` block in `firestore.rules`.

## Reminders and phone notifications

`.github/workflows/reminders.yml` runs hourly Friday–Sunday (plus Monday 09:15 UTC) and nudges a player who hasn't entered: the evening before the red, in the 3 hours before the red, and (free colour only) in the 2 hours before the free-colour games. When every game has finished it sends a "full time" alert.

- **Phone notifications** (web push): each player taps "Turn on notifications" in the app (iPhone: Add to Home Screen first). Phones are stored in the Firestore `push` collection. Needs the `VAPID_PRIVATE_KEY` secret; the public key is in `js/config.js`.
- **Email**: sent from Gmail using the `GMAIL_APP_PASSWORD` secret (a Google app password).

Either works on its own. Run the workflow by hand with "test" ticked to send Mathew a test.
