# Test Credentials

These accounts are created automatically by seed logic in `db.js`.
Use only for local development/testing.

| Role | Email | Password |
|------|-------|----------|
| director | director@technotrade.ru | 123456 |
| manager | manager@technotrade.ru | 123456 |
| admin | admin@technotrade.ru | 123456 |
| picker | picker@technotrade.ru | 123456 |
| accountant | accountant@technotrade.ru | 123456 |
| logistic | logistic@technotrade.ru | 123456 |

Notes:
- If users already existed in the database, only missing seed users are added.
- Passwords are stored hashed in DB; plain values above are for test login only.
