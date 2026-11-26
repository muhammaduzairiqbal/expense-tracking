import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Keyboard,
  Share,
  Platform,
  Dimensions,
  Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BarChart } from 'react-native-chart-kit';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';

// Show bill reminders even while the app is open (phone app only). On web
// the notifications scheduler is a no-op stub, so the in-app "Bills due"
// banner stays the fallback there.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

const STORAGE_KEY = '@expense_tracker:expenses';
const CUSTOM_CATEGORIES_KEY = '@expense_tracker:custom_categories';
const BUDGET_KEY = '@expense_tracker:monthly_budget';
const CATEGORY_BUDGETS_KEY = '@expense_tracker:category_budgets';
const SAVINGS_GOALS_KEY = '@expense_tracker:savings_goals';
const BILLS_KEY = '@expense_tracker:bills';
const PIN_KEY = '@expense_tracker:pin';
const DARK_KEY = '@expense_tracker:dark_mode';
const LAST_BACKUP_KEY = '@expense_tracker:last_backup';

const CATEGORIES = ['Food', 'Transport', 'Shopping', 'Bills', 'Entertainment', 'Other'];

const INCOME_CATEGORIES = ['Salary', 'Freelance', 'Business', 'Gift', 'Other'];

const CATEGORY_COLORS = {
  Food: '#e76f51',
  Transport: '#2a9d8f',
  Shopping: '#e9c46a',
  Bills: '#264653',
  Entertainment: '#9b5de5',
  Other: '#6c757d',
  Salary: '#2a9d8f',
  Freelance: '#43aa8b',
  Business: '#277da1',
  Gift: '#e9c46a',
};

// Extra colours handed out to user-added categories, in order.
const CUSTOM_COLORS = ['#f3722c', '#43aa8b', '#577590', '#f9c74f', '#90be6d', '#f9844a', '#277da1', '#b5179e'];

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The screens in the side (⋮) menu. Each section lives on its own
// screen: money in/out on Home, the list on Entries, analysis on Charts,
// budgets/goals/categories on Budget & Categories, bills on Bills, and
// app-level things (backup, PIN, appearance) on Settings.
const SCREENS = [
  { key: 'home', label: 'Home' },
  { key: 'entries', label: 'Entries' },
  { key: 'charts', label: 'Charts' },
  { key: 'budget', label: 'Budget & Categories' },
  { key: 'bills', label: 'Bills' },
  { key: 'settings', label: 'Settings' },
];

// Sample expenses carried over from the original expense_tracking_9
// Reports screen (Jan-Jun monthly totals: 500, 700, 900, 600, 800, 1000).
// They are only used on the very first run, so the chart has something to
// show. The user can delete any of them.
const SEED_EXPENSES = [
  { id: 'seed-1', title: 'Groceries', amount: 500, category: 'Food', date: '2026-01-15', type: 'expense', repeat: false },
  { id: 'seed-2', title: 'Bus and fuel', amount: 700, category: 'Transport', date: '2026-02-10', type: 'expense', repeat: false },
  { id: 'seed-3', title: 'Clothes shopping', amount: 900, category: 'Shopping', date: '2026-03-05', type: 'expense', repeat: false },
  { id: 'seed-4', title: 'Electricity bill', amount: 600, category: 'Bills', date: '2026-04-12', type: 'expense', repeat: false },
  { id: 'seed-5', title: 'Dinner out', amount: 800, category: 'Food', date: '2026-05-20', type: 'expense', repeat: false },
  { id: 'seed-6', title: 'Movie night', amount: 1000, category: 'Entertainment', date: '2026-06-08', type: 'expense', repeat: false },
];

const CHART_WIDTH = Math.max(300, Dimensions.get('window').width - 32);

// The 12-month charts need more room than a narrow phone screen gives them:
// react-native-chart-kit centres the last x-label ("Dec") almost at the
// right edge, so at phone widths it is clipped. These charts therefore use
// a wider canvas inside a horizontal ScrollView (see the Monthly and
// Category-trend views), so every month label — including Dec — fits.
const MONTH_CHART_WIDTH = Math.max(CHART_WIDTH, 520);

function pad(n) {
  return String(n).padStart(2, '0');
}

// Local date (not UTC) so "today" is correct in the user's timezone.
function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function parseLocalDate(iso) {
  const parts = String(iso).split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(iso, days) {
  const d = parseLocalDate(iso);
  d.setDate(d.getDate() + days);
  return formatISO(d);
}

function addMonths(iso, months) {
  const d = parseLocalDate(iso);
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  // Clamp to the last day of the target month (e.g. Jan 31 -> Feb 28).
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return formatISO(target);
}

function monthKeyOf(iso) {
  return String(iso).slice(0, 7); // 'YYYY-MM'
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function formatAmount(amount) {
  return `Rs. ${Number(amount).toLocaleString('en-PK')}`;
}

function colorForCategory(name, customCategories) {
  if (CATEGORY_COLORS[name]) return CATEGORY_COLORS[name];
  const idx = customCategories.indexOf(name);
  if (idx >= 0) return CUSTOM_COLORS[idx % CUSTOM_COLORS.length];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 997;
  return CUSTOM_COLORS[hash % CUSTOM_COLORS.length];
}

function csvEscape(value) {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

// Entries saved before the income/repeat fields existed load as plain expenses.
function normalizeEntries(raw) {
  if (!Array.isArray(raw)) return null;
  return raw.map((item) => ({
    ...item,
    amount: Number(item.amount) || 0,
    type: item.type === 'income' ? 'income' : 'expense',
    repeat: !!item.repeat,
    note: typeof item.note === 'string' ? item.note : '',
    photoUrl: typeof item.photoUrl === 'string' ? item.photoUrl : '',
    photoUri: typeof item.photoUri === 'string' ? item.photoUri : '',
  }));
}

// For every "repeat every month" entry, create the next month's copy once
// that month arrives. Copies are marked with generatedFrom + their date, so
// they are never created twice, and copies themselves do not repeat (the
// original keeps generating one copy per month).
function generateRecurring(list) {
  const today = todayISO();
  const next = [...list];
  let changed = false;
  list
    .filter((item) => item.repeat && !item.generatedFrom)
    .forEach((source) => {
      for (let n = 1; n <= 24; n++) {
        const targetDate = addMonths(source.date, n);
        if (targetDate > today) break;
        const alreadyThere = next.some(
          (item) => item.generatedFrom === source.id && item.date === targetDate
        );
        if (!alreadyThere) {
          next.push({
            ...source,
            id: `${source.id}-r${n}-${targetDate}`,
            date: targetDate,
            repeat: false,
            generatedFrom: source.id,
          });
          changed = true;
        }
      }
    });
  return { list: next, changed };
}

export default function App() {
  const [entries, setEntries] = useState([]);
  const billAlertShown = useRef(false);
  const [loading, setLoading] = useState(true);

  // Form state
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Food');
  const [date, setDate] = useState(todayISO());
  const [entryType, setEntryType] = useState('expense'); // 'expense' | 'income'
  const [repeatMonthly, setRepeatMonthly] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [note, setNote] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoUri, setPhotoUri] = useState('');

  // Custom categories
  const [customCategories, setCustomCategories] = useState([]);
  const [newCategory, setNewCategory] = useState('');

  // Search + filters
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterMonth, setFilterMonth] = useState(null); // null = all months, else 'YYYY-MM'
  const [filterFrom, setFilterFrom] = useState(''); // '' = no lower date limit, else 'YYYY-MM-DD'
  const [filterTo, setFilterTo] = useState(''); // '' = no upper date limit, else 'YYYY-MM-DD'

  // In-app date picker (core components only, works on web and Android)
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() }; // month is 0-based
  });

  // Screens + side menu (no navigation library — simple state switching)
  const [screen, setScreen] = useState('home'); // 'home' | 'entries' | 'charts' | 'budget' | 'bills' | 'settings'
  const [menuOpen, setMenuOpen] = useState(false);
  const goToScreen = (next) => {
    setScreen(next);
    setMenuOpen(false);
  };

  // Charts + budget
  const [chartView, setChartView] = useState('monthly'); // 'monthly' | 'weekly' | 'category' | 'trend'
  const [trendCategory, setTrendCategory] = useState('Food');
  const [budgetText, setBudgetText] = useState('');
  const [budget, setBudget] = useState(null); // number | null

  // 1. Per-category budgets: { categoryName: monthlyBudgetRs }
  const [categoryBudgets, setCategoryBudgets] = useState({});
  const [catBudgetCategory, setCatBudgetCategory] = useState('Food');
  const [catBudgetText, setCatBudgetText] = useState('');

  // 2. Savings goals: [{ id, name, target, saved }]
  const [goals, setGoals] = useState([]);
  const [goalName, setGoalName] = useState('');
  const [goalTargetText, setGoalTargetText] = useState('');
  const [selectedGoalId, setSelectedGoalId] = useState(null);
  const [goalAddText, setGoalAddText] = useState('');

  // 3. Bill reminders: [{ id, name, amount, dueDay, paidMonths: ['YYYY-MM'] }]
  const [bills, setBills] = useState([]);
  const [billName, setBillName] = useState('');
  const [billAmountText, setBillAmountText] = useState('');
  const [billDueDayText, setBillDueDayText] = useState('');

  // Real bill reminder notifications (phone app only; on web this stays null
  // and the in-app "Bills due" banner is the fallback).
  const [notifStatus, setNotifStatus] = useState(null); // 'granted' | 'denied' | 'undetermined' | 'unsupported'

  // Backup & restore (paste-a-backup text field)
  const [restoreText, setRestoreText] = useState('');
  const [lastBackup, setLastBackup] = useState(null); // 'YYYY-MM-DD' of the last export, or null

  // PIN lock
  const [pin, setPin] = useState('');
  const [locked, setLocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinSetInput, setPinSetInput] = useState('');
  const [pinSetConfirm, setPinSetConfirm] = useState('');
  const [pinCurrent, setPinCurrent] = useState('');
  const [pinNew, setPinNew] = useState('');
  const [pinNewConfirm, setPinNewConfirm] = useState('');

  // Dark mode
  const [darkMode, setDarkMode] = useState(false);
  const styles = useMemo(() => makeStyles(darkMode), [darkMode]);

  const allCategories = useMemo(
    () => [...CATEGORIES, ...customCategories],
    [customCategories]
  );

  // Income uses its own categories, so switching to Income visibly changes the form.
  const formCategories = entryType === 'income' ? INCOME_CATEGORIES : allCategories;

  // Load saved data, or seed the original sample data on first run.
  useEffect(() => {
    const loadAll = async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        let list;
        if (saved !== null) {
          list = normalizeEntries(JSON.parse(saved)) || [];
        } else {
          list = SEED_EXPENSES;
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_EXPENSES));
        }
        const generated = generateRecurring(list);
        if (generated.changed) {
          list = generated.list;
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
        }
        setEntries(list);

        const savedCats = await AsyncStorage.getItem(CUSTOM_CATEGORIES_KEY);
        if (savedCats !== null) {
          const parsed = JSON.parse(savedCats);
          if (Array.isArray(parsed)) setCustomCategories(parsed.filter((c) => typeof c === 'string'));
        }
        const savedBudget = await AsyncStorage.getItem(BUDGET_KEY);
        if (savedBudget !== null) {
          const value = Number(savedBudget);
          if (!Number.isNaN(value) && value > 0) {
            setBudget(value);
            setBudgetText(String(value));
          }
        }
        const savedCatBudgets = await AsyncStorage.getItem(CATEGORY_BUDGETS_KEY);
        if (savedCatBudgets !== null) {
          const parsed = JSON.parse(savedCatBudgets);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            setCategoryBudgets(parsed);
          }
        }
        const savedGoals = await AsyncStorage.getItem(SAVINGS_GOALS_KEY);
        if (savedGoals !== null) {
          const parsed = JSON.parse(savedGoals);
          if (Array.isArray(parsed)) {
            setGoals(parsed.map((g) => ({
              ...g,
              target: Number(g.target) || 0,
              saved: Number(g.saved) || 0,
            })));
          }
        }
        const savedBills = await AsyncStorage.getItem(BILLS_KEY);
        if (savedBills !== null) {
          const parsed = JSON.parse(savedBills);
          if (Array.isArray(parsed)) {
            const normalizedBills = parsed.map((b) => ({
              ...b,
              amount: Number(b.amount) || 0,
              dueDay: Number(b.dueDay) || 1,
              paidMonths: Array.isArray(b.paidMonths) ? b.paidMonths : [],
              remind: b.remind !== false,
            }));
            setBills(normalizedBills);
            // Reconcile real notifications on every open (no permission
            // prompt here — only adding a bill or turning reminders on asks).
            syncBillNotifications(normalizedBills);
          }
        }
        const savedPin = await AsyncStorage.getItem(PIN_KEY);
        if (savedPin) {
          setPin(savedPin);
          setLocked(true);
        }
        const savedDark = await AsyncStorage.getItem(DARK_KEY);
        if (savedDark === '1') setDarkMode(true);
        const savedLastBackup = await AsyncStorage.getItem(LAST_BACKUP_KEY);
        if (typeof savedLastBackup === 'string' && savedLastBackup) {
          setLastBackup(savedLastBackup);
        }
      } catch (err) {
        Alert.alert('Could not load expenses', err.message);
      } finally {
        setLoading(false);
      }
    };
    loadAll();
  }, []);

  // Save every change to the phone, as numbers (amount stays a number).
  const saveEntries = async (nextEntries) => {
    setEntries(nextEntries);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextEntries));
    } catch (err) {
      Alert.alert('Could not save expenses', err.message);
    }
  };

  const saveCustomCategories = async (next) => {
    setCustomCategories(next);
    try {
      await AsyncStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(next));
    } catch (err) {
      Alert.alert('Could not save categories', err.message);
    }
  };

  const saveCategoryBudgets = async (next) => {
    setCategoryBudgets(next);
    try {
      await AsyncStorage.setItem(CATEGORY_BUDGETS_KEY, JSON.stringify(next));
    } catch (err) {
      Alert.alert('Could not save category budgets', err.message);
    }
  };

  const saveGoals = async (next) => {
    setGoals(next);
    try {
      await AsyncStorage.setItem(SAVINGS_GOALS_KEY, JSON.stringify(next));
    } catch (err) {
      Alert.alert('Could not save goals', err.message);
    }
  };

  const saveBills = async (next) => {
    setBills(next);
    try {
      await AsyncStorage.setItem(BILLS_KEY, JSON.stringify(next));
    } catch (err) {
      Alert.alert('Could not save bills', err.message);
    }
  };

  // --- Real bill reminder notifications (phone app only) ---
  // expo-notifications has no scheduler on web (its web module is a no-op
  // stub), so every call here is guarded by Platform and the in-app
  // "Bills due" banner stays the fallback on the website.
  const billNeedsReminder = (bill, monthKey) => {
    if (!bill || bill.remind === false) return false;
    const paid = Array.isArray(bill.paidMonths) && bill.paidMonths.includes(monthKey);
    return !paid;
  };

  // Next 9:00 on the bill's due day (this month if it hasn't passed yet,
  // otherwise next month). Used for due days 29-31, which a repeating
  // monthly trigger can't cover in shorter months.
  const nextBillDueDate = (bill) => {
    const now = new Date();
    for (let offset = 0; offset < 2; offset++) {
      const year = now.getFullYear();
      const month = now.getMonth() + offset;
      const lastDay = new Date(year, month + 1, 0).getDate();
      const day = Math.min(Number(bill.dueDay) || 1, lastDay);
      const due = new Date(year, month, day, 9, 0, 0);
      if (due.getTime() > now.getTime()) return due;
    }
    return null;
  };

  const requestBillNotificationPermission = async () => {
    if (Platform.OS === 'web') {
      setNotifStatus('unsupported');
      return false;
    }
    try {
      const current = await Notifications.getPermissionsAsync();
      if (current.status === 'granted') {
        setNotifStatus('granted');
        return true;
      }
      const asked = await Notifications.requestPermissionsAsync();
      const granted = asked.status === 'granted';
      setNotifStatus(granted ? 'granted' : 'denied');
      return granted;
    } catch (err) {
      setNotifStatus('denied');
      return false;
    }
  };

  // Schedule one reminder for a bill: 9:00 on its due day, every month.
  // Due days 1-28 use a repeating calendar trigger (day/hour/minute with
  // repeats) so it fires even if the app is never opened; due days 29-31
  // use a one-off date trigger for the next occurrence instead, and the
  // sync below re-schedules it when the app opens.
  const scheduleBillNotification = async (bill) => {
    if (Platform.OS === 'web') return null;
    try {
      const dueDay = Math.min(Math.max(Number(bill.dueDay) || 1, 1), 31);
      const trigger = dueDay <= 28
        ? { day: dueDay, hour: 9, minute: 0, repeats: true }
        : nextBillDueDate(bill);
      if (!trigger) return null;
      const identifier = await Notifications.scheduleNotificationAsync({
        content: {
          title: `Bill due: ${bill.name}`,
          body: `${bill.name} — ${formatAmount(bill.amount)} is due today.`,
          data: { billId: String(bill.id), type: 'bill-reminder' },
          sound: 'default',
        },
        trigger,
      });
      return identifier;
    } catch (err) {
      return null;
    }
  };

  // Reconcile the phone's scheduled notifications with the current bills:
  // schedule the ones that need one, cancel the ones that don't (paid this
  // month, reminders off, or bill deleted). Matching is by the billId
  // stored in the notification data, so re-running this never duplicates.
  const syncBillNotifications = async (billsList) => {
    if (Platform.OS === 'web') return;
    try {
      const perms = await Notifications.getPermissionsAsync();
      if (perms.status !== 'granted') {
        setNotifStatus(perms.status);
        return;
      }
      setNotifStatus('granted');
      const monthKey = monthKeyOf(todayISO());
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const scheduledByBill = {};
      scheduled.forEach((req) => {
        const billId = req && req.content && req.content.data && req.content.data.billId;
        if (billId) scheduledByBill[String(billId)] = req.identifier;
      });
      for (const bill of billsList) {
        const want = billNeedsReminder(bill, monthKey);
        const existing = scheduledByBill[String(bill.id)];
        if (want && !existing) {
          await scheduleBillNotification(bill);
        } else if (!want && existing) {
          await Notifications.cancelScheduledNotificationAsync(existing);
        }
      }
      const liveIds = new Set(billsList.map((b) => String(b.id)));
      for (const billId of Object.keys(scheduledByBill)) {
        if (!liveIds.has(billId)) {
          await Notifications.cancelScheduledNotificationAsync(scheduledByBill[billId]);
        }
      }
    } catch (err) {
      // Notifications are a best-effort extra — never break the app for them.
    }
  };

  const saveDarkMode = async (value) => {
    setDarkMode(value);
    try {
      await AsyncStorage.setItem(DARK_KEY, value ? '1' : '0');
    } catch (err) {
      Alert.alert('Could not save theme', err.message);
    }
  };

  const resetForm = () => {
    setTitle('');
    setAmount('');
    setCategory('Food');
    setDate(todayISO());
    setEntryType('expense');
    setRepeatMonthly(false);
    setEditingId(null);
    setNote('');
    setPhotoUrl('');
    setPhotoUri('');
    setShowDatePicker(false);
  };

  // Open the calendar on the month of the date already in the form.
  const openDatePicker = () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      const d = parseLocalDate(date.trim());
      if (!Number.isNaN(d.getTime())) {
        setPickerMonth({ year: d.getFullYear(), month: d.getMonth() });
      }
    }
    setShowDatePicker(true);
  };

  const shiftPickerMonth = (delta) => {
    setPickerMonth((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const pickDate = (day) => {
    setDate(formatISO(new Date(pickerMonth.year, pickerMonth.month, day)));
    setShowDatePicker(false);
  };

  // 3. Receipt photo: real camera / gallery picker (expo-image-picker).
  // The photo is stored as a small base64 data URI so it survives reloads
  // on web and on the phone (AsyncStorage only holds the string, not bytes).
  const pickReceiptPhoto = async (fromCamera) => {
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm && perm.status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow photo access to attach a receipt photo.');
        return;
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.5, base64: true })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.5, base64: true });
      if (result.canceled) return;
      const asset = result.assets && result.assets[0];
      if (!asset) return;
      if (asset.base64) setPhotoUri(`data:image/jpeg;base64,${asset.base64}`);
      else if (asset.uri) setPhotoUri(asset.uri);
    } catch (err) {
      Alert.alert('Photo failed', err.message);
    }
  };

  const submitEntry = () => {
    const parsedAmount = Number(amount);
    if (!title.trim()) {
      Alert.alert('Title missing', 'Please enter what you spent on.');
      return;
    }
    if (!amount.trim() || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Invalid amount', 'Please enter an amount greater than 0.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      Alert.alert('Invalid date', 'Please use the YYYY-MM-DD format, for example 2026-11-25.');
      return;
    }
    const entry = {
      id: editingId || `${Date.now()}`,
      title: title.trim(),
      amount: parsedAmount,
      category,
      date: date.trim(),
      type: entryType,
      repeat: entryType === 'expense' ? repeatMonthly : false,
      note: note.trim(),
      photoUrl: photoUrl.trim(),
      photoUri: photoUri.trim(),
    };
    if (editingId) {
      const old = entries.find((item) => item.id === editingId);
      saveEntries(
        entries.map((item) =>
          item.id === editingId ? { ...entry, generatedFrom: old ? old.generatedFrom : undefined } : item
        )
      );
    } else {
      saveEntries([entry, ...entries]);
    }
    resetForm();
    Keyboard.dismiss();
  };

  const startEdit = (item) => {
    setScreen('home');
    setMenuOpen(false);
    setTitle(item.title);
    setAmount(String(item.amount));
    setCategory(item.category);
    setDate(item.date);
    setEntryType(item.type === 'income' ? 'income' : 'expense');
    setRepeatMonthly(!!item.repeat);
    setEditingId(item.id);
    setNote(item.note || '');
    setPhotoUrl(item.photoUrl || '');
    setPhotoUri(item.photoUri || '');
    setShowDatePicker(false);
  };

  const deleteEntry = (id, entryTitle) => {
    const doDelete = () => saveEntries(entries.filter((item) => item.id !== id));
    if (Platform.OS === 'web') {
      // Alert.alert's dialog does not appear in the web browser, so the
      // old Delete button did nothing there. Use the browser's own confirm.
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        if (window.confirm(`Delete "${entryTitle}"?`)) doDelete();
      } else {
        doDelete();
      }
      return;
    }
    Alert.alert('Delete entry?', `Delete "${entryTitle}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: doDelete,
      },
    ]);
  };

  const addCustomCategory = () => {
    const name = newCategory.trim();
    if (!name) return;
    if (
      allCategories.some((c) => c.toLowerCase() === name.toLowerCase())
    ) {
      Alert.alert('Category exists', `"${name}" is already a category.`);
      return;
    }
    const next = [...customCategories, name];
    saveCustomCategories(next);
    setCategory(name);
    setNewCategory('');
  };

  const removeCustomCategory = (name) => {
    saveCustomCategories(customCategories.filter((c) => c !== name));
    if (category === name) setCategory('Food');
    if (filterCategory === name) setFilterCategory('All');
  };

  const saveBudget = () => {
    const value = Number(budgetText);
    if (!budgetText.trim() || Number.isNaN(value) || value <= 0) {
      Alert.alert('Invalid budget', 'Please enter a monthly budget greater than 0.');
      return;
    }
    setBudget(value);
    AsyncStorage.setItem(BUDGET_KEY, String(value)).catch((err) =>
      Alert.alert('Could not save budget', err.message)
    );
    Keyboard.dismiss();
  };

  const clearBudget = () => {
    setBudget(null);
    setBudgetText('');
    AsyncStorage.removeItem(BUDGET_KEY).catch(() => {});
  };

  // Confirm helper: Alert.alert's dialog does not show on web, so use the
  // browser's own confirm() there (same pattern as Delete entry).
  const confirmAction = (title, message, onConfirm) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (window.confirm(`${title}\n${message}`)) onConfirm();
      return;
    }
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'OK', onPress: onConfirm },
    ]);
  };

  // 1. Per-category budgets
  const saveCategoryBudget = () => {
    const value = Number(catBudgetText);
    if (!catBudgetText.trim() || Number.isNaN(value) || value <= 0) {
      Alert.alert('Invalid budget', 'Please enter a budget greater than 0.');
      return;
    }
    saveCategoryBudgets({ ...categoryBudgets, [catBudgetCategory]: value });
    Keyboard.dismiss();
  };

  const clearCategoryBudget = (name) => {
    const next = { ...categoryBudgets };
    delete next[name];
    saveCategoryBudgets(next);
    if (catBudgetCategory === name) setCatBudgetText('');
  };

  // 2. Savings goals
  const addGoal = () => {
    const target = Number(goalTargetText);
    if (!goalName.trim()) {
      Alert.alert('Name missing', 'Please name the goal, e.g. New phone.');
      return;
    }
    if (!goalTargetText.trim() || Number.isNaN(target) || target <= 0) {
      Alert.alert('Invalid target', 'Please enter a target amount greater than 0.');
      return;
    }
    const goal = { id: `${Date.now()}`, name: goalName.trim(), target, saved: 0 };
    saveGoals([...goals, goal]);
    setGoalName('');
    setGoalTargetText('');
    setSelectedGoalId(goal.id);
    Keyboard.dismiss();
  };

  const addToGoal = () => {
    const value = Number(goalAddText);
    if (!selectedGoalId) {
      Alert.alert('No goal selected', 'Tap a goal below first, then add money to it.');
      return;
    }
    if (!goalAddText.trim() || Number.isNaN(value) || value <= 0) {
      Alert.alert('Invalid amount', 'Please enter an amount greater than 0.');
      return;
    }
    saveGoals(goals.map((g) => (g.id === selectedGoalId ? { ...g, saved: Number(g.saved) + value } : g)));
    setGoalAddText('');
    Keyboard.dismiss();
  };

  const deleteGoal = (id, name) => {
    confirmAction('Delete goal?', `Delete the "${name}" savings goal?`, () =>
      saveGoals(goals.filter((g) => g.id !== id))
    );
  };

  // 3. Bill reminders
  const addBill = () => {
    const amount = Number(billAmountText);
    const dueDay = Number(billDueDayText);
    if (!billName.trim()) {
      Alert.alert('Name missing', 'Please name the bill, e.g. Electricity.');
      return;
    }
    if (!billAmountText.trim() || Number.isNaN(amount) || amount <= 0) {
      Alert.alert('Invalid amount', 'Please enter an amount greater than 0.');
      return;
    }
    if (!billDueDayText.trim() || Number.isNaN(dueDay) || dueDay < 1 || dueDay > 31) {
      Alert.alert('Invalid due day', 'Please enter a day of the month from 1 to 31.');
      return;
    }
    const newBill = { id: `${Date.now()}`, name: billName.trim(), amount, dueDay, paidMonths: [], remind: true };
    const nextBills = [...bills, newBill];
    saveBills(nextBills);
    // Ask for notification permission on first use, then schedule the reminder.
    requestBillNotificationPermission().then(() => syncBillNotifications(nextBills));
    setBillName('');
    setBillAmountText('');
    setBillDueDayText('');
    Keyboard.dismiss();
  };

  const toggleBillPaid = (id) => {
    const monthKey = monthKeyOf(todayISO());
    const nextBills = bills.map((b) => {
      if (b.id !== id) return b;
      const paid = Array.isArray(b.paidMonths) ? b.paidMonths : [];
      return {
        ...b,
        paidMonths: paid.includes(monthKey)
          ? paid.filter((m) => m !== monthKey)
          : [...paid, monthKey],
      };
    });
    saveBills(nextBills);
    syncBillNotifications(nextBills);
  };

  // Per-bill reminder on/off (reminders default to on).
  const toggleBillRemind = (id) => {
    const nextBills = bills.map((b) => (b.id === id ? { ...b, remind: b.remind === false } : b));
    saveBills(nextBills);
    const found = nextBills.find((b) => b.id === id);
    const turnedOn = found ? found.remind !== false : false;
    if (turnedOn) {
      requestBillNotificationPermission().then(() => syncBillNotifications(nextBills));
    } else {
      syncBillNotifications(nextBills);
    }
  };

  const deleteBill = (id, name) => {
    confirmAction('Delete bill?', `Delete the "${name}" bill reminder?`, () => {
      const nextBills = bills.filter((b) => b.id !== id);
      saveBills(nextBills);
      syncBillNotifications(nextBills);
    });
  };

  // 4a. PIN lock — a simple local lock (the PIN is stored as plain text in
  // AsyncStorage; it keeps casual snoopers out, it is not encryption).
  const setNewPin = () => {
    if (!/^\d{4}$/.test(pinSetInput.trim())) {
      Alert.alert('Invalid PIN', 'Enter exactly 4 digits.');
      return;
    }
    if (pinSetInput.trim() !== pinSetConfirm.trim()) {
      Alert.alert('PINs do not match', 'Type the same 4-digit PIN twice.');
      return;
    }
    const value = pinSetInput.trim();
    AsyncStorage.setItem(PIN_KEY, value).then(() => {
      setPin(value);
      setPinSetInput('');
      setPinSetConfirm('');
      Alert.alert('PIN set', 'The app will ask for this PIN when it opens.');
    }).catch((err) => Alert.alert('Could not save PIN', err.message));
  };

  const changePin = () => {
    if (pinCurrent.trim() !== pin) {
      Alert.alert('Wrong PIN', 'The current PIN is not correct.');
      return;
    }
    if (!/^\d{4}$/.test(pinNew.trim())) {
      Alert.alert('Invalid PIN', 'Enter exactly 4 digits for the new PIN.');
      return;
    }
    if (pinNew.trim() !== pinNewConfirm.trim()) {
      Alert.alert('PINs do not match', 'Type the same new 4-digit PIN twice.');
      return;
    }
    const value = pinNew.trim();
    AsyncStorage.setItem(PIN_KEY, value).then(() => {
      setPin(value);
      setPinCurrent('');
      setPinNew('');
      setPinNewConfirm('');
      Alert.alert('PIN changed', 'Your new PIN is set.');
    }).catch((err) => Alert.alert('Could not save PIN', err.message));
  };

  const removePin = () => {
    confirmAction('Remove PIN lock?', 'The app will no longer ask for a PIN when it opens.', () => {
      AsyncStorage.removeItem(PIN_KEY).then(() => {
        setPin('');
        setLocked(false);
      }).catch((err) => Alert.alert('Could not remove PIN', err.message));
    });
  };

  const unlockApp = () => {
    if (pinInput.trim() === pin) {
      setLocked(false);
      setPinInput('');
    } else {
      Alert.alert('Wrong PIN', 'That PIN is not correct. Try again.');
    }
  };

  const shiftFilterMonth = (delta) => {
    const base = filterMonth || monthKeyOf(todayISO());
    setFilterMonth(addMonths(`${base}-01`, delta).slice(0, 7));
  };

  // CSV text for the currently filtered entries (shared by Export and Share).
  const buildCsv = () => {
    const header = 'Date,Title,Category,Type,Amount (Rs),Repeat monthly,Note,Photo URL';
    const lines = filteredEntries.map((item) =>
      [
        item.date,
        csvEscape(item.title),
        csvEscape(item.category),
        item.type,
        item.amount,
        item.repeat ? 'Yes' : 'No',
        csvEscape(item.note || ''),
        csvEscape(item.photoUrl || ''),
      ].join(',')
    );
    return [header, ...lines].join('\n');
  };

  const exportCsv = async () => {
    if (filteredEntries.length === 0) {
      Alert.alert('Nothing to export', 'There are no entries matching the current filters.');
      return;
    }
    const csv = buildCsv();
    const fileName = `expenses-${todayISO()}.csv`;
    try {
      if (Platform.OS === 'web') {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        await Share.share({ message: csv, title: fileName });
      }
    } catch (err) {
      Alert.alert('Export failed', err.message);
    }
  };

  const shareEntries = async () => {
    if (filteredEntries.length === 0) {
      Alert.alert('Nothing to share', 'There are no entries matching the current filters.');
      return;
    }
    const csv = buildCsv();
    const spent = filteredEntries
      .filter((item) => item.type !== 'income')
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const income = filteredEntries
      .filter((item) => item.type === 'income')
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const summary =
      `Expense Tracker: ${filteredEntries.length} entries — ` +
      `Spent ${formatAmount(spent)}, Income ${formatAmount(income)}, ` +
      `Balance ${formatAmount(income - spent)}.`;
    try {
      if (Platform.OS === 'web') {
        // Alert.alert does not show visibly in the web browser, so use the
        // browser's own alert() for confirmation here.
        const webAlert = (title, message) => {
          if (typeof window !== 'undefined' && typeof window.alert === 'function') {
            window.alert(`${title}\n${message}`);
          } else {
            Alert.alert(title, message);
          }
        };
        if (typeof navigator !== 'undefined' && navigator.share) {
          await navigator.share({ title: 'Expense Tracker', text: `${summary}\n\n${csv}` });
          webAlert('Entries shared', 'Your entries were shared.');
        } else if (
          typeof navigator !== 'undefined' &&
          navigator.clipboard &&
          navigator.clipboard.writeText
        ) {
          await navigator.clipboard.writeText(csv);
          webAlert(
            'CSV copied to clipboard',
            'Sharing is not available in this browser, so the CSV was copied to your clipboard. Paste it anywhere to share it.'
          );
        } else {
          webAlert(
            'Sharing not available',
            'This browser does not support sharing or copying. Use Export as CSV to download the file instead.'
          );
        }
      } else {
        const result = await Share.share({ message: `${summary}\n\n${csv}`, title: `expenses-${todayISO()}.csv` });
        // Only confirm when the user actually shared; a dismissed sheet is not an error.
        if (result && result.action === 'sharedAction') {
          Alert.alert('Entries shared', 'Your entries were shared.');
        }
      }
    } catch (err) {
      // The user cancelled the share sheet — not an error, do nothing.
      if (err && (err.name === 'AbortError' || err.message === 'Share canceled')) return;
      if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(`Sharing failed\n${err.message}`);
      } else {
        Alert.alert('Sharing failed', err.message);
      }
    }
  };

  // 1. Backup & restore: one JSON file with ALL stored data.
  const collectBackupData = async () => {
    const keys = [STORAGE_KEY, CUSTOM_CATEGORIES_KEY, BUDGET_KEY, CATEGORY_BUDGETS_KEY, SAVINGS_GOALS_KEY, BILLS_KEY, PIN_KEY, DARK_KEY];
    const pairs = await AsyncStorage.multiGet(keys);
    const data = {};
    pairs.forEach(([key, value]) => {
      if (value === null) return;
      try { data[key] = JSON.parse(value); } catch (e) { data[key] = value; }
    });
    return { app: 'Expense Tracker', version: 1, exportedAt: new Date().toISOString(), data };
  };

  const applyBackupData = async (backup) => {
    if (!backup || typeof backup !== 'object' || !backup.data || !Array.isArray(backup.data[STORAGE_KEY])) {
      Alert.alert('Invalid backup', 'That file does not look like an Expense Tracker backup (no entries found).');
      return false;
    }
    const d = backup.data;
    const pairs = [];
    if (d[STORAGE_KEY] !== undefined) pairs.push([STORAGE_KEY, JSON.stringify(d[STORAGE_KEY])]);
    if (d[CUSTOM_CATEGORIES_KEY] !== undefined) pairs.push([CUSTOM_CATEGORIES_KEY, JSON.stringify(d[CUSTOM_CATEGORIES_KEY])]);
    if (d[CATEGORY_BUDGETS_KEY] !== undefined) pairs.push([CATEGORY_BUDGETS_KEY, JSON.stringify(d[CATEGORY_BUDGETS_KEY])]);
    if (d[SAVINGS_GOALS_KEY] !== undefined) pairs.push([SAVINGS_GOALS_KEY, JSON.stringify(d[SAVINGS_GOALS_KEY])]);
    if (d[BILLS_KEY] !== undefined) pairs.push([BILLS_KEY, JSON.stringify(d[BILLS_KEY])]);
    // Budget, PIN and theme are stored as plain strings, not JSON.
    if (d[BUDGET_KEY] !== undefined) pairs.push([BUDGET_KEY, String(d[BUDGET_KEY])]);
    if (d[PIN_KEY] !== undefined) pairs.push([PIN_KEY, String(d[PIN_KEY])]);
    if (d[DARK_KEY] !== undefined) pairs.push([DARK_KEY, String(d[DARK_KEY])]);
    await AsyncStorage.multiSet(pairs);
    // Refresh every piece of state from the restored data.
    setEntries(normalizeEntries(d[STORAGE_KEY]) || []);
    if (Array.isArray(d[CUSTOM_CATEGORIES_KEY])) setCustomCategories(d[CUSTOM_CATEGORIES_KEY].filter((c) => typeof c === 'string'));
    const bVal = Number(d[BUDGET_KEY]);
    if (d[BUDGET_KEY] !== undefined && !Number.isNaN(bVal) && bVal > 0) {
      setBudget(bVal);
      setBudgetText(String(bVal));
    } else if (d[BUDGET_KEY] !== undefined) {
      setBudget(null);
      setBudgetText('');
    }
    if (d[CATEGORY_BUDGETS_KEY] && typeof d[CATEGORY_BUDGETS_KEY] === 'object') setCategoryBudgets(d[CATEGORY_BUDGETS_KEY]);
    if (Array.isArray(d[SAVINGS_GOALS_KEY])) {
      setGoals(d[SAVINGS_GOALS_KEY].map((g) => ({ ...g, target: Number(g.target) || 0, saved: Number(g.saved) || 0 })));
    }
    if (Array.isArray(d[BILLS_KEY])) {
      const restoredBills = d[BILLS_KEY].map((b) => ({
        ...b,
        amount: Number(b.amount) || 0,
        dueDay: Number(b.dueDay) || 1,
        paidMonths: Array.isArray(b.paidMonths) ? b.paidMonths : [],
        remind: b.remind !== false,
      }));
      setBills(restoredBills);
      syncBillNotifications(restoredBills);
    }
    if (d[PIN_KEY] !== undefined && String(d[PIN_KEY])) {
      setPin(String(d[PIN_KEY]));
    } else {
      setPin('');
      setLocked(false);
    }
    if (d[DARK_KEY] !== undefined) setDarkMode(String(d[DARK_KEY]) === '1');
    return true;
  };

  const exportBackup = async () => {
    try {
      const backup = await collectBackupData();
      const json = JSON.stringify(backup, null, 2);
      const fileName = `expense-tracker-backup-${todayISO()}.json`;
      if (Platform.OS === 'web') {
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        await Share.share({ message: json, title: fileName });
      }
      const stamp = todayISO();
      const count = Array.isArray(backup.data[STORAGE_KEY]) ? backup.data[STORAGE_KEY].length : 0;
      setLastBackup(stamp);
      await AsyncStorage.setItem(LAST_BACKUP_KEY, stamp).catch(() => {});
      const doneMessage = `${count} entries backed up on ${stamp}. Keep the file somewhere safe — it holds all your data.`;
      // Alert.alert does not show visibly in the web browser, so use the
      // browser's own alert() there (same pattern as Share entries).
      if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(`Backup saved\n${doneMessage}`);
      } else {
        Alert.alert('Backup saved', doneMessage);
      }
    } catch (err) {
      Alert.alert('Backup failed', err.message);
    }
  };

  const shareBackupByEmail = async () => {
    try {
      const backup = await collectBackupData();
      const json = JSON.stringify(backup, null, 2);
      await Share.share({
        message: `Expense Tracker backup (${todayISO()})\n\n${json}`,
        title: `expense-tracker-backup-${todayISO()}.json`,
      });
    } catch (err) {
      Alert.alert('Sharing backup failed', err.message);
    }
  };

  const restoreFromText = (text) => {
    let backup;
    try {
      backup = JSON.parse(text);
    } catch (e) {
      Alert.alert('Invalid backup', 'That text is not valid JSON.');
      return;
    }
    confirmAction('Restore backup?', 'This replaces all current entries, budgets, goals and bills with the backup. Continue?', async () => {
      try {
        const ok = await applyBackupData(backup);
        if (ok) {
          setRestoreText('');
          if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.alert === 'function') {
            window.alert('Backup restored\nYour data was restored from the backup.');
          } else {
            Alert.alert('Backup restored', 'Your data was restored from the backup.');
          }
        }
      } catch (err) {
        Alert.alert('Restore failed', err.message);
      }
    });
  };

  const pickBackupFile = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => restoreFromText(String(reader.result || ''));
      reader.readAsText(file);
    };
    input.click();
  };

  // 4b. Monthly report (PDF): on web it downloads an HTML report you open
  // and Print -> Save as PDF; on mobile it shares the report as text.
  const buildMonthlyReport = () => {
    const key = monthlySummary.thisKey;
    const monthEntries = entries.filter((i) => monthKeyOf(i.date) === key);
    const spent = monthlySummary.spent;
    const income = monthlySummary.income;
    const catMap = {};
    monthEntries
      .filter((i) => i.type !== 'income')
      .forEach((i) => {
        catMap[i.category] = (catMap[i.category] || 0) + Number(i.amount);
      });
    const catRows = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
    const sortedEntries = monthEntries.slice().sort((a, b) => a.date.localeCompare(b.date));
    const textLines = [
      `Expense Tracker — Monthly report ${monthLabel(key)}`,
      `Spent: ${formatAmount(spent)} · Income: ${formatAmount(income)} · Balance: ${formatAmount(income - spent)}`,
      `Top category: ${monthlySummary.topCategory ? `${monthlySummary.topCategory} (${formatAmount(monthlySummary.topAmount)})` : 'None'}`,
      `Biggest expense: ${monthlySummary.biggest ? `${monthlySummary.biggest.title} (${monthlySummary.biggest.category}) — ${formatAmount(monthlySummary.biggest.amount)} (${monthlySummary.biggest.date})` : 'None'}`,
      '',
      'By category:',
      ...catRows.map(([name, total]) => `  ${name}: ${formatAmount(total)}`),
      '',
      'Entries:',
      ...sortedEntries.map((i) => `  ${i.date} — ${i.title} (${i.category}) ${i.type === 'income' ? '+' : '−'}${formatAmount(i.amount)}${i.note ? ` — ${i.note}` : ''}`),
    ];
    const htmlRows = sortedEntries.map((i) => `<tr><td>${i.date}</td><td>${i.title}</td><td>${i.category}</td><td>${i.type}</td><td>${formatAmount(i.amount)}</td><td>${i.note || ''}</td></tr>`).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Expense Tracker — ${monthLabel(key)}</title><style>body{font-family:sans-serif;margin:32px;color:#111}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 8px;text-align:left}h1{font-size:22px}</style></head><body><h1>Expense Tracker — Monthly report ${monthLabel(key)}</h1><p>Spent: <b>${formatAmount(spent)}</b> · Income: <b>${formatAmount(income)}</b> · Balance: <b>${formatAmount(income - spent)}</b></p><p>Top category: <b>${monthlySummary.topCategory || 'None'}</b>${monthlySummary.topCategory ? ` (${formatAmount(monthlySummary.topAmount)})` : ''}</p><p>Biggest expense: <b>${monthlySummary.biggest ? `${monthlySummary.biggest.title} (${monthlySummary.biggest.category}) — ${formatAmount(monthlySummary.biggest.amount)} (${monthlySummary.biggest.date})` : 'None'}</b></p><h2>By category</h2><ul>${catRows.map(([name, total]) => `<li>${name}: ${formatAmount(total)}</li>`).join('')}</ul><h2>Entries</h2><table><tr><th>Date</th><th>Title</th><th>Category</th><th>Type</th><th>Amount</th><th>Note</th></tr>${htmlRows}</table><p>To save as PDF: in your browser choose Print → Save as PDF.</p></body></html>`;
    return { text: textLines.join('\n'), html };
  };

  const downloadMonthlyReport = async () => {
    const report = buildMonthlyReport();
    const fileName = `expense-report-${monthlySummary.thisKey}.html`;
    try {
      if (Platform.OS === 'web') {
        const blob = new Blob([report.html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        if (typeof window !== 'undefined' && typeof window.alert === 'function') {
          window.alert('Report downloaded\nOpen the downloaded file, then choose Print → Save as PDF to get the PDF.');
        }
      } else {
        await Share.share({ message: report.text, title: fileName });
      }
    } catch (err) {
      Alert.alert('Report failed', err.message);
    }
  };

  // ---- Derived data (all respect the search / category / month / date filters) ----
  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...entries]
      .sort((a, b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id)))
      .filter((item) => {
        if (query && !item.title.toLowerCase().includes(query)) return false;
        if (filterCategory !== 'All' && item.category !== filterCategory) return false;
        if (filterMonth && monthKeyOf(item.date) !== filterMonth) return false;
        if (filterFrom.trim() && item.date < filterFrom.trim()) return false;
        if (filterTo.trim() && item.date > filterTo.trim()) return false;
        return true;
      });
  }, [entries, search, filterCategory, filterMonth, filterFrom, filterTo]);

  // Calendar cells for the date picker: leading blanks, then day numbers 1..N.
  const pickerDays = useMemo(() => {
    const firstWeekday = new Date(pickerMonth.year, pickerMonth.month, 1).getDay();
    const daysInMonth = new Date(pickerMonth.year, pickerMonth.month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) cells.push(day);
    return cells;
  }, [pickerMonth]);

  const totalSpent = useMemo(
    () => filteredEntries.filter((i) => i.type !== 'income').reduce((s, i) => s + Number(i.amount), 0),
    [filteredEntries]
  );
  // Budget is always measured against this calendar month's real spending.
  const thisMonthSpent = useMemo(() => {
    const prefix = monthKeyOf(todayISO());
    return entries
      .filter((item) => item.type !== 'income' && monthKeyOf(item.date) === prefix)
      .reduce((sum, item) => sum + Number(item.amount), 0);
  }, [entries]);

  // 1. This month's spending per expense category (for per-category budgets).
  const thisMonthSpentByCategory = useMemo(() => {
    const prefix = monthKeyOf(todayISO());
    const map = {};
    entries
      .filter((item) => item.type !== 'income' && monthKeyOf(item.date) === prefix)
      .forEach((item) => {
        map[item.category] = (map[item.category] || 0) + Number(item.amount);
      });
    return map;
  }, [entries]);

  // 4. Monthly summary for the current month, from the real entries.
  const monthlySummary = useMemo(() => {
    const now = new Date();
    const thisKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    const lastKey = addMonths(`${thisKey}-01`, -1).slice(0, 7);
    const inMonth = (key) => entries.filter((i) => monthKeyOf(i.date) === key);
    const sumOf = (list, type) =>
      list
        .filter((i) => (type === 'income' ? i.type === 'income' : i.type !== 'income'))
        .reduce((s, i) => s + Number(i.amount), 0);
    const thisList = inMonth(thisKey);
    const spent = sumOf(thisList, 'expense');
    const income = sumOf(thisList, 'income');
    const expensesThis = thisList.filter((i) => i.type !== 'income');
    const topMap = {};
    expensesThis.forEach((i) => {
      topMap[i.category] = (topMap[i.category] || 0) + Number(i.amount);
    });
    const topEntry = Object.entries(topMap).sort((a, b) => b[1] - a[1])[0];
    const biggest = expensesThis.slice().sort((a, b) => Number(b.amount) - Number(a.amount))[0] || null;
    const lastSpent = sumOf(inMonth(lastKey), 'expense');
    const diff = spent - lastSpent;
    const pct = lastSpent > 0 ? Math.round((diff / lastSpent) * 100) : null;
    return {
      thisKey,
      count: thisList.length,
      spent,
      income,
      balance: income - spent,
      topCategory: topEntry ? topEntry[0] : null,
      topAmount: topEntry ? topEntry[1] : 0,
      biggest,
      lastSpent,
      diff,
      pct,
    };
  }, [entries]);

  // 3. Bill status for the current month: paid, overdue, or upcoming.
  const billStatuses = useMemo(() => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return bills
      .map((bill) => {
        const dueDay = Math.min(Number(bill.dueDay) || 1, lastDay);
        const paid = Array.isArray(bill.paidMonths) && bill.paidMonths.includes(monthKey);
        const overdue = !paid && dueDay < now.getDate();
        return { ...bill, dueDay, paid, overdue, monthKey };
      })
      .sort((a, b) =>
        (a.paid ? 1 : 0) - (b.paid ? 1 : 0)
        || (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0)
        || a.dueDay - b.dueDay
      );
  }, [bills]);

  // 2. Bills due today or overdue (unpaid, reminders on) — shown as a banner
  // on Home and once as an alert when the app opens.
  const dueBills = useMemo(
    () => billStatuses.filter((b) => !b.paid && b.remind !== false && (b.overdue || b.dueDay === new Date().getDate())),
    [billStatuses]
  );

  useEffect(() => {
    if (loading || dueBills.length === 0 || billAlertShown.current) return;
    billAlertShown.current = true;
    const lines = dueBills.map((b) => `• ${b.name} — ${formatAmount(b.amount)} (${b.overdue ? 'overdue' : 'due today'})`).join('\n');
    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(`Bills due
${lines}`);
    } else {
      Alert.alert('Bills due', lines);
    }
  }, [loading, dueBills]);

  const monthlyTotals = useMemo(() => {
    const totals = Array(12).fill(0);
    filteredEntries
      .filter((i) => i.type !== 'income')
      .forEach((item) => {
        const month = Number(item.date.slice(5, 7)) - 1;
        if (month >= 0 && month < 12) totals[month] += Number(item.amount);
      });
    return totals;
  }, [filteredEntries]);

  const weeklyData = useMemo(() => {
    const labels = [];
    const data = [];
    for (let i = 6; i >= 0; i--) {
      const day = addDays(todayISO(), -i);
      labels.push(WEEKDAY_SHORT[parseLocalDate(day).getDay()]);
      data.push(
        filteredEntries
          .filter((item) => item.type !== 'income' && item.date === day)
          .reduce((sum, item) => sum + Number(item.amount), 0)
      );
    }
    return { labels, data };
  }, [filteredEntries]);

  const categoryTotals = useMemo(() => {
    const map = {};
    filteredEntries
      .filter((i) => i.type !== 'income')
      .forEach((item) => {
        map[item.category] = (map[item.category] || 0) + Number(item.amount);
      });
    return Object.entries(map)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);
  }, [filteredEntries]);

  // Per-category trend: the selected expense category's spending per month
  // (Jan-Dec, all years combined — same convention as the Monthly tab), plus
  // this month vs last month. Uses all entries, not the Entries-screen
  // filters, so the trend is the category's true history.
  // Falls back to Food if the selected category was removed.
  const trendCategoryEffective = allCategories.includes(trendCategory)
    ? trendCategory
    : 'Food';

  const trendMonthlyTotals = useMemo(() => {
    const totals = Array(12).fill(0);
    entries
      .filter((i) => i.type !== 'income' && i.category === trendCategoryEffective)
      .forEach((item) => {
        const month = Number(item.date.slice(5, 7)) - 1;
        if (month >= 0 && month < 12) totals[month] += Number(item.amount);
      });
    return totals;
  }, [entries, trendCategoryEffective]);

  const trendSummary = useMemo(() => {
    const now = new Date();
    const thisKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    const lastKey = addMonths(`${thisKey}-01`, -1).slice(0, 7);
    const sumFor = (key) =>
      entries
        .filter((i) => i.type !== 'income' && i.category === trendCategoryEffective && monthKeyOf(i.date) === key)
        .reduce((sum, item) => sum + Number(item.amount), 0);
    const thisTotal = sumFor(thisKey);
    const lastTotal = sumFor(lastKey);
    const diff = thisTotal - lastTotal;
    const pct = lastTotal > 0 ? Math.round((diff / lastTotal) * 100) : null;
    let label;
    if (lastTotal === 0 && thisTotal === 0) {
      label = 'No spending in either month.';
    } else if (lastTotal === 0) {
      label = `Up by ${formatAmount(diff)} vs last month — no spending last month.`;
    } else if (diff > 0) {
      label = `Up by ${formatAmount(diff)} (${pct}% more) vs last month.`;
    } else if (diff < 0) {
      label = `Down by ${formatAmount(-diff)} (${Math.abs(pct)}% less) vs last month.`;
    } else {
      label = 'Same as last month.';
    }
    return { thisKey, lastKey, thisTotal, lastTotal, diff, label };
  }, [entries, trendCategoryEffective]);

  const chartConfig = {
    backgroundColor: darkMode ? '#1f2329' : '#ffffff',
    backgroundGradientFrom: darkMode ? '#1f2329' : '#ffffff',
    backgroundGradientTo: darkMode ? '#1f2329' : '#ffffff',
    decimalPlaces: 0,
    // Slimmer bars and slightly smaller axis labels leave more room for the
    // 12 month labels, so the last one ("Dec") is not squeezed off the edge.
    barPercentage: 0.8,
    propsForLabels: { fontSize: 11 },
    color: (opacity = 1) => (darkMode ? `rgba(255, 255, 255, ${opacity})` : `rgba(0, 0, 0, ${opacity})`),
    labelColor: (opacity = 1) => (darkMode ? `rgba(255, 255, 255, ${opacity})` : `rgba(0, 0, 0, ${opacity})`),
    style: { borderRadius: 16 },
  };

  const budgetRatio = budget && budget > 0 ? thisMonthSpent / budget : 0;
  const budgetWarning =
    budget && budgetRatio >= 1
      ? `Over budget by ${formatAmount(thisMonthSpent - budget)} this month!`
      : budget && budgetRatio >= 0.8
        ? `Warning: you have used ${Math.round(budgetRatio * 100)}% of this month's budget.`
        : null;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text>Loading...</Text>
      </View>
    );
  }

  if (locked) {
    return (
      <View style={styles.center}>
        <Text style={styles.sectionTitle}>🔒 Expense Tracker is locked</Text>
        <Text style={styles.budgetText}>Enter your 4-digit PIN to open the app.</Text>
        <TextInput
          style={styles.input}
          placeholder="4-digit PIN"
          value={pinInput}
          onChangeText={setPinInput}
          keyboardType="numeric"
          secureTextEntry
          maxLength={4}
        />
        <TouchableOpacity style={styles.addButton} onPress={unlockApp}>
          <Text style={styles.addButtonText}>Unlock</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.app}>
      {/* ---- Top bar on every screen ---- */}
      <View style={styles.topBar}>
        <Text style={styles.topBarTitle}>Expense Tracker</Text>
        <View style={styles.topBarButtons}>
          <TouchableOpacity style={styles.menuButton} onPress={() => saveDarkMode(!darkMode)}>
            <Text style={styles.menuButtonText}>{darkMode ? '☀️' : '🌙'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuButton} onPress={() => setMenuOpen(!menuOpen)}>
            <Text style={styles.menuButtonText}>⋮</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ---- Side menu (⋮) ---- */}
      {menuOpen ? (
        <View style={styles.menuOverlay}>
          <TouchableOpacity
            style={styles.menuBackdrop}
            activeOpacity={1}
            onPress={() => setMenuOpen(false)}
          />
          <View style={styles.menuPanel}>
            <View style={styles.menuHeaderRow}>
              <Text style={styles.menuTitle}>Menu</Text>
              <TouchableOpacity onPress={() => setMenuOpen(false)}>
                <Text style={styles.menuCloseText}>✕ Close</Text>
              </TouchableOpacity>
            </View>
            {SCREENS.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={[
                  styles.menuItem,
                  screen === item.key && styles.menuItemSelected,
                ]}
                onPress={() => goToScreen(item.key)}
              >
                <Text
                  style={[
                    styles.menuItemText,
                    screen === item.key && styles.menuItemTextSelected,
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {screen === 'home' ? (
          <View style={styles.screenContent}>
            <Text style={styles.screenTitle}>Home</Text>
            <View style={styles.summaryRow}>
              <View style={styles.summaryBox}>
                <Text style={styles.summaryLabel}>Spent this month</Text>
                <Text style={styles.summaryValue}>{formatAmount(monthlySummary.spent)}</Text>
              </View>
              <View style={styles.summaryBox}>
                <Text style={styles.summaryLabel}>Income this month</Text>
                <Text style={[styles.summaryValue, styles.incomeValue]}>{formatAmount(monthlySummary.income)}</Text>
              </View>
              <View style={styles.summaryBox}>
                <Text style={styles.summaryLabel}>Balance this month</Text>
                <Text style={[styles.summaryValue, monthlySummary.balance < 0 && styles.negativeValue]}>
                  {formatAmount(monthlySummary.balance)}
                </Text>
              </View>
            </View>
            <Text style={styles.filterNote}>
              This month: {monthlySummary.count} entries · Spent {formatAmount(monthlySummary.spent)}
            </Text>
            {dueBills.length > 0 ? (
              <View style={styles.billAlertBox}>
                <Text style={styles.billAlertTitle}>🔔 Bills due — {dueBills.length}</Text>
                {dueBills.map((b) => (
                  <Text key={b.id} style={styles.billAlertText}>
                    {b.name} — {formatAmount(b.amount)} ({b.overdue ? 'Overdue!' : 'Due today'})
                  </Text>
                ))}
                <TouchableOpacity style={styles.smallButton} onPress={() => goToScreen('bills')}>
                  <Text style={styles.smallButtonText}>View bills</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* ---- Add / edit form ---- */}
            <Text style={styles.sectionTitle}>{editingId ? 'Edit entry' : entryType === 'income' ? 'Add income' : 'Add an expense'}</Text>
            <View style={styles.typeRow}>
              <TouchableOpacity
                style={[styles.typeButton, entryType === 'expense' && styles.typeButtonSelectedExpense]}
                onPress={() => { setEntryType('expense'); if (INCOME_CATEGORIES.includes(category)) setCategory('Food'); }}
              >
                <Text style={[styles.typeText, entryType === 'expense' && styles.typeTextSelected]}>Expense</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.typeButton, entryType === 'income' && styles.typeButtonSelectedIncome]}
                onPress={() => { setEntryType('income'); if (!INCOME_CATEGORIES.includes(category)) setCategory('Salary'); }}
              >
                <Text style={[styles.typeText, entryType === 'income' && styles.typeTextSelected]}>Income</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder={entryType === 'income' ? 'What did you earn? e.g. Salary' : 'What did you spend on? e.g. Groceries'}
              value={title}
              onChangeText={setTitle}
            />
            <TextInput
              style={styles.input}
              placeholder="Amount e.g. 500"
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
            />
            <View style={styles.dateRow}>
              <TouchableOpacity style={styles.dateStepButton} onPress={() => setDate(addDays(date, -1))}>
                <Text style={styles.dateStepText}>‹</Text>
              </TouchableOpacity>
              <TextInput
                style={[styles.input, styles.dateInput]}
                placeholder="Date YYYY-MM-DD"
                value={date}
                onChangeText={setDate}
              />
              <TouchableOpacity style={styles.dateStepButton} onPress={() => setDate(addDays(date, 1))}>
                <Text style={styles.dateStepText}>›</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.todayButton} onPress={() => setDate(todayISO())}>
                <Text style={styles.todayButtonText}>Today</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.dateHint}>Date defaults to today — tap ‹ ›, Today, or Pick date to change it.</Text>
            <TouchableOpacity style={styles.pickDateButton} onPress={openDatePicker}>
              <Text style={styles.pickDateButtonText}>📅  Pick date</Text>
            </TouchableOpacity>
            {showDatePicker ? (
              <View style={styles.calendarBox}>
                <View style={styles.calendarHeader}>
                  <TouchableOpacity style={styles.calendarNavButton} onPress={() => shiftPickerMonth(-1)}>
                    <Text style={styles.calendarNavText}>‹</Text>
                  </TouchableOpacity>
                  <Text style={styles.calendarTitle}>
                    {MONTH_NAMES[pickerMonth.month]} {pickerMonth.year}
                  </Text>
                  <TouchableOpacity style={styles.calendarNavButton} onPress={() => shiftPickerMonth(1)}>
                    <Text style={styles.calendarNavText}>›</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.calendarWeekRow}>
                  {WEEKDAY_SHORT.map((day) => (
                    <Text key={day} style={styles.calendarWeekDay}>{day}</Text>
                  ))}
                </View>
                <View style={styles.calendarGrid}>
                  {pickerDays.map((day, index) => {
                    if (day === null) {
                      return <View key={`blank-${index}`} style={styles.calendarDay} />;
                    }
                    const dayISO = formatISO(new Date(pickerMonth.year, pickerMonth.month, day));
                    const isSelected = dayISO === date.trim();
                    const isToday = dayISO === todayISO();
                    return (
                      <TouchableOpacity
                        key={dayISO}
                        style={[
                          styles.calendarDay,
                          isToday && styles.calendarDayToday,
                          isSelected && styles.calendarDaySelected,
                        ]}
                        onPress={() => pickDate(day)}
                      >
                        <Text
                          style={[
                            styles.calendarDayText,
                            isSelected && styles.calendarDayTextSelected,
                          ]}
                        >
                          {day}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TouchableOpacity style={styles.calendarCloseButton} onPress={() => setShowDatePicker(false)}>
                  <Text style={styles.calendarCloseText}>Close</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <View style={styles.categoryRow}>
              {formCategories.map((item) => (
                <TouchableOpacity
                  key={item}
                  style={[
                    styles.categoryChip,
                    category === item && { backgroundColor: colorForCategory(item, customCategories) },
                  ]}
                  onPress={() => setCategory(item)}
                >
                  <Text
                    style={[
                      styles.categoryText,
                      category === item && styles.categoryTextSelected,
                    ]}
                  >
                    {item}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {entryType === 'expense' ? (
              <TouchableOpacity
                style={styles.repeatRow}
                onPress={() => setRepeatMonthly(!repeatMonthly)}
              >
                <Text style={styles.repeatBox}>{repeatMonthly ? '☑' : '☐'}</Text>
                <Text style={styles.repeatText}>Repeat every month</Text>
              </TouchableOpacity>
            ) : null}
            <TextInput
              style={styles.input}
              placeholder="Note (optional) e.g. Bought from Sunday bazaar"
              value={note}
              onChangeText={setNote}
            />
            <View style={styles.typeRow}>
              <TouchableOpacity style={[styles.typeButton, styles.photoButton]} onPress={() => pickReceiptPhoto(true)}>
                <Text style={styles.typeText}>📷 Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.typeButton, styles.photoButton]} onPress={() => pickReceiptPhoto(false)}>
                <Text style={styles.typeText}>🖼 Choose photo</Text>
              </TouchableOpacity>
            </View>
            {photoUri ? (
              <View style={styles.photoPreviewRow}>
                <Image style={styles.receiptImageLarge} source={{ uri: photoUri }} />
                <TouchableOpacity onPress={() => setPhotoUri('')}>
                  <Text style={styles.deleteText}>Remove photo</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <TextInput
              style={styles.input}
              placeholder="Receipt photo link (optional) — paste an image URL"
              value={photoUrl}
              onChangeText={setPhotoUrl}
              autoCapitalize="none"
            />
            <Text style={styles.dateHint}>Photo tip: snap the receipt with the Camera button, or paste an image link from Google Drive / Google Photos. The photo is saved with the entry.</Text>
            <TouchableOpacity
              style={[styles.addButton, editingId && styles.saveButton]}
              onPress={submitEntry}
            >
              <Text style={styles.addButtonText}>
                {editingId ? '✓  Save Changes' : entryType === 'income' ? '+  Add Income' : '+  Add Expense'}
              </Text>
            </TouchableOpacity>
            {editingId ? (
              <TouchableOpacity style={styles.cancelButton} onPress={resetForm}>
                <Text style={styles.cancelButtonText}>Cancel editing</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {screen === 'entries' ? (
          <View style={styles.screenContent}>
            <Text style={styles.screenTitle}>Entries</Text>
            <Text style={styles.filterNote}>
              Showing {filteredEntries.length} of {entries.length} entries
              {filterMonth || filterCategory !== 'All' || search.trim() || filterFrom.trim() || filterTo.trim()
                ? ' (filtered)'
                : ''}
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Search by title e.g. groceries"
              value={search}
              onChangeText={setSearch}
            />
            <View style={styles.categoryRow}>
              {['All', ...allCategories].map((item) => (
                <TouchableOpacity
                  key={item}
                  style={[
                    styles.categoryChip,
                    filterCategory === item && styles.filterChipSelected,
                  ]}
                  onPress={() => setFilterCategory(item)}
                >
                  <Text
                    style={[
                      styles.categoryText,
                      filterCategory === item && styles.categoryTextSelected,
                    ]}
                  >
                    {item}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.monthFilterRow}>
              <TouchableOpacity style={styles.dateStepButton} onPress={() => shiftFilterMonth(-1)}>
                <Text style={styles.dateStepText}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.monthFilterLabel}>
                {filterMonth ? monthLabel(filterMonth) : 'All months'}
              </Text>
              <TouchableOpacity style={styles.dateStepButton} onPress={() => shiftFilterMonth(1)}>
                <Text style={styles.dateStepText}>›</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.smallButton} onPress={() => setFilterMonth(null)}>
                <Text style={styles.smallButtonText}>All</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.dateFilterRow}>
              <TextInput
                style={[styles.input, styles.dateFilterInput]}
                placeholder="From YYYY-MM-DD"
                value={filterFrom}
                onChangeText={setFilterFrom}
              />
              <TextInput
                style={[styles.input, styles.dateFilterInput]}
                placeholder="To YYYY-MM-DD"
                value={filterTo}
                onChangeText={setFilterTo}
              />
              <TouchableOpacity
                style={styles.smallButton}
                onPress={() => { setFilterFrom(''); setFilterTo(''); }}
              >
                <Text style={styles.smallButtonText}>Clear</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.exportButton} onPress={exportCsv}>
              <Text style={styles.exportButtonText}>⇩  Export as CSV ({filteredEntries.length})</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.exportButton} onPress={shareEntries}>
              <Text style={styles.exportButtonText}>↗  Share entries ({filteredEntries.length})</Text>
            </TouchableOpacity>

            {filteredEntries.length === 0 ? (
              <Text style={styles.emptyText}>No entries match. Try clearing the search or filters.</Text>
            ) : (
              filteredEntries.map((item) => (
                <View key={item.id} style={styles.expenseRow}>
                  <View
                    style={[
                      styles.categoryDot,
                      { backgroundColor: colorForCategory(item.category, customCategories) },
                    ]}
                  />
                  <View style={styles.expenseInfo}>
                    <Text style={styles.expenseTitle}>{item.title}</Text>
                    <Text style={styles.expenseMeta}>
                      {item.category} · {item.date}
                      {item.type === 'income' ? ' · Income' : ''}
                      {item.repeat ? ' · Repeats monthly' : ''}
                      {item.generatedFrom ? ' · Auto (monthly repeat)' : ''}
                    </Text>
                    {item.note ? <Text style={styles.noteText}>📝 {item.note}</Text> : null}
                  </View>
                  {(item.photoUri || item.photoUrl) ? (
                    <Image style={styles.receiptImage} source={{ uri: item.photoUri || item.photoUrl }} />
                  ) : null}
                  <Text
                    style={[
                      styles.expenseAmount,
                      item.type === 'income' && styles.incomeValue,
                    ]}
                  >
                    {item.type === 'income' ? '+' : '−'}{formatAmount(item.amount)}
                  </Text>
                  <View style={styles.rowActions}>
                    <TouchableOpacity onPress={() => startEdit(item)}>
                      <Text style={styles.editText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteEntry(item.id, item.title)}>
                      <Text style={styles.deleteText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        ) : null}

        {screen === 'charts' ? (
          <View style={styles.screenContent}>
            <Text style={styles.screenTitle}>Charts</Text>
            <Text style={styles.sectionTitle}>This month — {monthLabel(monthlySummary.thisKey)}</Text>
            <View style={styles.budgetBox}>
              <Text style={styles.budgetText}>
                Spent: {formatAmount(monthlySummary.spent)}
                {'  ·  '}Income: {formatAmount(monthlySummary.income)}
                {'  ·  '}Balance: {formatAmount(monthlySummary.balance)}
              </Text>
              <Text style={styles.budgetText}>
                Top category: {monthlySummary.topCategory
                  ? `${monthlySummary.topCategory} (${formatAmount(monthlySummary.topAmount)})`
                  : 'No spending yet'}
              </Text>
              <Text style={styles.budgetText}>
                Biggest expense: {monthlySummary.biggest
                  ? `${monthlySummary.biggest.title} (${monthlySummary.biggest.category}) — ${formatAmount(monthlySummary.biggest.amount)} (${monthlySummary.biggest.date})`
                  : 'None yet'}
              </Text>
              <Text
                style={[
                  styles.budgetText,
                  { fontWeight: 'bold' },
                  monthlySummary.diff > 0 && styles.warningText,
                  monthlySummary.diff < 0 && styles.incomeValue,
                ]}
              >
                vs last month: {monthlySummary.pct === null
                  ? (monthlySummary.spent > 0
                    ? `Spent ${formatAmount(monthlySummary.spent)} — nothing spent last month.`
                    : 'No spending this month or last month.')
                  : monthlySummary.diff > 0
                    ? `Up by ${formatAmount(monthlySummary.diff)} (${monthlySummary.pct}% more) vs last month.`
                    : monthlySummary.diff < 0
                      ? `Down by ${formatAmount(-monthlySummary.diff)} (${Math.abs(monthlySummary.pct)}% less) vs last month.`
                      : 'Same as last month.'}
              </Text>
            </View>
            <TouchableOpacity style={styles.exportButton} onPress={downloadMonthlyReport}>
              <Text style={styles.exportButtonText}>📄  Monthly report (PDF)</Text>
            </TouchableOpacity>
            <Text style={styles.sectionTitle}>Spending trends</Text>
            <View style={styles.typeRow}>
              {[
                { key: 'monthly', label: 'Monthly' },
                { key: 'weekly', label: 'Weekly' },
                { key: 'category', label: 'By category' },
                { key: 'trend', label: 'Category trend' },
              ].map((view) => (
                <TouchableOpacity
                  key={view.key}
                  style={[styles.typeButton, chartView === view.key && styles.typeButtonSelectedExpense]}
                  onPress={() => {
                    // Opening the trend view always starts on Food.
                    if (view.key === 'trend') setTrendCategory('Food');
                    setChartView(view.key);
                  }}
                >
                  <Text style={[styles.typeText, chartView === view.key && styles.typeTextSelected]}>
                    {view.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {chartView === 'monthly' ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <BarChart
                  data={{ labels: MONTH_LABELS, datasets: [{ data: monthlyTotals }] }}
                  width={MONTH_CHART_WIDTH}
                  height={220}
                  yAxisLabel="Rs. "
                  chartConfig={chartConfig}
                  style={{ marginVertical: 8, borderRadius: 16 }}
                />
              </ScrollView>
            ) : chartView === 'weekly' ? (
              <View>
                <Text style={styles.chartNote}>Spending in the last 7 days</Text>
                <BarChart
                  data={{ labels: weeklyData.labels, datasets: [{ data: weeklyData.data }] }}
                  width={CHART_WIDTH}
                  height={220}
                  yAxisLabel="Rs. "
                  chartConfig={chartConfig}
                  style={{ marginVertical: 8, borderRadius: 16 }}
                />
              </View>
            ) : chartView === 'trend' ? (
              <View>
                <Text style={styles.chartNote}>Pick a category to see whether its spending is going up or down.</Text>
                <View style={styles.categoryRow}>
                  {allCategories.map((item) => (
                    <TouchableOpacity
                      key={item}
                      style={[
                        styles.categoryChip,
                        trendCategoryEffective === item && { backgroundColor: colorForCategory(item, customCategories) },
                      ]}
                      onPress={() => setTrendCategory(item)}
                    >
                      <Text
                        style={[
                          styles.categoryText,
                          trendCategoryEffective === item && styles.categoryTextSelected,
                        ]}
                      >
                        {item}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <BarChart
                    data={{ labels: MONTH_LABELS, datasets: [{ data: trendMonthlyTotals }] }}
                    width={MONTH_CHART_WIDTH}
                    height={220}
                    yAxisLabel="Rs. "
                    chartConfig={chartConfig}
                    style={{ marginVertical: 8, borderRadius: 16 }}
                  />
                </ScrollView>
                <View style={styles.budgetBox}>
                  <Text style={styles.budgetText}>
                    {trendCategoryEffective} — {monthLabel(trendSummary.thisKey)} vs {monthLabel(trendSummary.lastKey)}
                  </Text>
                  <Text style={styles.budgetText}>
                    This month: {formatAmount(trendSummary.thisTotal)}
                    {'  ·  '}Last month: {formatAmount(trendSummary.lastTotal)}
                  </Text>
                  <Text
                    style={[
                      styles.budgetText,
                      { fontWeight: 'bold' },
                      trendSummary.diff > 0 && styles.warningText,
                      trendSummary.diff < 0 && styles.incomeValue,
                    ]}
                  >
                    {trendSummary.label}
                  </Text>
                </View>
              </View>
            ) : categoryTotals.length === 0 ? (
              <Text style={styles.emptyText}>No spending to show by category yet.</Text>
            ) : (
              <View>
                <BarChart
                  data={{
                    labels: categoryTotals.slice(0, 6).map((c) => c.name.slice(0, 6)),
                    datasets: [{ data: categoryTotals.slice(0, 6).map((c) => c.total) }],
                  }}
                  width={CHART_WIDTH}
                  height={220}
                  yAxisLabel="Rs. "
                  chartConfig={chartConfig}
                  style={{ marginVertical: 8, borderRadius: 16 }}
                />
                {categoryTotals.map((c) => (
                  <View key={c.name} style={styles.breakdownRow}>
                    <View
                      style={[styles.categoryDot, { backgroundColor: colorForCategory(c.name, customCategories) }]}
                    />
                    <Text style={styles.breakdownName}>{c.name}</Text>
                    <Text style={styles.breakdownAmount}>{formatAmount(c.total)}</Text>
                    <Text style={styles.breakdownPct}>
                      {totalSpent > 0 ? `${Math.round((c.total / totalSpent) * 100)}%` : '0%'}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : null}

        {screen === 'budget' ? (
          <View style={styles.screenContent}>
            <Text style={styles.screenTitle}>Budget & Categories</Text>
            <Text style={styles.sectionTitle}>Monthly budget</Text>
            <View style={styles.budgetBox}>
              <View style={styles.budgetRow}>
                <TextInput
                  style={[styles.input, styles.budgetInput]}
                  placeholder="Budget e.g. 20000"
                  value={budgetText}
                  onChangeText={setBudgetText}
                  keyboardType="numeric"
                />
                <TouchableOpacity style={styles.smallButton} onPress={saveBudget}>
                  <Text style={styles.smallButtonText}>Set budget</Text>
                </TouchableOpacity>
                {budget ? (
                  <TouchableOpacity style={[styles.smallButton, styles.clearButton]} onPress={clearBudget}>
                    <Text style={styles.smallButtonText}>Clear</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {budget ? (
                <View>
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${Math.min(100, Math.round(budgetRatio * 100))}%` },
                        budgetRatio >= 1 && styles.progressOver,
                        budgetRatio >= 0.8 && budgetRatio < 1 && styles.progressWarning,
                      ]}
                    />
                  </View>
                  <Text style={styles.budgetText}>
                    {formatAmount(thisMonthSpent)} of {formatAmount(budget)} used
                    {' '}({Math.round(budgetRatio * 100)}%)
                  </Text>
                  {budgetWarning ? <Text style={styles.warningText}>{budgetWarning}</Text> : null}
                </View>
              ) : (
                <Text style={styles.budgetText}>No monthly budget set yet.</Text>
              )}
            </View>

            <Text style={styles.sectionTitle}>Budget per category</Text>
            <View style={styles.budgetBox}>
              <Text style={styles.chartNote}>Set a monthly budget for one category at a time.</Text>
              <View style={styles.categoryRow}>
                {allCategories.map((item) => (
                  <TouchableOpacity
                    key={item}
                    style={[
                      styles.categoryChip,
                      catBudgetCategory === item && { backgroundColor: colorForCategory(item, customCategories) },
                    ]}
                    onPress={() => {
                      setCatBudgetCategory(item);
                      setCatBudgetText(categoryBudgets[item] ? String(categoryBudgets[item]) : '');
                    }}
                  >
                    <Text
                      style={[
                        styles.categoryText,
                        catBudgetCategory === item && styles.categoryTextSelected,
                      ]}
                    >
                      {item}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.budgetRow}>
                <TextInput
                  style={[styles.input, styles.budgetInput]}
                  placeholder={`Budget for ${catBudgetCategory} e.g. 10000`}
                  value={catBudgetText}
                  onChangeText={setCatBudgetText}
                  keyboardType="numeric"
                />
                <TouchableOpacity style={styles.smallButton} onPress={saveCategoryBudget}>
                  <Text style={styles.smallButtonText}>Set</Text>
                </TouchableOpacity>
              </View>
              {Object.keys(categoryBudgets).filter((name) => allCategories.includes(name)).length === 0 ? (
                <Text style={styles.budgetText}>No per-category budgets set yet.</Text>
              ) : (
                Object.keys(categoryBudgets)
                  .filter((name) => allCategories.includes(name))
                  .map((name) => {
                    const catBudget = Number(categoryBudgets[name]);
                    const spent = thisMonthSpentByCategory[name] || 0;
                    const ratio = catBudget > 0 ? spent / catBudget : 0;
                    return (
                      <View key={name} style={{ marginTop: 8 }}>
                        <View style={styles.breakdownRow}>
                          <View
                            style={[styles.categoryDot, { backgroundColor: colorForCategory(name, customCategories) }]}
                          />
                          <Text style={styles.breakdownName}>{name}</Text>
                          <Text style={styles.breakdownAmount}>{formatAmount(spent)} / {formatAmount(catBudget)}</Text>
                          <TouchableOpacity onPress={() => clearCategoryBudget(name)}>
                            <Text style={styles.deleteText}>Clear</Text>
                          </TouchableOpacity>
                        </View>
                        <View style={styles.progressTrack}>
                          <View
                            style={[
                              styles.progressFill,
                              { width: `${Math.min(100, Math.round(ratio * 100))}%` },
                              ratio >= 1 && styles.progressOver,
                              ratio >= 0.8 && ratio < 1 && styles.progressWarning,
                            ]}
                          />
                        </View>
                        <Text style={styles.budgetText}>{Math.round(ratio * 100)}% used this month</Text>
                        {ratio >= 1 ? (
                          <Text style={styles.warningText}>Over budget by {formatAmount(spent - catBudget)} on {name}!</Text>
                        ) : ratio >= 0.8 ? (
                          <Text style={styles.warningText}>Warning: {name} is at {Math.round(ratio * 100)}% of its budget.</Text>
                        ) : null}
                      </View>
                    );
                  })
              )}
            </View>

            <Text style={styles.sectionTitle}>Savings goals</Text>
            <View style={styles.budgetBox}>
              <View style={styles.customCategoryRow}>
                <TextInput
                  style={[styles.input, styles.customCategoryInput]}
                  placeholder="Goal e.g. New phone"
                  value={goalName}
                  onChangeText={setGoalName}
                />
                <TextInput
                  style={[styles.input, styles.budgetInput]}
                  placeholder="Target Rs."
                  value={goalTargetText}
                  onChangeText={setGoalTargetText}
                  keyboardType="numeric"
                />
                <TouchableOpacity style={styles.smallButton} onPress={addGoal}>
                  <Text style={styles.smallButtonText}>+ Goal</Text>
                </TouchableOpacity>
              </View>
              {goals.length === 0 ? (
                <Text style={styles.budgetText}>No savings goals yet. Add one above.</Text>
              ) : (
                goals.map((goal) => {
                  const ratio = goal.target > 0 ? Number(goal.saved) / goal.target : 0;
                  const reached = Number(goal.saved) >= goal.target;
                  return (
                    <View key={goal.id} style={{ marginTop: 8 }}>
                      <TouchableOpacity onPress={() => setSelectedGoalId(goal.id)}>
                        <View style={styles.breakdownRow}>
                          <Text style={styles.breakdownName}>
                            {selectedGoalId === goal.id ? '● ' : ''}{goal.name}
                          </Text>
                          <Text style={styles.breakdownAmount}>{formatAmount(goal.saved)} / {formatAmount(goal.target)}</Text>
                          <TouchableOpacity onPress={() => deleteGoal(goal.id, goal.name)}>
                            <Text style={styles.deleteText}>Delete</Text>
                          </TouchableOpacity>
                        </View>
                      </TouchableOpacity>
                      <View style={styles.progressTrack}>
                        <View
                          style={[
                            styles.progressFill,
                            { width: `${Math.min(100, Math.round(ratio * 100))}%` },
                          ]}
                        />
                      </View>
                      <Text style={styles.budgetText}>
                        {Math.round(ratio * 100)}% saved{reached ? ' — ✓ Goal reached!' : ''}
                      </Text>
                    </View>
                  );
                })
              )}
              {goals.length > 0 ? (
                <View style={styles.customCategoryRow}>
                  <TextInput
                    style={[styles.input, styles.customCategoryInput]}
                    placeholder="Add money e.g. 2000"
                    value={goalAddText}
                    onChangeText={setGoalAddText}
                    keyboardType="numeric"
                  />
                  <TouchableOpacity style={styles.smallButton} onPress={addToGoal}>
                    <Text style={styles.smallButtonText}>+ Add to goal</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {goals.length > 0 ? (
                <Text style={styles.dateHint}>Tap a goal to select it, then add money to it.</Text>
              ) : null}
            </View>

            <Text style={styles.sectionTitle}>Categories</Text>
            <Text style={styles.chartNote}>Built-in categories: {CATEGORIES.join(', ')}</Text>
            <View style={styles.customCategoryRow}>
              <TextInput
                style={[styles.input, styles.customCategoryInput]}
                placeholder="New category e.g. Health"
                value={newCategory}
                onChangeText={setNewCategory}
              />
              <TouchableOpacity style={styles.smallButton} onPress={addCustomCategory}>
                <Text style={styles.smallButtonText}>+ Category</Text>
              </TouchableOpacity>
            </View>
            {customCategories.length > 0 ? (
              <View style={styles.categoryRow}>
                {customCategories.map((item) => (
                  <TouchableOpacity
                    key={item}
                    style={styles.customCategoryTag}
                    onPress={() => removeCustomCategory(item)}
                  >
                    <Text style={styles.customCategoryTagText}>{item} ✕</Text>
                  </TouchableOpacity>
                ))}
                <Text style={styles.removeHint}>Tap a custom category above to remove it.</Text>
              </View>
            ) : (
              <Text style={styles.emptyText}>No custom categories yet. Add one above.</Text>
            )}

          </View>
        ) : null}

        {screen === 'bills' ? (
          <View style={styles.screenContent}>
            <Text style={styles.screenTitle}>Bills</Text>
            <Text style={styles.sectionTitle}>Bill reminders</Text>
            <View style={styles.budgetBox}>
              {Platform.OS === 'web' ? (
                <Text style={styles.dateHint}>📱 Real notifications need the phone app — on this website you'll still see the "Bills due" banner.</Text>
              ) : notifStatus === 'denied' ? (
                <Text style={styles.dateHint}>🔕 Notifications are off — turn them on in your phone's Settings → Apps → Expense Tracker → Notifications to get bill reminders.</Text>
              ) : notifStatus === 'granted' ? (
                <Text style={styles.dateHint}>🔔 Notifications on — you'll be reminded at 9:00 on each bill's due day.</Text>
              ) : null}
              <View style={styles.customCategoryRow}>
                <TextInput
                  style={[styles.input, styles.customCategoryInput]}
                  placeholder="Bill e.g. Electricity"
                  value={billName}
                  onChangeText={setBillName}
                />
                <TextInput
                  style={[styles.input, styles.budgetInput]}
                  placeholder="Amount"
                  value={billAmountText}
                  onChangeText={setBillAmountText}
                  keyboardType="numeric"
                />
                <TextInput
                  style={[styles.input, styles.budgetInput]}
                  placeholder="Day 1-31"
                  value={billDueDayText}
                  onChangeText={setBillDueDayText}
                  keyboardType="numeric"
                />
              </View>
              <TouchableOpacity style={styles.smallButton} onPress={addBill}>
                <Text style={styles.smallButtonText}>+ Add bill</Text>
              </TouchableOpacity>
              {bills.length === 0 ? (
                <Text style={styles.budgetText}>No bills yet. Add one above — it repeats every month.</Text>
              ) : (
                billStatuses.map((bill) => (
                  <View key={bill.id} style={styles.breakdownRow}>
                    <View
                      style={[
                        styles.categoryDot,
                        { backgroundColor: bill.overdue ? '#d00000' : bill.paid ? '#2a9d8f' : '#e9a319' },
                      ]}
                    />
                    <View style={styles.expenseInfo}>
                      <Text style={styles.expenseTitle}>{bill.name}</Text>
                      <Text style={styles.expenseMeta}>
                        Due {bill.dueDay} {monthLabel(bill.monthKey)} · {formatAmount(bill.amount)}
                        {bill.paid ? ' · Paid ✓' : bill.overdue ? ' · Overdue!' : ' · Upcoming'}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => toggleBillPaid(bill.id)}>
                      <Text style={styles.editText}>{bill.paid ? 'Undo paid' : 'Mark paid'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => toggleBillRemind(bill.id)}>
                      <Text style={styles.editText}>{bill.remind === false ? '🔕 Remind off' : '🔔 Remind on'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteBill(bill.id, bill.name)}>
                      <Text style={styles.deleteText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>

          </View>
        ) : null}

        {screen === 'settings' ? (
          <View style={styles.screenContent}>
            <Text style={styles.screenTitle}>Settings</Text>
            <Text style={styles.sectionTitle}>Backup & Restore</Text>
            <View style={styles.budgetBox}>
              <Text style={styles.chartNote}>Save all your entries, budgets, goals and bills in one file, so you can bring them back if you change or lose your phone.</Text>
              <Text style={styles.budgetText}>
                {lastBackup ? `Last backup: ${lastBackup}` : 'Never backed up yet.'}
              </Text>
              <View style={styles.budgetRow}>
                <TouchableOpacity style={styles.smallButton} onPress={exportBackup}>
                  <Text style={styles.smallButtonText}>⇩ Download backup</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.smallButton} onPress={shareBackupByEmail}>
                  <Text style={styles.smallButtonText}>✉ Share backup</Text>
                </TouchableOpacity>
              </View>
              {Platform.OS === 'web' ? (
                <TouchableOpacity style={styles.exportButton} onPress={pickBackupFile}>
                  <Text style={styles.exportButtonText}>↥  Restore from backup file</Text>
                </TouchableOpacity>
              ) : null}
              <Text style={styles.budgetText}>Or paste a backup below and tap Restore:</Text>
              <TextInput
                style={[styles.input, styles.restoreInput]}
                placeholder="Paste backup JSON here"
                value={restoreText}
                onChangeText={setRestoreText}
                multiline
                autoCapitalize="none"
              />
              <TouchableOpacity style={styles.smallButton} onPress={() => restoreText.trim() && restoreFromText(restoreText)}>
                <Text style={styles.smallButtonText}>Restore backup</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>App lock (PIN)</Text>
            <View style={styles.budgetBox}>
              {pin ? (
                <View>
                  <Text style={styles.budgetText}>A 4-digit PIN is set. The app asks for it when it opens.</Text>
                  <TextInput style={styles.input} placeholder="Current PIN" value={pinCurrent} onChangeText={setPinCurrent} keyboardType="numeric" secureTextEntry maxLength={4} />
                  <TextInput style={styles.input} placeholder="New 4-digit PIN" value={pinNew} onChangeText={setPinNew} keyboardType="numeric" secureTextEntry maxLength={4} />
                  <TextInput style={styles.input} placeholder="Repeat new PIN" value={pinNewConfirm} onChangeText={setPinNewConfirm} keyboardType="numeric" secureTextEntry maxLength={4} />
                  <View style={styles.budgetRow}>
                    <TouchableOpacity style={styles.smallButton} onPress={changePin}>
                      <Text style={styles.smallButtonText}>Change PIN</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.smallButton, styles.clearButton]} onPress={removePin}>
                      <Text style={styles.smallButtonText}>Remove PIN</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.smallButton} onPress={() => setLocked(true)}>
                      <Text style={styles.smallButtonText}>Lock now</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View>
                  <Text style={styles.budgetText}>No PIN set. A PIN keeps other people from opening your expenses.</Text>
                  <TextInput style={styles.input} placeholder="New 4-digit PIN" value={pinSetInput} onChangeText={setPinSetInput} keyboardType="numeric" secureTextEntry maxLength={4} />
                  <TextInput style={styles.input} placeholder="Repeat PIN" value={pinSetConfirm} onChangeText={setPinSetConfirm} keyboardType="numeric" secureTextEntry maxLength={4} />
                  <TouchableOpacity style={styles.smallButton} onPress={setNewPin}>
                    <Text style={styles.smallButtonText}>Set PIN</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            <Text style={styles.sectionTitle}>Appearance</Text>
            <View style={styles.budgetBox}>
              <View style={styles.budgetRow}>
                <Text style={styles.budgetText}>{darkMode ? 'Dark mode is on.' : 'Light mode is on.'}</Text>
                <TouchableOpacity style={styles.smallButton} onPress={() => saveDarkMode(!darkMode)}>
                  <Text style={styles.smallButtonText}>{darkMode ? '☀️ Light mode' : '🌙 Dark mode'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : null}
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </View>
  );
}

const LIGHT = {
  bg: '#f5f5f5',
  card: '#ffffff',
  text: '#111111',
  text2: '#495057',
  muted: '#6c757d',
  chip: '#e9ecef',
  tagBg: '#fff3cd',
  accentText: '#264653',
  danger: '#d00000',
};

const DARK = {
  bg: '#121417',
  card: '#1f2329',
  text: '#f1f3f5',
  text2: '#d5dbe0',
  muted: '#9aa3ad',
  chip: '#2e343c',
  tagBg: '#3a3220',
  accentText: '#8ecae6',
  danger: '#ff6b6b',
};

function makeStyles(dark) {
  const t = dark ? DARK : LIGHT;
  return StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: t.bg,
  },
  app: {
    flex: 1,
    backgroundColor: t.bg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#264653',
    paddingTop: 48,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  topBarTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  menuButton: {
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  menuButtonText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    lineHeight: 32,
  },
  menuOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    flexDirection: 'row',
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  menuPanel: {
    width: 240,
    backgroundColor: t.card,
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  menuHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  menuTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: t.text,
  },
  menuCloseText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: t.accentText,
  },
  menuItem: {
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: t.chip,
  },
  menuItemSelected: {
    backgroundColor: '#264653',
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: t.text2,
  },
  menuItemTextSelected: {
    color: '#ffffff',
  },
  screenContent: {
    width: '100%',
    alignItems: 'center',
  },
  container: {
    padding: 16,
    paddingTop: 16,
    backgroundColor: t.bg,
    alignItems: 'center',
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    color: t.text,
    textAlign: 'center',
    marginVertical: 16,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: t.bg,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
    width: '100%',
  },
  summaryBox: {
    flex: 1,
    backgroundColor: t.card,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 12,
    color: t.muted,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: t.text,
    marginTop: 4,
  },
  incomeValue: {
    color: '#2a9d8f',
  },
  negativeValue: {
    color: t.danger,
  },
  filterNote: {
    fontSize: 12,
    color: t.muted,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  budgetBox: {
    width: '100%',
    backgroundColor: t.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  budgetRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  budgetInput: {
    flex: 1,
    marginBottom: 0,
  },
  budgetText: {
    fontSize: 14,
    color: t.text2,
    marginTop: 8,
  },
  warningText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: t.danger,
    marginTop: 4,
  },
  progressTrack: {
    height: 12,
    backgroundColor: t.chip,
    borderRadius: 6,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressFill: {
    height: 12,
    backgroundColor: '#2a9d8f',
    borderRadius: 6,
  },
  progressWarning: {
    backgroundColor: '#e9a319',
  },
  progressOver: {
    backgroundColor: t.danger,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: t.text,
    alignSelf: 'flex-start',
    marginTop: 16,
    marginBottom: 8,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: t.text,
    alignSelf: 'flex-start',
    marginTop: 4,
    marginBottom: 8,
  },
  input: {
    width: '100%',
    backgroundColor: t.card,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    fontSize: 16,
    color: t.text,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
    marginBottom: 8,
  },
  typeButton: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: t.chip,
  },
  typeButtonSelectedExpense: {
    backgroundColor: '#264653',
  },
  typeButtonSelectedIncome: {
    backgroundColor: '#2a9d8f',
  },
  typeText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: t.text2,
  },
  typeTextSelected: {
    color: '#ffffff',
  },
  dateRow: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
    alignItems: 'center',
  },
  dateInput: {
    flex: 1,
    marginBottom: 8,
    textAlign: 'center',
  },
  dateStepButton: {
    backgroundColor: t.card,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  dateStepText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: t.accentText,
  },
  todayButton: {
    backgroundColor: '#264653',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  todayButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  dateHint: {
    fontSize: 12,
    color: t.muted,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  categoryChip: {
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: t.chip,
  },
  categoryText: {
    fontSize: 14,
    color: t.text,
  },
  categoryTextSelected: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  filterChipSelected: {
    backgroundColor: '#264653',
  },
  customCategoryRow: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
    alignItems: 'center',
  },
  customCategoryInput: {
    flex: 1,
  },
  customCategoryTag: {
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: t.tagBg,
  },
  customCategoryTagText: {
    fontSize: 14,
    color: t.text,
  },
  removeHint: {
    fontSize: 12,
    color: t.muted,
    alignSelf: 'center',
  },
  smallButton: {
    backgroundColor: '#264653',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  smallButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  clearButton: {
    backgroundColor: '#6c757d',
  },
  repeatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: 8,
    gap: 8,
  },
  repeatBox: {
    fontSize: 20,
    color: t.text,
  },
  repeatText: {
    fontSize: 16,
    color: t.text,
  },
  addButton: {
    width: '100%',
    backgroundColor: '#264653',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
    marginTop: 4,
  },
  saveButton: {
    backgroundColor: '#2a9d8f',
  },
  addButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  cancelButton: {
    width: '100%',
    backgroundColor: t.chip,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: t.text2,
  },
  chartNote: {
    fontSize: 14,
    color: t.muted,
    alignSelf: 'flex-start',
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.card,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    gap: 8,
    width: '100%',
  },
  breakdownName: {
    flex: 1,
    fontSize: 16,
    color: t.text,
  },
  breakdownAmount: {
    fontSize: 16,
    fontWeight: 'bold',
    color: t.text,
  },
  breakdownPct: {
    fontSize: 14,
    color: t.muted,
    width: 44,
    textAlign: 'right',
  },
  monthFilterRow: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
    alignItems: 'center',
    marginBottom: 8,
  },
  monthFilterLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: 'bold',
    color: t.text,
    textAlign: 'center',
  },
  exportButton: {
    width: '100%',
    backgroundColor: t.card,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: t.accentText,
  },
  exportButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: t.accentText,
  },
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.card,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    gap: 8,
    width: '100%',
  },
  categoryDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  expenseInfo: {
    flex: 1,
  },
  expenseTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: t.text,
  },
  expenseMeta: {
    fontSize: 12,
    color: t.muted,
    marginTop: 2,
  },
  expenseAmount: {
    fontSize: 16,
    fontWeight: 'bold',
    color: t.text,
  },
  rowActions: {
    alignItems: 'flex-end',
    gap: 6,
  },
  editText: {
    color: t.accentText,
    fontSize: 14,
    fontWeight: 'bold',
  },
  deleteText: {
    color: t.danger,
    fontSize: 14,
  },
  emptyText: {
    color: t.muted,
    marginTop: 8,
  },
  pickDateButton: {
    width: '100%',
    backgroundColor: t.card,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: t.accentText,
  },
  pickDateButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: t.accentText,
  },
  calendarBox: {
    width: '100%',
    backgroundColor: t.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  calendarNavButton: {
    backgroundColor: t.chip,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  calendarNavText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: t.accentText,
  },
  calendarTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: 'bold',
    color: t.text,
    textAlign: 'center',
  },
  calendarWeekRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  calendarWeekDay: {
    flex: 1,
    fontSize: 12,
    fontWeight: 'bold',
    color: t.muted,
    textAlign: 'center',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarDay: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  calendarDayToday: {
    backgroundColor: t.chip,
  },
  calendarDaySelected: {
    backgroundColor: '#264653',
  },
  calendarDayText: {
    fontSize: 16,
    color: t.text,
  },
  calendarDayTextSelected: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  calendarCloseButton: {
    backgroundColor: t.chip,
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  calendarCloseText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: t.text2,
  },
  dateFilterRow: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
    alignItems: 'center',
  },
  dateFilterInput: {
    flex: 1,
  },
  bottomSpacer: {
    height: 32,
  },
  noteText: {
    fontSize: 13,
    color: t.text2,
    marginTop: 2,
  },
  receiptImage: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: t.chip,
  },
  topBarButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  billAlertBox: {
    width: '100%',
    backgroundColor: t.tagBg,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: t.danger,
  },
  billAlertTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: t.danger,
    marginBottom: 4,
  },
  billAlertText: {
    fontSize: 14,
    color: t.text2,
    marginBottom: 2,
  },
  photoButton: {
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.accentText,
  },
  photoPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  receiptImageLarge: {
    width: 120,
    height: 120,
    borderRadius: 8,
    backgroundColor: t.chip,
  },
  restoreInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },

});

}