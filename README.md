# שיעורים פרטיים

הרצה: `npm install`, העתקת `.env.example` ל-`.env` ומילוי הערכים, ואז `node --env-file=.env server.js`.

1. **Google**: ב-Google Cloud Console צרו OAuth Client מסוג Web, והוסיפו את כתובת האתר ל-Authorized JavaScript origins. הדביקו את ה-Client ID ב-`GOOGLE_CLIENT_ID`.
2. **מורים**: כתובות המייל ב-`TEACHER_EMAILS`. תלמיד יכול להתחבר רק עם המייל שהמורה הזין עבורו.
3. **וואצפ**: בלי הגדרות נוספות נפתחת שיחת וואצפ עם ההודעה מוכנה, והמורה לוחץ "שלח". לשליחה אוטומטית מלאה הגדירו `WHATSAPP_TOKEN` ו-`WHATSAPP_PHONE_NUMBER_ID` (WhatsApp Cloud API).
