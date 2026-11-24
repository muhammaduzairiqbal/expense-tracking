import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Keyboard,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BarChart } from 'react-native-chart-kit';

const STORAGE_KEY = '@expense_tracker:expenses';

const CATEGORIES = ['Food', 'Transport', 'Shopping', 'Bills', 'Entertainment', 'Other'];

const CATEGORY_COLORS = {
  Food: '#e76f51',
  Transport: '#2a9d8f',
  Shopping: '#e9c46a',
  Bills: '#264653',
  Entertainment: '#9b5de5',
  Other: '#6c757d',
};

// Sample expenses carried over from the original expense_tracking_9
// Reports screen (Jan-Jun monthly totals: 500, 700, 900, 600, 800, 1000).
// They are only used on the very first run, so the chart has something to
// show. The user can delete any of them.
const SEED_EXPENSES = [
  { id: 'seed-1', title: 'Groceries', amount: 500, category: 'Food', date: '2026-01-15' },
  { id: 'seed-2', title: 'Bus and fuel', amount: 700, category: 'Transport', date: '2026-02-10' },
  { id: 'seed-3', title: 'Clothes shopping', amount: 900, category: 'Shopping', date: '2026-03-05' },
  { id: 'seed-4', title: 'Electricity bill', amount: 600, category: 'Bills', date: '2026-04-12' },
  { id: 'seed-5', title: 'Dinner out', amount: 800, category: 'Food', date: '2026-05-20' },
  { id: 'seed-6', title: 'Movie night', amount: 1000, category: 'Entertainment', date: '2026-06-08' },
];

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatAmount(amount) {
  return `Rs. ${Number(amount).toLocaleString('en-PK')}`;
}

export default function App() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Food');
  const [date, setDate] = useState(todayISO());

  // Load saved expenses, or seed the original sample data on first run.
  useEffect(() => {
    const loadExpenses = async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved !== null) {
          setExpenses(JSON.parse(saved));
        } else {
          setExpenses(SEED_EXPENSES);
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_EXPENSES));
        }
      } catch (err) {
        Alert.alert('Could not load expenses', err.message);
      } finally {
        setLoading(false);
      }
    };
    loadExpenses();
  }, []);

  // Save every change to the phone, as numbers (amount stays a number).
  const saveExpenses = async (nextExpenses) => {
    setExpenses(nextExpenses);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextExpenses));
    } catch (err) {
      Alert.alert('Could not save expenses', err.message);
    }
  };

  const addExpense = () => {
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
    const expense = {
      id: `${Date.now()}`,
      title: title.trim(),
      amount: parsedAmount,
      category,
      date: date.trim(),
    };
    saveExpenses([expense, ...expenses]);
    setTitle('');
    setAmount('');
    setCategory('Food');
    setDate(todayISO());
    Keyboard.dismiss();
  };

  const deleteExpense = (id, expenseTitle) => {
    Alert.alert('Delete expense?', `Delete "${expenseTitle}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => saveExpenses(expenses.filter((item) => item.id !== id)),
      },
    ]);
  };

  const total = useMemo(
    () => expenses.reduce((sum, item) => sum + Number(item.amount), 0),
    [expenses]
  );

  const thisMonthTotal = useMemo(() => {
    const prefix = todayISO().slice(0, 7);
    return expenses
      .filter((item) => item.date.startsWith(prefix))
      .reduce((sum, item) => sum + Number(item.amount), 0);
  }, [expenses]);

  const monthlyTotals = useMemo(() => {
    const totals = Array(12).fill(0);
    expenses.forEach((item) => {
      const month = Number(item.date.slice(5, 7)) - 1;
      if (month >= 0 && month < 12) {
        totals[month] += Number(item.amount);
      }
    });
    return totals;
  }, [expenses]);

  const sortedExpenses = useMemo(
    () => [...expenses].sort((a, b) => b.date.localeCompare(a.date)),
    [expenses]
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Expense Tracker</Text>

      <View style={styles.summaryRow}>
        <View style={styles.summaryBox}>
          <Text style={styles.summaryLabel}>Total spent</Text>
          <Text style={styles.summaryValue}>{formatAmount(total)}</Text>
        </View>
        <View style={styles.summaryBox}>
          <Text style={styles.summaryLabel}>This month</Text>
          <Text style={styles.summaryValue}>{formatAmount(thisMonthTotal)}</Text>
        </View>
        <View style={styles.summaryBox}>
          <Text style={styles.summaryLabel}>Expenses</Text>
          <Text style={styles.summaryValue}>{expenses.length}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Monthly Spending Trends</Text>
      <BarChart
        data={{
          labels: MONTH_LABELS,
          datasets: [{ data: monthlyTotals }],
        }}
        width={350}
        height={220}
        yAxisLabel="Rs. "
        chartConfig={{
          backgroundColor: '#ffffff',
          backgroundGradientFrom: '#ffffff',
          backgroundGradientTo: '#ffffff',
          decimalPlaces: 0,
          color: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
          labelColor: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
          style: { borderRadius: 16 },
        }}
        style={{ marginVertical: 8, borderRadius: 16 }}
      />

      <Text style={styles.sectionTitle}>Add an expense</Text>
      <TextInput
        style={styles.input}
        placeholder="What did you spend on? e.g. Groceries"
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
      <TextInput
        style={styles.input}
        placeholder="Date YYYY-MM-DD"
        value={date}
        onChangeText={setDate}
      />
      <View style={styles.categoryRow}>
        {CATEGORIES.map((item) => (
          <TouchableOpacity
            key={item}
            style={[
              styles.categoryChip,
              category === item && { backgroundColor: CATEGORY_COLORS[item] },
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
      <TouchableOpacity style={styles.addButton} onPress={addExpense}>
        <Text style={styles.addButtonText}>Add Expense</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>All expenses</Text>
      {expenses.length === 0 ? (
        <Text style={styles.emptyText}>No expenses yet. Add your first one above.</Text>
      ) : (
        <FlatList
          data={sortedExpenses}
          keyExtractor={(item) => item.id}
          style={styles.list}
          renderItem={({ item }) => (
            <View style={styles.expenseRow}>
              <View
                style={[
                  styles.categoryDot,
                  { backgroundColor: CATEGORY_COLORS[item.category] || '#6c757d' },
                ]}
              />
              <View style={styles.expenseInfo}>
                <Text style={styles.expenseTitle}>{item.title}</Text>
                <Text style={styles.expenseMeta}>
                  {item.category} · {item.date}
                </Text>
              </View>
              <Text style={styles.expenseAmount}>{formatAmount(item.amount)}</Text>
              <TouchableOpacity onPress={() => deleteExpense(item.id, item.title)}>
                <Text style={styles.deleteText}>Delete</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    paddingTop: 48,
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
  addButton: {
    width: '100%',
    backgroundColor: '#264653',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  list: {
    width: '100%',
  },
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    gap: 8,
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
  deleteText: {
    color: 'red',
    fontSize: 14,
  },
  emptyText: {
    color: '#6c757d',
    marginTop: 8,
  },
});
