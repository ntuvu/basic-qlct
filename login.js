// Initialize Supabase client
import { supabaseUrl, supabaseKey } from './key.js';
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

// Check if user is already logged in
async function checkAuth() {
  const user = localStorage.getItem('user');
  if (user) {
    window.location.href = 'index.html';
  }
}

// Handle login form submission
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const errorMessage = document.getElementById('error-message');
  
  try {
    // Query the qlct_user table
    const { data: users, error } = await supabase
      .from('qlct_user')
      .select('*')
      .eq('username', username)
      .eq('password', password)
      .single();
    
    if (users === null) {
      errorMessage.textContent = 'Tên đăng nhập hoặc mật khẩu không đúng';
      errorMessage.classList.remove('hidden');
      return;
    }

    if (error) throw error;

    if (users) {
      // Store user info in localStorage
      localStorage.setItem('user', JSON.stringify({
        id: users.id,
        username: users.username
      }));
      
      // Redirect to main page
      window.location.href = 'index.html';
    } else {
      errorMessage.textContent = 'Tên đăng nhập hoặc mật khẩu không đúng';
      errorMessage.classList.remove('hidden');
    }
  } catch (error) {
    console.error('Login error:', error);
    errorMessage.textContent = 'Có lỗi xảy ra khi đăng nhập';
    errorMessage.classList.remove('hidden');
  }
});

// Initialize icons
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  checkAuth();
}); 