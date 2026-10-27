# Setup: NMAMIT Bookings with Google Sheets

1. Create a new Google Sheet named "NMAMIT Bookings DB".
2. Open Extensions > Apps Script. Delete the sample code and paste all of Code.gs. Save.
3. At the top of the code, set your two admin passwords in ADMINS. Save.
4. In the function dropdown choose `setup`, press Run, and allow the permissions (Advanced > Go to project > Allow). The tabs Venues and Bookings appear in the sheet.
5. Replace the passwords in ADMINS with '' and save (they are already stored as hashes).
6. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Deploy, then copy the Web app URL (ends in /exec).
7. Open index.html in a text editor, replace PASTE_YOUR_WEB_APP_URL_HERE with that URL, and save.
8. Double-click index.html to try it, or put it online with Netlify Drop (app.netlify.com/drop) or GitHub Pages.

After any change to Code.gs: Deploy > Manage deployments > Edit > Version: New version > Deploy.
Demo mode: set SHOW_CODE_ON_SCREEN = true to show the sign-in code on the login page instead of emailing it.
Keep the Google Sheet itself private (do not share it publicly). The sign-in codes go out by email from your Google account (about 100 a day on a free account).
