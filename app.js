// Add immediate console logging to verify script loading
console.log('Script starting to load...');

import { supabaseUrl, supabaseKey } from './key.js';
import { parseExcelDate } from './utils.js';

// Check authentication
function checkAuth() {
  const user = localStorage.getItem('user');
  if (!user) {
    window.location.href = 'login.html';
    return null;
  }
  return JSON.parse(user);
}

const currentUser = checkAuth();
if (!currentUser) {
  throw new Error("User not authenticated");
}

const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

// Add logout functionality
function logout() {
  localStorage.removeItem('user');
  window.location.href = 'login.html';
}

// Add logout button event listener
document.addEventListener('DOMContentLoaded', () => {
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }
  lucide.createIcons();
});

// Thêm các biến cho pagination và filtering
const ITEMS_PER_PAGE = 10;
let currentPage = 1;
let totalItems = 0;
let currentFilters = {
  type: 'all',
  category: 'all',
  dateRange: 'all',
  sortBy: 'date-desc',
  paymentStatus: 'all',
  description: '',
  relatedPerson: ''
};

// Thiết lập Day.js
dayjs.extend(window.dayjs_plugin_customParseFormat);

// Các danh mục chi tiêu và thu nhập
const expenseCategories = ['Ăn uống', 'Di chuyển', 'Hóa đơn', 'Mua sắm', 'Giải trí', 'Sức khỏe', 'Giáo dục', 'Gia đình', 'Khác'];
const incomeCategories = ['Lương', 'Thưởng', 'Thu nhập phụ', 'Đầu tư', 'Quà tặng', 'Khác'];
const debtCategories = ['Tôi nợ người ta', 'Người ta nợ tôi'];

// Lấy các element từ DOM
const transactionList = document.getElementById('transaction-list');
const modal = document.getElementById('transaction-modal');
const form = document.getElementById('transaction-form');
const modalTitle = document.getElementById('modal-title');
const transactionIdInput = document.getElementById('transaction-id');

// --- CÁC HÀM XỬ LÝ DỮ LIỆU VỚI SUPABASE ---

/**
 * Lấy tất cả giao dịch từ Supabase với các bộ lọc và phân trang
 */
async function fetchTransactions() {
  try {
    console.log('Fetching transactions with filters:', currentFilters);
    let query = supabase
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', currentUser.id);

    // Áp dụng các bộ lọc
    if (currentFilters.type !== 'all') {
      console.log('Applying type filter:', currentFilters.type);
      query = query.eq('type', currentFilters.type);
    }
    if (currentFilters.category !== 'all') {
      console.log('Applying category filter:', currentFilters.category);
      query = query.eq('category', currentFilters.category);
    }
    if (currentFilters.dateRange !== 'all') {
      const today = dayjs();
      let startDate;
      switch (currentFilters.dateRange) {
        case 'today':
          startDate = today.startOf('day');
          break;
        case 'week':
          startDate = today.startOf('week');
          break;
        case 'month':
          startDate = today.startOf('month');
          break;
        case 'year':
          startDate = today.startOf('year');
          break;
      }
      console.log('Applying date range filter:', currentFilters.dateRange, 'from:', startDate.format('YYYY-MM-DD'));
      query = query.gte('date', startDate.format('YYYY-MM-DD'));
    }

    // Áp dụng bộ lọc trạng thái thanh toán cho giao dịch nợ
    if (currentFilters.type === 'debt' && currentFilters.paymentStatus !== 'all') {
      console.log('Applying payment status filter:', currentFilters.paymentStatus);
      query = query.eq('is_paid', currentFilters.paymentStatus === 'paid' ? 1 : 0);
    }

    // Áp dụng tìm kiếm nội dung
    if (currentFilters.description) {
      console.log('Applying description search:', currentFilters.description);
      query = query.ilike('description', `%${currentFilters.description}%`);
    }

    // Áp dụng tìm kiếm người liên quan
    if (currentFilters.relatedPerson) {
      console.log('Applying related person search:', currentFilters.relatedPerson);
      query = query.ilike('related_person', `%${currentFilters.relatedPerson}%`);
    }

    // Áp dụng sắp xếp
    const [field, order] = currentFilters.sortBy.split('-');
    console.log('Applying sort:', field, order);
    query = query.order(field, { ascending: order === 'asc' });

    // Áp dụng phân trang
    const from = (currentPage - 1) * ITEMS_PER_PAGE;
    const to = from + ITEMS_PER_PAGE - 1;
    console.log('Applying pagination:', from, 'to', to);
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      console.error('Lỗi khi lấy dữ liệu:', error);
      throw error;
    }

    console.log('Fetched data:', data);
    totalItems = count;
    return { data, count };
  } catch (error) {
    console.error('Lỗi khi lấy dữ liệu:', error);
    alert('Không thể tải dữ liệu từ server. Vui lòng kiểm tra lại kết nối và cấu hình Supabase.');
    return { data: [], count: 0 };
  }
}

/**
 * Thêm một giao dịch mới vào Supabase
 * @param {object} transactionData - Dữ liệu giao dịch
 */
async function addTransaction(transactionData) {
  const { data, error } = await supabase
    .from('transactions')
    .insert([{
      ...transactionData,
      user_id: currentUser.id
    }]);

  if (error) {
    console.error('Lỗi khi thêm giao dịch:', error);
    alert('Đã xảy ra lỗi khi lưu giao dịch.');
  }
  return data;
}

/**
 * Cập nhật một giao dịch đã có trong Supabase
 * @param {string} id - ID của giao dịch cần cập nhật
 * @param {object} transactionData - Dữ liệu giao dịch mới
 */
async function updateTransaction(id, transactionData) {
  // First check if the transaction belongs to the current user
  const { data: existingTransaction, error: checkError } = await supabase
    .from('transactions')
    .select('user_id')
    .eq('id', id)
    .single();

  if (checkError || existingTransaction.user_id !== currentUser.id) {
    alert('Không có quyền cập nhật giao dịch này.');
    return null;
  }

  const { data, error } = await supabase
    .from('transactions')
    .update(transactionData)
    .eq('id', id)
    .eq('user_id', currentUser.id);

  if (error) {
    console.error('Lỗi khi cập nhật giao dịch:', error);
    alert('Đã xảy ra lỗi khi cập nhật giao dịch.');
  }
  return data;
}

/**
 * Xóa một giao dịch khỏi Supabase
 * @param {string} id - ID của giao dịch cần xóa
 */
async function deleteTransaction(id) {
  const confirmed = confirm('Bạn có chắc chắn muốn xóa giao dịch này không?');
  if (!confirmed) return;

  // First check if the transaction belongs to the current user
  const { data: existingTransaction, error: checkError } = await supabase
    .from('transactions')
    .select('user_id')
    .eq('id', id)
    .single();

  if (checkError || existingTransaction.user_id !== currentUser.id) {
    alert('Không có quyền xóa giao dịch này.');
    return;
  }

  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', id)
    .eq('user_id', currentUser.id);

  if (error) {
    console.error('Lỗi khi xóa giao dịch:', error);
    alert('Đã xảy ra lỗi khi xóa giao dịch.');
  } else {
    loadAndRenderData();
  }
}

/**
 * Lấy tất cả giao dịch từ Supabase để tính toán tổng kết
 */
async function fetchAllTransactionsForSummary() {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', currentUser.id);

    if (error) {
      console.error('Lỗi khi lấy dữ liệu tổng kết:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Lỗi khi lấy dữ liệu tổng kết:', error);
    return [];
  }
}

// --- CÁC HÀM HIỂN THỊ TRÊN GIAO DIỆN (UI) ---

/**
 * Định dạng số thành chuỗi tiền tệ Việt Nam (₫)
 * @param {number} number - Số tiền
 */
function formatCurrency(number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(number);
}

/**
 * Cập nhật các thẻ tóm tắt (Tổng thu, tổng chi, số dư, nợ)
 * @param {Array<object>} transactions - Mảng các giao dịch
 */
function updateSummary(transactions) {
  // Chỉ tính toán với các giao dịch không phải nợ
  const nonDebtTransactions = transactions.filter(t => t.type !== 'debt');

  const totalIncome = nonDebtTransactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpense = nonDebtTransactions
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);

  const balance = totalIncome - totalExpense;

  // Tính toán các khoản nợ chưa thanh toán
  const unpaidDebtToMe = transactions
    .filter(t => t.type === 'debt' && t.category === 'Người ta nợ tôi' && t.is_paid === 0)
    .reduce((sum, t) => sum + t.amount, 0);

  const unpaidDebtFromMe = transactions
    .filter(t => t.type === 'debt' && t.category === 'Tôi nợ người ta' && t.is_paid === 0)
    .reduce((sum, t) => sum + t.amount, 0);

  document.getElementById('total-income').textContent = formatCurrency(totalIncome);
  document.getElementById('total-expense').textContent = formatCurrency(totalExpense);
  const balanceEl = document.getElementById('balance');
  balanceEl.textContent = formatCurrency(balance);
  balanceEl.classList.toggle('text-red-900', balance < 0);
  balanceEl.classList.toggle('text-blue-900', balance >= 0);

  // Cập nhật các khoản nợ
  document.getElementById('total-unpaid-debt-to-me').textContent = formatCurrency(unpaidDebtToMe);
  document.getElementById('total-unpaid-debt-from-me').textContent = formatCurrency(unpaidDebtFromMe);
}

/**
 * Hiển thị danh sách các giao dịch lên bảng
 * @param {Array<object>} transactions - Mảng các giao dịch
 */
function renderTransactions(transactions) {
  const loadingState = document.getElementById('loading-state');
  const emptyState = document.getElementById('empty-state');

  loadingState.classList.add('hidden');
  const oldRows = transactionList.querySelectorAll('.transaction-row');
  oldRows.forEach(row => row.remove());

  if (transactions.length === 0) {
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');

    transactions.forEach(t => {
      const isExpense = t.type === 'expense';
      const isIncome = t.type === 'income';
      const isDebt = t.type === 'debt';
      const row = document.createElement('tr');
      row.className = 'border-b border-gray-100 hover:bg-gray-50 transaction-row';

      let amountClass = '';
      let amountPrefix = '';
      if (isExpense) {
        amountClass = 'text-red-600';
        amountPrefix = '-';
      } else if (isIncome) {
        amountClass = 'text-green-600';
        amountPrefix = '+';
      } else if (isDebt) {
        amountClass = 'text-yellow-600';
        amountPrefix = t.category === 'Tôi nợ người ta' ? '-' : '+';
      }

      // Create payment status cell
      let statusCell = '';
      if (isDebt) {
        const isPaid = t.is_paid === 1;
        statusCell = `
          <td class="p-4 text-center">
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${isPaid ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
          }">
              ${isPaid ? 'Đã trả' : 'Chưa trả'}
            </span>
          </td>
        `;
      } else {
        statusCell = '<td class="p-4 text-center">-</td>';
      }

      row.innerHTML = `
        <td class="p-4 font-medium">${dayjs(t.date).format('DD/MM/YYYY')}</td>
        <td class="p-4">${t.description}</td>
        <td class="p-4 text-sm text-gray-600">${t.category}</td>
        <td class="p-4 text-sm text-gray-600">${t.related_person || '-'}</td>
        <td class="p-4 text-right font-semibold ${amountClass}">
          ${amountPrefix} ${formatCurrency(t.amount)}
        </td>
        ${statusCell}
        <td class="p-4 text-right">
          ${isDebt && !t.is_paid ? `
            <button class="mark-paid-btn p-2 text-gray-500 hover:text-green-600 mr-2" data-id="${t.id}">
              <i data-lucide="check-circle" class="h-5 w-5"></i>
            </button>
          ` : ''}
          <button class="edit-btn p-2 text-gray-500 hover:text-blue-600" data-id="${t.id}">
            <i data-lucide="edit" class="h-5 w-5"></i>
          </button>
          <button class="delete-btn p-2 text-gray-500 hover:text-red-600" data-id="${t.id}">
            <i data-lucide="trash-2" class="h-5 w-5"></i>
          </button>
        </td>
      `;
      transactionList.appendChild(row);
    });
  }

  lucide.createIcons();
}

/**
 * Cập nhật giao diện form khi chuyển đổi giữa Thu/Chi/Nợ
 */
function updateFormUIBasedOnType() {
  const selectedType = document.querySelector('input[name="type"]:checked').value;
  const expenseLabel = document.querySelector('label[for="type-expense"]');
  const incomeLabel = document.querySelector('label[for="type-income"]');
  const debtLabel = document.querySelector('label[for="type-debt"]');
  const relatedPersonContainer = document.getElementById('related-person-container');
  const paymentStatusContainer = document.getElementById('payment-status-container');

  // Reset all labels
  [expenseLabel, incomeLabel, debtLabel].forEach(label => {
    label.classList.remove('bg-red-500', 'bg-green-500', 'bg-yellow-500', 'text-white', 'border-red-500', 'border-green-500', 'border-yellow-500');
    label.classList.add('bg-white', 'text-gray-700', 'border-gray-300');
  });

  // Update selected label
  if (selectedType === 'expense') {
    expenseLabel.classList.add('bg-red-500', 'text-white', 'border-red-500');
    expenseLabel.classList.remove('bg-white', 'text-gray-700', 'border-gray-300');
  } else if (selectedType === 'income') {
    incomeLabel.classList.add('bg-green-500', 'text-white', 'border-green-500');
    incomeLabel.classList.remove('bg-white', 'text-gray-700', 'border-gray-300');
  } else if (selectedType === 'debt') {
    debtLabel.classList.add('bg-yellow-500', 'text-white', 'border-yellow-500');
    debtLabel.classList.remove('bg-white', 'text-gray-700', 'border-gray-300');
  }

  // Show/hide related person field and payment status
  if (selectedType === 'debt') {
    relatedPersonContainer.classList.remove('hidden');
    paymentStatusContainer.classList.remove('hidden');
  } else {
    relatedPersonContainer.classList.add('hidden');
    paymentStatusContainer.classList.add('hidden');
  }

  populateCategories(selectedType);
}

/**
 * Tải danh sách danh mục vào form select
 * @param {string} type - 'income', 'expense', hoặc 'debt'
 */
function populateCategories(type) {
  const categorySelect = document.getElementById('category');
  let categories;

  switch (type) {
    case 'income':
      categories = incomeCategories;
      break;
    case 'expense':
      categories = expenseCategories;
      break;
    case 'debt':
      categories = debtCategories;
      break;
    default:
      categories = expenseCategories;
  }

  categorySelect.innerHTML = categories.map(c => `<option value="${c}">${c}</option>`).join('');
}

/**
 * Mở modal và điền dữ liệu (nếu là chỉnh sửa)
 * @param {object|null} transaction - Dữ liệu giao dịch để chỉnh sửa, hoặc null để thêm mới
 */
function openModal(transaction = null) {
  form.reset();
  if (transaction) {
    modalTitle.textContent = 'Chỉnh Sửa Giao Dịch';
    transactionIdInput.value = transaction.id;
    document.getElementById('amount').value = transaction.amount;
    document.getElementById('description').value = transaction.description;
    document.getElementById('date').value = transaction.date;

    const typeRadio = document.getElementById(`type-${transaction.type}`);
    if (typeRadio) typeRadio.checked = true;

    populateCategories(transaction.type);
    document.getElementById('category').value = transaction.category;

    // Set related person value and payment status if it's a debt transaction
    if (transaction.type === 'debt') {
      document.getElementById('related-person').value = transaction.related_person || '';
      document.getElementById('is-paid').checked = transaction.is_paid === 1;
    }
  } else {
    modalTitle.textContent = 'Thêm Giao Dịch Mới';
    transactionIdInput.value = '';
    document.getElementById('date').value = dayjs().format('YYYY-MM-DD');
    populateCategories('expense'); // Mặc định là chi
    document.getElementById('is-paid').checked = false;
  }
  updateFormUIBasedOnType();
  modal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
  setTimeout(() => {
    modal.querySelector('.modal-content').classList.remove('scale-95');
    modal.classList.remove('opacity-0');
  }, 10);
}

/**
 * Đóng modal
 */
function closeModal() {
  modal.querySelector('.modal-content').classList.add('scale-95');
  modal.classList.add('opacity-0');
  setTimeout(() => {
    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }, 300);
}

/**
 * Cập nhật danh sách danh mục trong bộ lọc
 */
function updateCategoryFilter() {
  const categoryFilter = document.getElementById('category-filter');
  const typeFilter = document.getElementById('type-filter').value;
  let categories;

  switch (typeFilter) {
    case 'income':
      categories = incomeCategories;
      break;
    case 'expense':
      categories = expenseCategories;
      break;
    case 'debt':
      categories = debtCategories;
      break;
    default:
      categories = [...expenseCategories, ...incomeCategories, ...debtCategories];
  }

  // Giữ lại option "Tất cả"
  categoryFilter.innerHTML = '<option value="all">Tất cả</option>';

  // Thêm các danh mục mới
  categories.forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    categoryFilter.appendChild(option);
  });
}

/**
 * Cập nhật thông tin phân trang
 */
function updatePaginationInfo() {
  const start = totalItems === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1;
  const end = Math.min(currentPage * ITEMS_PER_PAGE, totalItems);
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

  document.getElementById('pagination-start').textContent = start;
  document.getElementById('pagination-end').textContent = end;
  document.getElementById('pagination-total').textContent = totalItems;

  // Cập nhật trạng thái nút phân trang
  document.getElementById('prev-page').disabled = currentPage === 1;
  document.getElementById('next-page').disabled = end >= totalItems;

  // Cập nhật số trang
  const pageNumbersContainer = document.getElementById('page-numbers');
  pageNumbersContainer.innerHTML = '';

  // Số lượng trang hiển thị tối đa
  const maxVisiblePages = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

  // Điều chỉnh startPage nếu endPage đạt giới hạn
  if (endPage - startPage + 1 < maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  // Thêm nút trang đầu tiên nếu cần
  if (startPage > 1) {
    const firstPageBtn = createPageButton(1);
    pageNumbersContainer.appendChild(firstPageBtn);
    if (startPage > 2) {
      const ellipsis = document.createElement('span');
      ellipsis.className = 'px-3 py-1 text-gray-500';
      ellipsis.textContent = '...';
      pageNumbersContainer.appendChild(ellipsis);
    }
  }

  // Thêm các nút số trang
  for (let i = startPage; i <= endPage; i++) {
    const pageButton = createPageButton(i);
    pageNumbersContainer.appendChild(pageButton);
  }

  // Thêm nút trang cuối cùng nếu cần
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      const ellipsis = document.createElement('span');
      ellipsis.className = 'px-3 py-1 text-gray-500';
      ellipsis.textContent = '...';
      pageNumbersContainer.appendChild(ellipsis);
    }
    const lastPageBtn = createPageButton(totalPages);
    pageNumbersContainer.appendChild(lastPageBtn);
  }
}

/**
 * Tạo nút số trang
 * @param {number} pageNumber - Số trang
 * @returns {HTMLElement} - Nút số trang
 */
function createPageButton(pageNumber) {
  const button = document.createElement('button');
  button.className = `px-3 py-1 border rounded-lg hover:bg-gray-50 ${pageNumber === currentPage
    ? 'bg-blue-600 text-white border-blue-600'
    : 'text-gray-700'
    }`;
  button.textContent = pageNumber;
  button.addEventListener('click', () => {
    currentPage = pageNumber;
    loadAndRenderData();
  });
  return button;
}

// --- HÀM CHÍNH VÀ CÁC EVENT LISTENER ---

/**
 * Hàm chính để tải và hiển thị tất cả dữ liệu
 */
async function loadAndRenderData() {
  document.getElementById('loading-state').classList.remove('hidden');

  // Fetch transactions for display (with filters and pagination)
  const { data: displayTransactions, count } = await fetchTransactions();

  // Fetch all transactions for summary calculations
  const allTransactions = await fetchAllTransactionsForSummary();

  renderTransactions(displayTransactions);
  updateSummary(allTransactions);
  updatePaginationInfo();
}

// Xử lý sự kiện khi form được submit
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const saveBtnText = document.getElementById('save-btn-text');
  const saveSpinner = document.getElementById('save-spinner');

  saveBtnText.classList.add('hidden');
  saveSpinner.classList.remove('hidden');
  document.getElementById('save-btn').disabled = true;

  const formData = new FormData(form);
  const transactionData = {
    date: formData.get('date'),
    description: formData.get('description'),
    amount: parseFloat(formData.get('amount')),
    category: formData.get('category'),
    type: formData.get('type')
  };

  if (transactionData.type === 'debt') {
    transactionData.related_person = formData.get('related-person');
    transactionData.is_paid = formData.get('is-paid') === 'on' ? 1 : 0;
  } else {
    transactionData.is_paid = null;
  }

  const id = transactionIdInput.value;
  if (id) {
    // When updating, preserve the existing is_paid value for debt transactions
    const { data: existingTransaction } = await supabase
      .from('transactions')
      .select('is_paid')
      .eq('id', id)
      .single();

    if (existingTransaction && transactionData.type === 'debt') {
      transactionData.is_paid = formData.get('is-paid') === 'on' ? 1 : 0;
    }

    await updateTransaction(id, transactionData);
  } else {
    await addTransaction(transactionData);
  }

  saveBtnText.classList.remove('hidden');
  saveSpinner.classList.add('hidden');
  document.getElementById('save-btn').disabled = false;

  closeModal();
  loadAndRenderData();
});

// Thêm các event listener khác
document.getElementById('add-transaction-btn').addEventListener('click', () => openModal());
document.getElementById('close-modal-btn').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === "Escape" && !modal.classList.contains('hidden')) closeModal();
});

document.querySelectorAll('input[name="type"]').forEach(radio => {
  radio.addEventListener('change', updateFormUIBasedOnType);
});

transactionList.addEventListener('click', async (e) => {
  const markPaidButton = e.target.closest('.mark-paid-btn');
  if (markPaidButton) {
    const id = markPaidButton.dataset.id;
    if (confirm('Bạn có chắc chắn muốn đánh dấu khoản nợ này đã được trả?')) {
      await markDebtAsPaid(id);
    }
    return;
  }

  const editButton = e.target.closest('.edit-btn');
  if (editButton) {
    const id = editButton.dataset.id;
    const { data, error } = await supabase.from('transactions').select('*').eq('id', id).single();
    if (error) {
      console.error("Lỗi khi lấy chi tiết giao dịch:", error);
    } else {
      openModal(data);
    }
  }

  const deleteButton = e.target.closest('.delete-btn');
  if (deleteButton) {
    const id = deleteButton.dataset.id;
    deleteTransaction(id);
  }
});

// Add this function to reset all filters
function resetFilters() {
  // Reset filter values
  document.getElementById('type-filter').value = 'all';
  document.getElementById('category-filter').value = 'all';
  document.getElementById('date-range').value = 'all';
  document.getElementById('sort-by').value = 'date-desc';
  document.getElementById('payment-status-filter').value = 'all';
  document.getElementById('description-search').value = '';
  document.getElementById('related-person-search').value = '';

  // Reset current filters state
  currentFilters = {
    type: 'all',
    category: 'all',
    dateRange: 'all',
    sortBy: 'date-desc',
    paymentStatus: 'all',
    description: '',
    relatedPerson: ''
  };

  // Hide payment status filter
  const paymentStatusFilterContainer = document.getElementById('payment-status-filter-container');
  if (paymentStatusFilterContainer) {
    paymentStatusFilterContainer.classList.add('hidden');
  }

  // Reset pagination
  currentPage = 1;

  // Update category filter options
  updateCategoryFilter();

  // Reload data
  loadAndRenderData();
}

// Update the DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', () => {
  console.log('Application initializing...');

  // Khởi tạo các event listeners
  const typeFilter = document.getElementById('type-filter');
  const categoryFilter = document.getElementById('category-filter');
  const dateRangeFilter = document.getElementById('date-range');
  const sortByFilter = document.getElementById('sort-by');
  const paymentStatusFilter = document.getElementById('payment-status-filter');
  const paymentStatusFilterContainer = document.getElementById('payment-status-filter-container');
  const descriptionSearch = document.getElementById('description-search');
  const relatedPersonSearch = document.getElementById('related-person-search');
  const prevPageBtn = document.getElementById('prev-page');
  const nextPageBtn = document.getElementById('next-page');
  const resetFiltersBtn = document.getElementById('reset-filters-btn');

  // Verify elements exist
  console.log('Filter elements found:', {
    typeFilter: !!typeFilter,
    categoryFilter: !!categoryFilter,
    dateRangeFilter: !!dateRangeFilter,
    sortByFilter: !!sortByFilter,
    paymentStatusFilter: !!paymentStatusFilter,
    descriptionSearch: !!descriptionSearch,
    relatedPersonSearch: !!relatedPersonSearch,
    resetFiltersBtn: !!resetFiltersBtn
  });

  // Type filter
  if (typeFilter) {
    typeFilter.addEventListener('change', function (e) {
      console.log('Type filter changed:', e.target.value);
      currentFilters.type = e.target.value;
      currentFilters.category = 'all'; // Reset category when type changes
      currentFilters.paymentStatus = 'all'; // Reset payment status when type changes
      currentPage = 1;

      // Show/hide payment status filter based on type
      if (paymentStatusFilterContainer) {
        paymentStatusFilterContainer.classList.toggle('hidden', e.target.value !== 'debt');
      }

      updateCategoryFilter();
      loadAndRenderData();
    });
  }

  // Category filter
  if (categoryFilter) {
    categoryFilter.addEventListener('change', function (e) {
      console.log('Category filter changed:', e.target.value);
      currentFilters.category = e.target.value;
      currentPage = 1;
      loadAndRenderData();
    });
  }

  // Date range filter
  if (dateRangeFilter) {
    dateRangeFilter.addEventListener('change', function (e) {
      console.log('Date range filter changed:', e.target.value);
      currentFilters.dateRange = e.target.value;
      currentPage = 1;
      loadAndRenderData();
    });
  }

  // Sort by filter
  if (sortByFilter) {
    sortByFilter.addEventListener('change', function (e) {
      console.log('Sort by changed:', e.target.value);
      currentFilters.sortBy = e.target.value;
      currentPage = 1;
      loadAndRenderData();
    });
  }

  // Payment status filter
  if (paymentStatusFilter) {
    paymentStatusFilter.addEventListener('change', function (e) {
      console.log('Payment status filter changed:', e.target.value);
      currentFilters.paymentStatus = e.target.value;
      currentPage = 1;
      loadAndRenderData();
    });
  }

  // Description search
  if (descriptionSearch) {
    descriptionSearch.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        console.log('Description search changed:', e.target.value);
        currentFilters.description = e.target.value;
        currentPage = 1;
        loadAndRenderData();
      }
    });
  }

  // Related person search
  if (relatedPersonSearch) {
    relatedPersonSearch.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        console.log('Related person search changed:', e.target.value);
        currentFilters.relatedPerson = e.target.value;
        currentPage = 1;
        loadAndRenderData();
      }
    });
  }

  // Reset filters button
  if (resetFiltersBtn) {
    resetFiltersBtn.addEventListener('click', function () {
      console.log('Resetting filters...');
      resetFilters();
    });
  }

  // Pagination buttons
  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', function () {
      console.log('Previous page clicked');
      if (currentPage > 1) {
        currentPage--;
        loadAndRenderData();
      }
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', function () {
      console.log('Next page clicked');
      const maxPage = Math.ceil(totalItems / ITEMS_PER_PAGE);
      if (currentPage < maxPage) {
        currentPage++;
        loadAndRenderData();
      }
    });
  }

  // Initialize other controls
  lucide.createIcons();
  updateCategoryFilter();
  loadAndRenderData();
  console.log('Application initialized');

  // Add Excel import functionality
  const importExcelBtn = document.getElementById('import-excel-btn');
  const excelFileInput = document.getElementById('excel-file-input');

  if (importExcelBtn && excelFileInput) {
    importExcelBtn.addEventListener('click', () => {
      excelFileInput.click();
    });

    excelFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        importExcel(file);
      }
      // Reset the input so the same file can be selected again
      e.target.value = '';
    });
  }

  // Add Excel export functionality
  const exportExcelBtn = document.getElementById('export-excel-btn');
  if (exportExcelBtn) {
    exportExcelBtn.addEventListener('click', exportExcel);
  }
});

// Add a test function to verify event handling
function testEventHandling() {
  console.log('Testing event handling...');
  const typeFilter = document.getElementById('type-filter');
  if (typeFilter) {
    console.log('Type filter found, adding test event listener');
    typeFilter.addEventListener('change', function (e) {
      console.log('Type filter changed to:', e.target.value);
    });
  } else {
    console.log('Type filter not found!');
  }
}

// Call test function immediately
testEventHandling();

// Add Excel import functionality
async function importExcel(file) {
  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);

    // Validate and transform the data
    const transactions = jsonData.map(row => {
      // Validate required fields
      if (!row['Ngày'] || !row['Nội dung'] || !row['Số tiền'] || !row['Phân loại'] || !row['Loại giao dịch']) {
        throw new Error('Excel file must contain columns: Ngày, Nội dung, Số tiền, Phân loại, Loại giao dịch');
      }

      // Transform the data
      const type = row['Loại giao dịch'].toLowerCase();
      let is_paid = null;

      // Handle payment status for debt transactions
      if (type === 'nợ') {
        is_paid = row['Trạng thái'] === 'Đã trả' ? 1 : 0;
      }

      return {
        date: parseExcelDate(row['Ngày']),
        description: row['Nội dung'],
        amount: parseFloat(row['Số tiền']),
        category: row['Phân loại'],
        type: type === 'thu' ? 'income' : type === 'chi' ? 'expense' : 'debt',
        related_person: row['Người liên quan'] || null,
        is_paid: is_paid
      };
    });

    // Show confirmation dialog with more details
    const confirmed = confirm(
      `Bạn có chắc chắn muốn nhập ${transactions.length} giao dịch từ file Excel?\n\n` +
      'Các cột bắt buộc:\n' +
      '- Ngày\n' +
      '- Nội dung\n' +
      '- Số tiền\n' +
      '- Phân loại\n' +
      '- Loại giao dịch\n\n' +
      'Cột tùy chọn:\n' +
      '- Người liên quan (cho giao dịch nợ)\n' +
      '- Trạng thái (cho giao dịch nợ: Đã trả/Chưa trả)'
    );

    if (!confirmed) return;

    // Show loading state
    const importBtn = document.getElementById('import-excel-btn');
    const originalText = importBtn.innerHTML;
    importBtn.innerHTML = `
      <i data-lucide="loader-2" class="mr-2 h-5 w-5 animate-spin"></i>
      Đang nhập dữ liệu...
    `;
    importBtn.disabled = true;
    lucide.createIcons();

    // Insert transactions in batches
    const batchSize = 50;
    for (let i = 0; i < transactions.length; i += batchSize) {
      const batch = transactions.slice(i, i + batchSize);
      const { error } = await supabase
        .from('transactions')
        .insert(batch);

      if (error) {
        throw error;
      }
    }

    // Reset button state
    importBtn.innerHTML = originalText;
    importBtn.disabled = false;
    lucide.createIcons();

    // Show success message and reload data
    alert('Nhập dữ liệu thành công!');
    loadAndRenderData();

  } catch (error) {
    console.error('Lỗi khi nhập file Excel:', error);
    alert('Có lỗi xảy ra khi nhập file Excel: ' + error.message);

    // Reset button state
    const importBtn = document.getElementById('import-excel-btn');
    importBtn.innerHTML = `
      <i data-lucide="file-up" class="mr-2 h-5 w-5"></i>
      Nhập Excel
    `;
    importBtn.disabled = false;
    lucide.createIcons();
  }
}

// Add Excel export functionality
async function exportExcel() {
  try {
    // Show loading state
    const exportBtn = document.getElementById('export-excel-btn');
    const originalText = exportBtn.innerHTML;
    exportBtn.innerHTML = `
      <i data-lucide="loader-2" class="mr-2 h-5 w-5 animate-spin"></i>
      Đang xuất dữ liệu...
    `;
    exportBtn.disabled = true;
    lucide.createIcons();

    // Fetch all transactions
    const { data: transactions, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('date', { ascending: false });

    if (error) throw error;

    // Transform data for Excel
    const excelData = transactions.map(t => ({
      'Ngày': dayjs(t.date).format('DD/MM/YYYY'),
      'Nội dung': t.description,
      'Số tiền': t.amount,
      'Phân loại': t.category,
      'Loại giao dịch': t.type === 'income' ? 'Thu' : t.type === 'expense' ? 'Chi' : 'Nợ',
      'Người liên quan': t.related_person || '',
      'Trạng thái': t.type === 'debt' ? (t.is_paid === 1 ? 'Đã trả' : 'Chưa trả') : '',
      'Ngày tạo': dayjs(t.created_at).format('DD/MM/YYYY HH:mm:ss')
    }));

    // Create worksheet
    const worksheet = XLSX.utils.json_to_sheet(excelData);

    // Set column widths
    const columnWidths = [
      { wch: 12 }, // Ngày
      { wch: 30 }, // Nội dung
      { wch: 15 }, // Số tiền
      { wch: 20 }, // Phân loại
      { wch: 15 }, // Loại giao dịch
      { wch: 20 }, // Người liên quan
      { wch: 15 }, // Trạng thái
      { wch: 20 }  // Ngày tạo
    ];
    worksheet['!cols'] = columnWidths;

    // Create workbook
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Giao dịch');

    // Generate Excel file
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    // Create download link
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Giao_dich_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);

    // Reset button state
    exportBtn.innerHTML = originalText;
    exportBtn.disabled = false;
    lucide.createIcons();

  } catch (error) {
    console.error('Lỗi khi xuất file Excel:', error);
    alert('Có lỗi xảy ra khi xuất file Excel: ' + error.message);

    // Reset button state
    const exportBtn = document.getElementById('export-excel-btn');
    exportBtn.innerHTML = `
      <i data-lucide="file-down" class="mr-2 h-5 w-5"></i>
      Export Excel
    `;
    exportBtn.disabled = false;
    lucide.createIcons();
  }
}

// Add function to mark debt as paid
async function markDebtAsPaid(id) {
  try {
    const { error } = await supabase
      .from('transactions')
      .update({ is_paid: 1 })
      .eq('id', id);

    if (error) throw error;

    loadAndRenderData();
  } catch (error) {
    console.error('Lỗi khi cập nhật trạng thái nợ:', error);
    alert('Có lỗi xảy ra khi cập nhật trạng thái nợ.');
  }
}
