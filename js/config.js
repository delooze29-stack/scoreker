// ScoreKer settings.

// 1. Firebase web config — from Firebase console → Project settings → Your apps → Web app.
//    (This is not a password; it's safe to have on a public website.)
export const firebaseConfig = {
  apiKey: 'AIzaSyBMHK2OGUOUtAsRyw69NKut76RcmnrkeyU',
  authDomain: 'scoreker-5531f.firebaseapp.com',
  projectId: 'scoreker-5531f',
  storageBucket: 'scoreker-5531f.firebasestorage.app',
  messagingSenderId: '1082241632476',
  appId: '1:1082241632476:web:b55f7512e43ac2f4300c19',
};

// 2. The two players. Emails must match your Google accounts (and firestore.rules).
//    Player 1 is shown on the left of the scoreboard.
export const PLAYERS = [
  { email: 'PLAYER1_EMAIL@gmail.com', name: 'Player 1' },
  { email: 'PLAYER2_EMAIL@gmail.com', name: 'Player 2' },
];

// 3. Bonus frames for the season's highest break.
export const HIGH_BREAK_BONUS = 5;
