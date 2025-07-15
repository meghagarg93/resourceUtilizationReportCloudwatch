Run the code using "node index.js --env=qa"


Code takes below 4 arguments
--env (qa, rel, alpha, hfx)
--service (ClassAppWeb)
--date (either 2025-07-15 OR "2025-07-15 14:30")
--start ("2025-07-15 14:30")
--end ("2025-07-15 14:30")

If date argument is not passed the  code will run from default 10:00 AM to 10:00 AM  (node index.js --env=qa)

If date is passed without time, the again time will be 10:00 to 10:00 AM (node index.js --env=qa --date="2025-07-15")

If date is passed along with time , that time will overwrite default 10:00 AM time. Make sure to give time in 24 hrs format (node index.js --env=qa --date="2025-07-15 13:00")

If start and end argument is passed, then start will be today and end will be yesterday. Make sure to give time in 24 hrs format (node index.js --env=rel --end="2025-07-15 13:40" --start="2025-07-15 12:30")

If service is passed as argument, then code will run only for that particular service (node index.js --env=rel --service=ClassAppWeb)


===============

Add .env file as below

API_KEY={new relic API Key}
ACCOUNT_ID={new Relic Account ID}
