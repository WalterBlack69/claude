# שיעורים פרטיים

הרצה: `npm install`, העתקת `.env.example` ל-`.env` ומילוי הערכים, ואז `node --env-file=.env server.js`.

1. **Google**: ב-Google Cloud Console צרו OAuth Client מסוג Web, והוסיפו את כתובת האתר ל-Authorized JavaScript origins. הדביקו את ה-Client ID ב-`GOOGLE_CLIENT_ID`.
2. **מורים**: כתובות המייל ב-`TEACHER_EMAILS`. תלמיד יכול להתחבר רק עם המייל שהמורה הזין עבורו.
3. **וואצפ**: בלי הגדרות נוספות נפתחת שיחת וואצפ עם ההודעה מוכנה, והמורה לוחץ "שלח". לשליחה אוטומטית מלאה הגדירו `WHATSAPP_TOKEN` ו-`WHATSAPP_PHONE_NUMBER_ID` (WhatsApp Cloud API).

## העלאה ל-Render
1. ב-render.com: New → Blueprint, מחברים את הריפו. Render קורא את `render.yaml`.
2. בשדה `TEACHER_EMAILS` מזינים את מייל ה-Google של המורה.
3. אחרי הפריסה מוסיפים את כתובת האתר (`https://...onrender.com`) ל-Authorized JavaScript origins ב-Google Cloud.
