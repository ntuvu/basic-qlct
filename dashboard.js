import { supabaseUrl, supabaseKey, geminiKey } from './key.js';

const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
const genAI = new GoogleGenerativeAI(geminiKey);

// Check authentication
const currentUser = (() => {
  const user = localStorage.getItem('user');
  if (!user) {
    window.location.href = 'login.html';
    return null;
  }
  return JSON.parse(user);
})();

// Chart colors
const chartColors = {
  income: 'rgb(34, 197, 94)',
  expense: 'rgb(239, 68, 68)',
  balance: 'rgb(59, 130, 246)',
  categories: [
    '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c',
    '#d97706', '#65a30d', '#0d9488', '#0284c7', '#6366f1'
  ]
};

// Initialize charts
let monthlyChart, categoryChart, balanceChart;

async function fetchTransactions() {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', currentUser.id);

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return [];
  }
}

function processMonthlyData(transactions) {
  const monthlyData = {};
  
  transactions.forEach(t => {
    if (t.type === 'debt') return; // Skip debt transactions
    
    const month = dayjs(t.date).format('YYYY-MM');
    if (!monthlyData[month]) {
      monthlyData[month] = { income: 0, expense: 0 };
    }
    
    if (t.type === 'income') {
      monthlyData[month].income += t.amount;
    } else if (t.type === 'expense') {
      monthlyData[month].expense += t.amount;
    }
  });

  // Sort months
  const sortedMonths = Object.keys(monthlyData).sort();
  
  return {
    labels: sortedMonths.map(m => dayjs(m).format('MM/YYYY')),
    income: sortedMonths.map(m => monthlyData[m].income),
    expense: sortedMonths.map(m => monthlyData[m].expense)
  };
}

function processCategoryData(transactions) {
  const categoryData = {};
  
  transactions
    .filter(t => t.type === 'expense')
    .forEach(t => {
      if (!categoryData[t.category]) {
        categoryData[t.category] = 0;
      }
      categoryData[t.category] += t.amount;
    });
  
  return {
    labels: Object.keys(categoryData),
    data: Object.values(categoryData)
  };
}

function processBalanceData(transactions) {
  const balanceData = {};
  let runningBalance = 0;
  
  transactions
    .filter(t => t.type !== 'debt')
    .sort((a, b) => dayjs(a.date).diff(dayjs(b.date)))
    .forEach(t => {
      const date = dayjs(t.date).format('YYYY-MM-DD');
      runningBalance += t.type === 'income' ? t.amount : -t.amount;
      balanceData[date] = runningBalance;
    });
  
  const sortedDates = Object.keys(balanceData).sort();
  
  return {
    labels: sortedDates,
    data: sortedDates.map(d => balanceData[d])
  };
}

function createMonthlyChart(data) {
  const ctx = document.getElementById('monthlyChart').getContext('2d');
  
  if (monthlyChart) {
    monthlyChart.destroy();
  }
  
  monthlyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: [
        {
          label: 'Thu',
          data: data.income,
          backgroundColor: chartColors.income,
          borderRadius: 4
        },
        {
          label: 'Chi',
          data: data.expense,
          backgroundColor: chartColors.expense,
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: value => new Intl.NumberFormat('vi-VN', {
              style: 'currency',
              currency: 'VND',
              maximumFractionDigits: 0
            }).format(value)
          }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: context => {
              const value = context.raw;
              return `${context.dataset.label}: ${new Intl.NumberFormat('vi-VN', {
                style: 'currency',
                currency: 'VND',
                maximumFractionDigits: 0
              }).format(value)}`;
            }
          }
        }
      }
    }
  });
}

function createCategoryChart(data) {
  const ctx = document.getElementById('categoryChart').getContext('2d');
  
  if (categoryChart) {
    categoryChart.destroy();
  }
  
  categoryChart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: data.labels,
      datasets: [{
        data: data.data,
        backgroundColor: chartColors.categories,
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      plugins: {
        tooltip: {
          callbacks: {
            label: context => {
              const value = context.raw;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = ((value / total) * 100).toFixed(1);
              return `${context.label}: ${percentage}% (${new Intl.NumberFormat('vi-VN', {
                style: 'currency',
                currency: 'VND',
                maximumFractionDigits: 0
              }).format(value)})`;
            }
          }
        }
      }
    }
  });
}

function createBalanceChart(data) {
  const ctx = document.getElementById('balanceChart').getContext('2d');
  
  if (balanceChart) {
    balanceChart.destroy();
  }
  
  balanceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: [{
        label: 'Số dư',
        data: data.data,
        borderColor: chartColors.balance,
        tension: 0.1,
        fill: false
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          ticks: {
            callback: value => new Intl.NumberFormat('vi-VN', {
              style: 'currency',
              currency: 'VND',
              maximumFractionDigits: 0
            }).format(value)
          }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: context => {
              const value = context.raw;
              return `Số dư: ${new Intl.NumberFormat('vi-VN', {
                style: 'currency',
                currency: 'VND',
                maximumFractionDigits: 0
              }).format(value)}`;
            }
          }
        }
      }
    }
  });
}

async function generateAnalysis(transactions) {
  try {
    // Show loading state
    document.getElementById('analysis-content').innerHTML = `
      <div class="flex justify-center items-center space-x-2 text-gray-500">
        <i data-lucide="loader-2" class="animate-spin"></i>
        <span>Đang phân tích dữ liệu...</span>
      </div>
    `;

    const monthlyData = processMonthlyData(transactions);
    const categoryData = processCategoryData(transactions);
    
    const totalIncome = monthlyData.income.reduce((a, b) => a + b, 0);
    const totalExpense = monthlyData.expense.reduce((a, b) => a + b, 0);
    const ratio = totalIncome / totalExpense;
    
    const maxExpenseMonth = monthlyData.labels[
      monthlyData.expense.indexOf(Math.max(...monthlyData.expense))
    ];
    
    const maxExpenseCategory = categoryData.labels[
      categoryData.data.indexOf(Math.max(...categoryData.data))
    ];

    const prompt = `
      Phân tích dữ liệu chi tiêu sau (bằng tiếng Việt):
      - Tháng có chi tiêu cao nhất: ${maxExpenseMonth} (${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Math.max(...monthlyData.expense))})
      - Danh mục chi tiêu cao nhất: ${maxExpenseCategory} (${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Math.max(...categoryData.data))})
      - Tỷ lệ Thu/Chi: ${ratio.toFixed(2)}
      - Tổng thu: ${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalIncome)}
      - Tổng chi: ${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalExpense)}

      Hãy đưa ra nhận xét về:
      1. Tháng có chi tiêu cao nhất và lý do có thể
      2. Danh mục chi tiêu cao nhất và gợi ý tối ưu
      3. Đánh giá tỷ lệ Thu/Chi và đề xuất cải thiện nếu cần
      
      Hãy trả lời bằng tiếng Việt, sử dụng ngôn ngữ thân thiện và dễ hiểu, trả về định dạng markdown.
    `;

    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash-preview-05-20",
      generationConfig: {
        temperature: 0.7,
        topK: 1,
        topP: 1,
        maxOutputTokens: 65536,
      }
    });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    console.log(response.text());
    document.getElementById('analysis-content').innerHTML = `
      <div class="prose prose-sm max-w-none">
        ${marked.parse(response.text())}
      </div>
    `;
  } catch (error) {
    console.error('Error generating analysis:', error);
    document.getElementById('analysis-content').innerHTML = `
      <div class="text-red-500">Có lỗi xảy ra khi phân tích dữ liệu. Vui lòng thử lại sau.</div>
    `;
  }
}

async function initializeDashboard() {
  const transactions = await fetchTransactions();
  
  const monthlyData = processMonthlyData(transactions);
  const categoryData = processCategoryData(transactions);
  const balanceData = processBalanceData(transactions);
  
  createMonthlyChart(monthlyData);
  createCategoryChart(categoryData);
  createBalanceChart(balanceData);
  
}

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  initializeDashboard();
  
  document.getElementById('refresh-analysis').addEventListener('click', () => {
    document.getElementById('analysis-content').innerHTML = `
      <div class="animate-pulse">
        <div class="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
        <div class="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
        <div class="h-4 bg-gray-200 rounded w-2/3"></div>
      </div>
    `;
    initializeDashboard();
  });

  // Add event listener for AI analysis button
  document.getElementById('ai-analysis-btn').addEventListener('click', async () => {
    const transactions = await fetchTransactions();
    await generateAnalysis(transactions);
  });
}); 