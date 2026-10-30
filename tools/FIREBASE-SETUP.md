# Setting up Google sign-in (Firebase)

Typing Zen keeps the progress of users who sign in with Google in Firebase (Firestore). Until
`FIREBASE` in app.js holds the project's web config, Google sign-in isn't offered and everything works
as before. This is done once, in a browser, by the project owner (about 10 minutes, free plan).

1. Open https://console.firebase.google.com and sign in with the Google account that will own the project.
   Click **Create a project**, name it `typing-zen`, turn **Google Analytics off**, and create it.
2. **Build > Authentication > Get started > Sign-in method > Google**: switch it on, choose the
   support email, **Save**.
3. **Authentication > Settings > Authorized domains > Add domain**: `trix69.github.io`.
   (`localhost` is there already, for testing on this Mac.)
4. **Build > Firestore Database > Create database**: location `europe-west2 (London)`, start in
   **production mode**, create.
5. **Firestore Database > Rules**: replace everything with the contents of `tools/firestore.rules`,
   then **Publish**.
6. **Project settings** (the gear next to Project Overview) **> General > Your apps > Web (`</>`)**:
   nickname `Typing Zen`, leave Firebase Hosting off, **Register app**. Copy the `firebaseConfig`
   object it shows (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`)
   and paste it to Claude Code. These values are public by design (every visitor's browser gets them);
   the rules in step 5 are what keep each user's progress private.
7. Optional, so Google's sign-in window says "Typing Zen" instead of the project ID: in
   https://console.cloud.google.com pick the `typing-zen` project, then **APIs & Services > OAuth
   consent screen** (or **Google Auth Platform > Branding**), set the app name to `Typing Zen` and save.
   If it shows **Publishing status: Testing**, click **Publish app**: only the basic name and email
   scopes are used, so no Google review is needed.

Children's Google accounts (under 13, managed with Family Link) may need a parent to allow signing in to
a third-party site; a typed name always works without Google.
