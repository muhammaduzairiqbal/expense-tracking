import React, { useState, useEffect, useMemo } from 'react';
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
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BarChart } from 'react-native-chart-kit';

const STORAGE_KEY = '@expense_tracker:expenses';
const CUSTOM_CATEGORIES_KEY = '@expense_tracker:custom_categories';
const BUDGET_KEY = '@expense_tracker:monthly_budget';

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

// The four screens in the side (⋮) menu.
const SCREENS = [
  { key: 'home', label: 'Home' },
  { key: 'entries', label: 'Entries' },
  { key: 'charts', label: 'Charts' },
  { key: 'budget', label: 'Budget & Categories' },
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
  const [loading, setLoading] = useState(true);

  // Form state
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Food');
  const [date, setDate] = useState(todayISO());
  const [entryType, setEntryType] = useState('expense'); // 'expense' | 'income'
  const [repeatMonthly, setRepeatMonthly] = useState(false);
  const [editingId, setEditingId] = useState(null);

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
  const [screen, setScreen] = useState('home'); // 'home' | 'entries' | 'charts' | 'budget'
  const [menuOpen, setMenuOpen] = useState(false);
  const goToScreen = (next) => {
    setScreen(next);
    setMenuOpen(false);
  };

  // Charts + budget
  const [chartView, setChartView] = useState('monthly'); // 'monthly' | 'weekly' | 'category'
  const [budgetText, setBudgetText] = useState('');
  const [budget, setBudget] = useState(null); // number | null

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

  const resetForm = () => {
    setTitle('');
    setAmount('');
    setCategory('Food');
    setDate(todayISO());
    setEntryType('expense');
    setRepeatMonthly(false);
    setEditingId(null);
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

  const shiftFilterMonth = (delta) => {
    const base = filterMonth || monthKeyOf(todayISO());
    setFilterMonth(addMonths(`${base}-01`, delta).slice(0, 7));
  };

  // CSV text for the currently filtered entries (shared by Export and Share).
  const buildCsv = () => {
    const header = 'Date,Title,Category,Type,Amount (Rs),Repeat monthly';
    const lines = filteredEntries.map((item) =>
      [
        item.date,
        csvEscape(item.title),
        csvEscape(item.category),
        item.type,
        item.amount,
        item.repeat ? 'Yes' : 'No',
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
  const totalIncome = useMemo(
    () => filteredEntries.filter((i) => i.type === 'income').reduce((s, i) => s + Number(i.amount), 0),
    [filteredEntries]
  );
  const balance = totalIncome - totalSpent;

  // Budget is always measured against this calendar month's real spending.
  const thisMonthSpent = useMemo(() => {
    const prefix = monthKeyOf(todayISO());
    return entries
      .filter((item) => item.type !== 'income' && monthKeyOf(item.date) === prefix)
      .reduce((sum, item) => sum + Number(item.amount), 0);
  }, [entries]);

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

  const chartConfig = {
    backgroundColor: '#ffffff',
    backgroundGradientFrom: '#ffffff',
    backgroundGradientTo: '#ffffff',
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
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

  return (
    <View style={styles.app}>
      {/* ---- Top bar on every screen ---- */}
      <View style={styles.topBar}>
        <Text style={styles.topBarTitle}>Expense Tracker</Text>
        <TouchableOpacity style={styles.menuButton} onPress={() => setMenuOpen(!menuOpen)}>
          <Text style={styles.menuButtonText}>⋮</Text>
        </TouchableOpacity>
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
            <View style={styles.summaryRow}>
              <View style={styles.summaryBox}>
                <Text style={styles.summaryLabel}>Spent</Text>
                <Text style={styles.summaryValue}>{formatAmount(totalSpent)}</Text>
              </View>
              <View style={styles.summaryBox}>
                <Text style={styles.summaryLabel}>Income</Text>
                <Text style={[styles.summaryValue, styles.incomeValue]}>{formatAmount(totalIncome)}</Text>
              </View>
              <View style={styles.summaryBox}>
                <Text style={styles.summaryLabel}>Balance</Text>
                <Text style={[styles.summaryValue, balance < 0 && styles.negativeValue]}>
                  {formatAmount(balance)}
                </Text>
              </View>
            </View>
            <Text style={styles.filterNote}>
              Showing {filteredEntries.length} of {entries.length} entries
              {filterMonth || filterCategory !== 'All' || search.trim() || filterFrom.trim() || filterTo.trim()
                ? ' (filtered)'
                : ''}
              {'  ·  '}This month spent: {formatAmount(thisMonthSpent)}
            </Text>

            {/* Small budget summary — the full budget box lives on the Budget & Categories screen. */}
            {budget ? (
              <View style={styles.budgetBox}>
                <Text style={styles.sectionTitle}>Monthly budget</Text>
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
              <View style={styles.budgetBox}>
                <Text style={styles.budgetText}>No monthly budget set yet.</Text>
                <TouchableOpacity style={styles.smallButton} onPress={() => goToScreen('budget')}>
                  <Text style={styles.smallButtonText}>Set a budget</Text>
                </TouchableOpacity>
              </View>
            )}

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
            ) : null}
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
            ) : null}
            {entryType === 'expense' ? (
              <TouchableOpacity
                style={styles.repeatRow}
                onPress={() => setRepeatMonthly(!repeatMonthly)}
              >
                <Text style={styles.repeatBox}>{repeatMonthly ? '☑' : '☐'}</Text>
                <Text style={styles.repeatText}>Repeat every month</Text>
              </TouchableOpacity>
            ) : null}
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
            <Text style={styles.sectionTitle}>All entries</Text>
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
                  </View>
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
            <Text style={styles.sectionTitle}>Spending trends</Text>
            <View style={styles.typeRow}>
              {[
                { key: 'monthly', label: 'Monthly' },
                { key: 'weekly', label: 'Weekly' },
                { key: 'category', label: 'By category' },
              ].map((view) => (
                <TouchableOpacity
                  key={view.key}
                  style={[styles.typeButton, chartView === view.key && styles.typeButtonSelectedExpense]}
                  onPress={() => setChartView(view.key)}
                >
                  <Text style={[styles.typeText, chartView === view.key && styles.typeTextSelected]}>
                    {view.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {chartView === 'monthly' ? (
              <BarChart
                data={{ labels: MONTH_LABELS, datasets: [{ data: monthlyTotals }] }}
                width={CHART_WIDTH}
                height={220}
                yAxisLabel="Rs. "
                chartConfig={chartConfig}
                style={{ marginVertical: 8, borderRadius: 16 }}
              />
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

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  app: {
    flex: 1,
    backgroundColor: '#f5f5f5',
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
    backgroundColor: '#ffffff',
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
  },
  menuCloseText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#264653',
  },
  menuItem: {
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: '#e9ecef',
  },
  menuItemSelected: {
    backgroundColor: '#264653',
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#495057',
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
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginVertical: 16,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
    width: '100%',
  },
  summaryBox: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 12,
    color: '#6c757d',
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 4,
  },
  incomeValue: {
    color: '#2a9d8f',
  },
  negativeValue: {
    color: '#d00000',
  },
  filterNote: {
    fontSize: 12,
    color: '#6c757d',
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  budgetBox: {
    width: '100%',
    backgroundColor: '#ffffff',
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
    color: '#495057',
    marginTop: 8,
  },
  warningText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#d00000',
    marginTop: 4,
  },
  progressTrack: {
    height: 12,
    backgroundColor: '#e9ecef',
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
    backgroundColor: '#d00000',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    alignSelf: 'flex-start',
    marginTop: 16,
    marginBottom: 8,
  },
  input: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    fontSize: 16,
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
    backgroundColor: '#e9ecef',
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
    color: '#495057',
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
    backgroundColor: '#ffffff',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  dateStepText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#264653',
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
    color: '#6c757d',
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
    backgroundColor: '#e9ecef',
  },
  categoryText: {
    fontSize: 14,
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
    backgroundColor: '#fff3cd',
  },
  customCategoryTagText: {
    fontSize: 14,
  },
  removeHint: {
    fontSize: 12,
    color: '#6c757d',
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
  },
  repeatText: {
    fontSize: 16,
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
    backgroundColor: '#e9ecef',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#495057',
  },
  chartNote: {
    fontSize: 14,
    color: '#6c757d',
    alignSelf: 'flex-start',
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    gap: 8,
    width: '100%',
  },
  breakdownName: {
    flex: 1,
    fontSize: 16,
  },
  breakdownAmount: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  breakdownPct: {
    fontSize: 14,
    color: '#6c757d',
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
    textAlign: 'center',
  },
  exportButton: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#264653',
  },
  exportButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#264653',
  },
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
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
  },
  expenseMeta: {
    fontSize: 12,
    color: '#6c757d',
    marginTop: 2,
  },
  expenseAmount: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  rowActions: {
    alignItems: 'flex-end',
    gap: 6,
  },
  editText: {
    color: '#264653',
    fontSize: 14,
    fontWeight: 'bold',
  },
  deleteText: {
    color: 'red',
    fontSize: 14,
  },
  emptyText: {
    color: '#6c757d',
    marginTop: 8,
  },
  pickDateButton: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#264653',
  },
  pickDateButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#264653',
  },
  calendarBox: {
    width: '100%',
    backgroundColor: '#ffffff',
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
    backgroundColor: '#e9ecef',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  calendarNavText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#264653',
  },
  calendarTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: 'bold',
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
    color: '#6c757d',
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
    backgroundColor: '#e9ecef',
  },
  calendarDaySelected: {
    backgroundColor: '#264653',
  },
  calendarDayText: {
    fontSize: 16,
  },
  calendarDayTextSelected: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  calendarCloseButton: {
    backgroundColor: '#e9ecef',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  calendarCloseText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#495057',
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
});
