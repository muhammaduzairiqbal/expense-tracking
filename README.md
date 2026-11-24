# Expense Tracker

A real expense tracker built with Expo and React Native.

Add an expense, see it in the list, check the total, and see your monthly
spending in a bar chart. Everything is saved on the phone, so your expenses
are still there when you close and reopen the app.

## What it does

- **Add an expense** — title, amount, category (Food, Transport, Shopping,
  Bills, Entertainment, Other) and date (YYYY-MM-DD, defaults to today)
- **Expense list** — newest first, with title, category, date and amount
- **Delete an expense** — with a confirmation prompt
- **Totals** — total spent, this month's total, and number of expenses
- **Monthly spending chart** — bar chart of your real expenses, Jan to Dec,
  built from the saved data
- **Saved on the phone** — expenses are stored with AsyncStorage as numbers,
  so amounts add up correctly and survive app restarts

On the very first run the app is seeded with six sample expenses from the
original project (Jan–Jun: Rs. 500, 700, 900, 600, 800, 1000). You can
delete any of them.

## Where it came from

This started as `expense_tracking_9` in the `MAD_Assignment_2` repository —
an Expo Snack project whose `App.js` only showed a Reports screen with
hard-coded monthly mock data. That chart is now driven by real, saved
expenses, and the missing tracker features (add, list, total, save) have
been added. The unused Snack boilerplate component (`AssetExample.js`)
was removed and the app was renamed from `expense_tracking_9` to
**Expense Tracker**.

## Tech

- Expo SDK 52, React 18.3.1, React Native 0.76.7
- `@react-native-async-storage/async-storage` — on-device storage
- `react-native-chart-kit` + `react-native-svg` — monthly bar chart

## Run it

```bash
npm install
npx expo start
```

Then scan the QR code with Expo Go, or press `a` for Android / `i` for iOS.

## Project structure

```
App.js          # Expense Tracker: add, list, totals, chart, storage
index.js        # Expo root component registration
app.json        # Expo app config (name: Expense Tracker)
package.json    # Dependencies and scripts
assets/         # App icon, splash screen and favicon
```

## Data

Expenses are stored locally on the device under the AsyncStorage key
`@expense_tracker:expenses`. There is no backend, account or cloud sync.
