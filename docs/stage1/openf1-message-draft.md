# Draft message to OpenF1 (NOT SENT; for you to review and send)

**Where:** the "Direct contact" form at https://openf1.org/contact. Its fields, as far as I could read them: Email, Organization (optional), a "What brings you here?" dropdown (I could not read the options; pick the closest to "integration support" or "custom project"), and Message. Paste the text below into **Message**. Replace the bracketed parts. I have not contacted OpenF1 and I did not use any account or credential.

**Why these four questions:** the sources I could read disagree (price: EUR 9.90/month on the homepage vs usage-based per the access form as you report it, and the form now loads as "no longer active"), and you reported that live `/location`, `/car_data` and `/intervals` are unavailable. Nothing in the project's plan blocks on the reply (decision 3 in `DECISIONS.md`).

---

**Subject:** Question about real-time access for a non-commercial portfolio project

Hello,

I'm [YOUR NAME], and I run f1predictor.app, a **non-commercial portfolio project**: a free website that shows model forecasts for upcoming races and, I'd like to add, a simple live timing tower during sessions. There are **no ads, no payments and no paid tier**, and none are planned. I currently use only your free historical endpoints (sessions, laps, stints, session results, drivers) from 2023 onwards, cached and requested at well under one request every two seconds. Thank you for building and sharing OpenF1.

Before I commit to anything, could you tell me:

1. **Pricing.** Your homepage lists a Sponsor tier at EUR 9.90 per month, but I understood that access is now usage-based. What is the current pricing model for real-time access, and what would it cost for my expected use: about 25 race weekends a year, roughly 5 sessions each, one backend worker polling or subscribing during sessions, and a few hundred page viewers at most?
2. **Which live feeds work today.** Which topics currently stream live over REST, MQTT and WebSocket? I would use `position`, `laps`, `pit`, `stints`, `race_control` and `weather`. I understand that live `intervals`, `location` and `car_data` may currently be unavailable: is that right, and is there an expected date for them to return? (I can see that all three hold full data for completed sessions, for example the Mexico City race.)
3. **A delayed feed.** Do you offer, or would you consider, a delayed real-time feed of 30 to 60 seconds, and would the terms or price differ from real-time access?
4. **Licence fit.** Is a free, public, non-commercial website that displays derived live standings from your feed within the CC BY-NC-SA 4.0 licence and your terms? What attribution would you like on the site, and are there limits I should respect (request rates, number of connections, caching, redistribution of the data)?

I would also appreciate knowing about any planned changes that could affect an integration this season. I'm happy to credit OpenF1 prominently on every page that uses your data.

Thank you for your time,
[YOUR NAME]
[EMAIL]
f1predictor.app

---

**Notes for you (not part of the message):**
- Say so if you would rather not name the site's URL yet.
- Keep the answers: they settle the CONFLICTING and REPORTED rows in `docs/stage1/04-data-sources-and-live.md` section 4.0, and unblock README recommendation 9.
- If the reply says live positions or laps are also unavailable, the live tier shrinks to a post-session replay (the FINAL tier), which needs no paid access.
